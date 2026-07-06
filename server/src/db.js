import Database from 'better-sqlite3';
import { DB_PATH } from './config.js';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migraciones incrementales controladas por PRAGMA user_version.
// Cada entrada se ejecuta una sola vez y en orden; añadir nuevas al final.
const migrations = [
  // v1 — modelo base: usuarios, campañas, personajes, mesa de juego y compendio SRD
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dm_user_id INTEGER NOT NULL REFERENCES users(id),
    invite_code TEXT NOT NULL UNIQUE,
    scene TEXT NOT NULL DEFAULT 'aldea',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE campaign_members (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'jugador' CHECK (role IN ('dm', 'jugador')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (campaign_id, user_id)
  );

  CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    class_index TEXT,
    race_index TEXT,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
    abilities TEXT NOT NULL DEFAULT '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
    hp_max INTEGER NOT NULL DEFAULT 10,
    hp_current INTEGER NOT NULL DEFAULT 10,
    hp_temp INTEGER NOT NULL DEFAULT 0,
    ac INTEGER NOT NULL DEFAULT 10,
    speed INTEGER NOT NULL DEFAULT 30,
    save_proficiencies TEXT NOT NULL DEFAULT '[]',
    skill_proficiencies TEXT NOT NULL DEFAULT '[]',
    inventory TEXT NOT NULL DEFAULT '[]',
    spells TEXT NOT NULL DEFAULT '{"known":[],"prepared":[],"slots":{}}',
    features TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    avatar_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_characters_user ON characters(user_id);
  CREATE INDEX idx_characters_campaign ON characters(campaign_id);

  CREATE TABLE game_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
    is_live INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE srd_entries (
    category TEXT NOT NULL,
    idx TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_es TEXT,
    desc_es TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (category, idx)
  );
  CREATE INDEX idx_srd_name_es ON srd_entries(name_es);

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2 — registro de chat y tiradas por campaña
  `
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'chat' CHECK (type IN ('chat', 'roll', 'system')),
    body TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_chat_campaign ON chat_messages(campaign_id, id);
  `,

  // v3 — tracker de iniciativa: combatientes (PJ y enemigos) + estado del combate
  `
  ALTER TABLE game_tables ADD COLUMN combat_active INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE game_tables ADD COLUMN combat_round INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE game_tables ADD COLUMN combat_turn_id INTEGER;

  CREATE TABLE combatants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'enemigo' CHECK (kind IN ('pj', 'enemigo')),
    name TEXT NOT NULL,
    initiative INTEGER NOT NULL DEFAULT 0,
    hp_current INTEGER,
    hp_max INTEGER,
    ac INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_combatants_campaign ON combatants(campaign_id);
  `,

  // v4 — vincular un enemigo del tracker a su ficha del compendio (SRD) para
  // que el DM pueda consultarla y tirar sus ataques automáticamente
  `
  ALTER TABLE combatants ADD COLUMN monster_index TEXT;
  `,

  // v5 — asistente guiado de creación de personaje: estado de borrador/completo,
  // datos de identidad adicionales y competencias no cubiertas por habilidades/salvaciones
  `
  ALTER TABLE characters ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('draft', 'complete'));
  ALTER TABLE characters ADD COLUMN background TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN alignment TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN other_proficiencies TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE characters ADD COLUMN wizard_step INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE characters ADD COLUMN wizard_data TEXT NOT NULL DEFAULT '{}';
  CREATE INDEX idx_characters_status ON characters(status);
  `,
];

export function runMigrations() {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`[db] migración aplicada: v${v + 1}`);
  }
}
