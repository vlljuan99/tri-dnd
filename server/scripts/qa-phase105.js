import bcrypt from 'bcryptjs';
import { db } from '../src/db.js';

const username = 'codex_phase105';
const campaignId = 5;
const mapId = 5;
const roomId = 5;

function cleanup() {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const character = user
    ? db.prepare('SELECT id FROM characters WHERE user_id = ? AND campaign_id = ?').get(user.id, campaignId)
    : null;
  const qaTokens = db
    .prepare("SELECT id FROM map_tokens WHERE room_id = ? AND name LIKE 'QA 10.5 %'")
    .all(roomId);
  for (const token of qaTokens) {
    db.prepare('DELETE FROM combatants WHERE campaign_id = ? AND map_token_id = ?').run(campaignId, token.id);
  }
  if (character) {
    db.prepare('DELETE FROM combatants WHERE campaign_id = ? AND character_id = ?').run(campaignId, character.id);
  }
  db.prepare("DELETE FROM map_tokens WHERE room_id = ? AND name LIKE 'QA 10.5 %'").run(roomId);
  if (user) {
    db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  }
  db.prepare('UPDATE game_tables SET combat_active = 0, combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
}

if (process.argv[2] === 'cleanup') {
  cleanup();
  process.exit(0);
}
if (process.argv[2] === 'live') {
  db.prepare('UPDATE game_tables SET is_live = 1 WHERE campaign_id = ?').run(campaignId);
  process.exit(0);
}
if (process.argv[2] === 'report') {
  console.log(db.prepare(`
    SELECT category, COUNT(*) AS total,
           SUM(CASE WHEN name_es IS NOT NULL THEN 1 ELSE 0 END) AS traducidas
    FROM srd_entries
    WHERE category IN ('spells', 'monsters', 'equipment', 'conditions')
    GROUP BY category
  `).all());
  process.exit(0);
}
cleanup();

const hash = await bcrypt.hash('Prueba105!', 10);
const userId = db
  .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
  .run(username, 'Percepción QA', hash).lastInsertRowid;
db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'jugador')")
  .run(campaignId, userId);
const characterId = db
  .prepare(
    `INSERT INTO characters (user_id, campaign_id, name, level, abilities, skill_proficiencies, darkvision)
     VALUES (?, ?, ?, 5, ?, ?, 0)`
  )
  .run(
    userId,
    campaignId,
    'Exploradora QA 10.5',
    JSON.stringify({ str: 10, dex: 12, con: 12, int: 10, wis: 20, cha: 10 }),
    JSON.stringify(['perception'])
  ).lastInsertRowid;
db.prepare('INSERT INTO map_character_tokens (map_id, character_id, room_id, x, y) VALUES (?, ?, ?, 1, 1)')
  .run(mapId, characterId, roomId);
db.prepare(
  `INSERT INTO map_tokens (room_id, kind, name, x, y, hidden, perception_dc, vision_radius)
   VALUES (?, 'enemigo', 'QA 10.5 Centinela', 6, 3, 0, NULL, 4)`
).run(roomId);
db.prepare(
  `INSERT INTO map_tokens (room_id, kind, name, x, y, hidden, perception_dc, vision_radius)
   VALUES (?, 'trampa', 'QA 10.5 Placa oculta', 2, 1, 1, 1, 6)`
).run(roomId);

console.log(JSON.stringify({ userId, characterId }));
