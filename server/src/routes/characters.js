import { Router, raw as expressRaw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { AVATAR_UPLOADS_DIR } from '../config.js';
import { extensionForMimeType } from '../utils/uploads.js';
import { generateAvatarImage } from '../services/avatarImageGeneration.js';
import { notifyCampaignMap, notifyCombat, notifyCombatVisual, postSystemMessage } from '../services/liveMap.js';
import { resetDeathSaves, startDeathSaves } from '../services/turnEconomy.js';
import { DEATH_STATES } from '../services/combatLifecycle.js';
import { computeArmorClass, validateInventory } from '../rules/equipment.js';
import { combatProficienciesForClass } from '../services/classProficiencies.js';
import {
  canLevelUp,
  grantedLevelFor,
  levelHistory,
  levelUpCharacter,
  levelUpPreview,
} from '../services/leveling.js';
import { restStateFor, spendHitDice } from '../services/rest.js';

export const charactersRouter = Router();
charactersRouter.use(requireAuth);

// Campos JSON del personaje: se guardan como texto y se sirven parseados
const JSON_FIELDS = [
  'abilities',
  'save_proficiencies',
  'skill_proficiencies',
  'weapon_proficiencies',
  'armor_proficiencies',
  'inventory',
  'spells',
  'other_proficiencies',
  'wizard_data',
  'custom_sections',
];
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const DM_CATEGORIES = new Set(['enemigo', 'jefe', 'pnj']);

function serialize(row) {
  const c = { ...row };
  for (const f of JSON_FIELDS) c[f] = JSON.parse(row[f]);
  return c;
}

function getOwned(req, res) {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Personaje no encontrado' });
    return null;
  }
  if (row.user_id !== req.user.id) {
    res.status(403).json({ error: 'Este personaje no es tuyo' });
    return null;
  }
  return row;
}

charactersRouter.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.user.id);
  res.json({ characters: rows.map(serialize) });
});

charactersRouter.post('/', (req, res) => {
  const { name, kind, dm_category: dmCategory } = req.body ?? {};
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  const isBoss = kind === 'boss';
  const cleanDmCategory = isBoss && DM_CATEGORIES.has(dmCategory) ? dmCategory : isBoss ? 'jefe' : null;
  // Todo PJ nuevo nace como borrador: el cliente debe llevarlo al asistente
  // guiado en vez de abrir la ficha completa vacía. Un jefe/boss no pasa por
  // el asistente (no elige clase/raza del SRD) — nace "completo" y el DM
  // rellena su ficha directamente (stats, avatar, notas).
  const info = db
    .prepare('INSERT INTO characters (user_id, name, status, kind, dm_category) VALUES (?, ?, ?, ?, ?)')
    .run(
      req.user.id,
      trimmed || (cleanDmCategory === 'enemigo' ? 'Nuevo enemigo' : cleanDmCategory === 'pnj' ? 'Nuevo PNJ' : isBoss ? 'Nuevo jefe' : 'Nuevo personaje'),
      isBoss ? 'complete' : 'draft',
      isBoss ? 'boss' : 'pj',
      cleanDmCategory
    );
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ character: serialize(row) });
});

// Lectura: cualquier usuario autenticado (las fichas de compañeros se ven en solo lectura)
charactersRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Personaje no encontrado' });
  // Las fichas de enemigos/PNJ contienen CA, PG y notas privadas del DM. A
  // diferencia de un PJ compañero, nunca se sirven a otro usuario.
  if (row.kind === 'boss' && row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Personaje no encontrado' });
  }
  // La ficha viaja con su estado de nivel (Fase D): hasta dónde ha concedido
  // la campaña, qué ganaría al subir y qué subidas lleva. Solo su dueño lo
  // necesita — a un compañero no le hace falta el detalle.
  const own = row.user_id === req.user.id;
  res.json({
    character: serialize(row),
    editable: own,
    leveling: own && row.kind === 'pj'
      ? {
          grantedLevel: grantedLevelFor(row),
          canLevelUp: canLevelUp(row),
          preview: levelUpPreview(row),
          history: levelHistory(row.id),
        }
      : null,
    // Estado de descanso (Fase F): dados de golpe disponibles y su dado.
    rest: own && row.kind === 'pj' ? restStateFor(row) : null,
  });
});

// Gastar dados de golpe para curarse (Fase F). Es la mitad del descanso corto
// que decide cada jugador: el servidor comprueba cuántos quedan, cuánto cura
// cada uno y que no se pase de los PG máximos.
charactersRouter.post('/:id/dados-de-golpe', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  const result = spendHitDice(row.id, req.body?.rolls);
  if (!result.ok) return res.status(400).json({ error: result.error });

  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id);
  if (updated.campaign_id) {
    notifyCampaignMap(updated.campaign_id);
    notifyCombat(updated.campaign_id);
  }
  res.json({ character: serialize(updated), healed: result.healed, hitDice: result.hitDice });
});

// Subir de nivel (Fase D): solo hasta donde el DM haya concedido, y con los
// PG por el camino que elija el jugador — valor fijo (por defecto en la mesa)
// o tirada del dado de golpe.
charactersRouter.post('/:id/subir-nivel', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  const { hpMethod = 'fijo', hpRoll = null, abilityIncreases = null } = req.body ?? {};
  const result = levelUpCharacter(row.id, { hpMethod, hpRoll, abilityIncreases });
  if (!result.ok) return res.status(400).json({ error: result.error });

  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id);
  if (updated.campaign_id) {
    // La mesa ve el cambio sin recargar: PG nuevos en las barras y nivel
    // nuevo en el tracker.
    notifyCampaignMap(updated.campaign_id);
    notifyCombat(updated.campaign_id);
    postSystemMessage(updated.campaign_id, `${updated.name} sube a nivel ${updated.level}.`);
  }
  res.json({ character: serialize(updated), gained: result.gained, history: levelHistory(row.id) });
});

// Subida de una foto propia como icono del personaje. Se envía como binario
// crudo (no JSON) para no limitar el body-parser global de la API.
charactersRouter.patch(
  '/:id/avatar',
  expressRaw({ type: () => true, limit: '8mb' }),
  (req, res) => {
    const row = getOwned(req, res);
    if (!row) return;

    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'El archivo debe ser una imagen' });
    }
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }

    const filename = `character-${row.id}-${Date.now()}${extensionForMimeType(contentType)}`;
    fs.writeFileSync(path.join(AVATAR_UPLOADS_DIR, filename), buffer);
    const avatarUrl = `/uploads/avatars/${filename}`;

    db.prepare("UPDATE characters SET avatar_path = ?, updated_at = datetime('now') WHERE id = ?").run(
      avatarUrl,
      row.id
    );
    res.json({ character: serialize(db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id)) });
  }
);

charactersRouter.delete('/:id/avatar', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  db.prepare("UPDATE characters SET avatar_path = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ character: serialize(db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id)) });
});

charactersRouter.post('/:id/avatar/generar', async (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;

  const { prompt, provider } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 400) : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Describe el aspecto de tu personaje' });

  try {
    const generated = await generateAvatarImage(provider, cleanPrompt);
    const filename = `character-${row.id}-${Date.now()}.png`;
    fs.writeFileSync(path.join(AVATAR_UPLOADS_DIR, filename), generated.buffer);
    const avatarUrl = `/uploads/avatars/${filename}`;

    db.prepare("UPDATE characters SET avatar_path = ?, updated_at = datetime('now') WHERE id = ?").run(
      avatarUrl,
      row.id
    );
    res.json({ character: serialize(db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id)) });
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo generar el icono' });
  }
});

const UPDATABLE = {
  name: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 60,
  class_index: (v) => v === null || typeof v === 'string',
  race_index: (v) => v === null || typeof v === 'string',
  campaign_id: (v) => v === null || Number.isInteger(v),
  level: (v) => Number.isInteger(v) && v >= 1 && v <= 20,
  hp_max: (v) => Number.isInteger(v) && v >= 0 && v <= 999,
  hp_current: (v) => Number.isInteger(v) && v >= 0 && v <= 999,
  hp_temp: (v) => Number.isInteger(v) && v >= 0 && v <= 999,
  // Para un PJ, la CA la calcula el servidor a partir del inventario
  // (ac_override fuerza un valor manual); solo las fichas del DM (jefe,
  // enemigo, PNJ) siguen escribiendo `ac` directamente, ver el PUT abajo.
  ac: (v) => Number.isInteger(v) && v >= 0 && v <= 40,
  ac_override: (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 40),
  speed: (v) => Number.isInteger(v) && v >= 0 && v <= 300,
  darkvision: (v) => Number.isInteger(v) && v >= 0 && v <= 30,
  abilities: (v) =>
    v && typeof v === 'object' && ABILITY_KEYS.every((k) => Number.isInteger(v[k]) && v[k] >= 1 && v[k] <= 30),
  save_proficiencies: (v) => Array.isArray(v) && v.every((s) => ABILITY_KEYS.includes(s)),
  skill_proficiencies: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  // Competencia real de armas/armaduras (Fase B): tokens del compendio
  // ("simple-weapons", "dagger", "light-armor", "all-armor"...), resueltos
  // por el asistente desde la clase y guardados aquí para que el servidor
  // valide el ataque sin volver a consultar el SRD.
  weapon_proficiencies: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string') && JSON.stringify(v).length < 5000,
  armor_proficiencies: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string') && JSON.stringify(v).length < 2000,
  other_proficiencies: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string') && JSON.stringify(v).length < 5000,
  inventory: (v) => validateInventory(v),
  spells: (v) => v && typeof v === 'object' && JSON.stringify(v).length < 50000,
  features: (v) => typeof v === 'string' && v.length <= 20000,
  notes: (v) => typeof v === 'string' && v.length <= 20000,
  // Secciones dinámicas de la ficha (Fase 21): bloques que el jugador crea y
  // nombra a su gusto. Cada bloque: id, title, type ('texto'|'lista'|'srd') y
  // content (string / array de strings / array de {index,name,category}).
  custom_sections: (v) =>
    Array.isArray(v) &&
    v.length <= 40 &&
    v.every(
      (s) =>
        s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.title === 'string' &&
        s.title.length <= 120 &&
        ['texto', 'lista', 'srd'].includes(s.type)
    ) &&
    JSON.stringify(v).length < 60000,
  background: (v) => typeof v === 'string' && v.length <= 2000,
  alignment: (v) => typeof v === 'string' && v.length <= 100,
  pronouns: (v) => typeof v === 'string' && v.length <= 100,
  avatar_path: (v) => v === null || (typeof v === 'string' && v.length <= 300),
  status: (v) => v === 'draft' || v === 'complete',
  wizard_step: (v) => Number.isInteger(v) && v >= 0 && v <= 10,
  wizard_data: (v) => v && typeof v === 'object' && JSON.stringify(v).length < 20000,
  dm_category: (v) => DM_CATEGORIES.has(v),
};

// Requisitos mínimos para marcar un personaje como completo: identidad y
// elecciones esenciales ya hechas. No repite el motor de reglas del asistente,
// solo evita guardar un "completo" a medias por un error de cliente.
function canComplete(row, updates) {
  const merged = { ...row, ...updates };
  return (
    typeof merged.name === 'string' &&
    merged.name.trim().length > 0 &&
    typeof merged.class_index === 'string' &&
    merged.class_index &&
    typeof merged.race_index === 'string' &&
    merged.race_index &&
    Number.isInteger(merged.level) &&
    merged.level >= 1
  );
}

charactersRouter.put('/:id', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;

  const updates = [];
  const values = [];
  const plainUpdates = {};
  for (const [key, validate] of Object.entries(UPDATABLE)) {
    if (!(key in (req.body ?? {}))) continue;
    const value = req.body[key];
    if (!validate(value)) return res.status(400).json({ error: `Valor no válido para "${key}"` });
    if (key === 'dm_category' && row.kind !== 'boss') {
      return res.status(400).json({ error: 'Solo las fichas del DM se pueden clasificar así' });
    }
    if (key === 'ac' && row.kind !== 'boss') {
      return res.status(400).json({
        error: 'La CA de un personaje jugador se calcula sola a partir del equipo; usa "ac_override" para forzarla',
      });
    }
    // Fase D: el nivel de un PJ no lo escribe nadie a mano. Lo fija la
    // campaña como nivel inicial mientras la ficha es un borrador y lo sube
    // el jugador desde «Subir de nivel» cuando el DM lo concede. Solo las
    // fichas del DM (jefe, enemigo, PNJ) lo conservan editable.
    if (key === 'level' && row.kind !== 'boss') {
      return res.status(400).json({
        error: 'El nivel de un personaje jugador lo fija su campaña: súbelo desde «Subir de nivel»',
      });
    }
    if (key === 'campaign_id' && value !== null) {
      const member = db
        .prepare('SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
        .get(value, req.user.id);
      if (!member) return res.status(400).json({ error: 'No perteneces a esa campaña' });
    }
    plainUpdates[key] = value;
    updates.push(`${key} = ?`);
    values.push(JSON_FIELDS.includes(key) ? JSON.stringify(value) : value);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  if (plainUpdates.status === 'complete' && !canComplete(row, plainUpdates)) {
    return res.status(400).json({
      error: 'Faltan datos obligatorios (nombre, clase, raza o nivel) para completar el personaje',
    });
  }

  // Competencia de armas/armaduras derivada (Fase B): la concede la clase, no
  // el cliente. El asistente las manda para poder pintarlas mientras rellena
  // la ficha, pero aquí se vuelven a resolver desde el compendio; si no, un
  // PUT a mano bastaría para ser competente con todo. Las fichas del DM
  // (jefe/enemigo/PNJ) no pasan por el asistente y quedan como estén.
  if (row.kind !== 'boss' && ['class_index', 'weapon_proficiencies', 'armor_proficiencies'].some((k) => k in plainUpdates)) {
    const classIndex = 'class_index' in plainUpdates ? plainUpdates.class_index : row.class_index;
    const { weaponProficiencies, armorProficiencies } = combatProficienciesForClass(classIndex);
    for (const [key, value] of [
      ['weapon_proficiencies', weaponProficiencies],
      ['armor_proficiencies', armorProficiencies],
    ]) {
      plainUpdates[key] = value;
      if (!updates.includes(`${key} = ?`)) {
        updates.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        values[updates.indexOf(`${key} = ?`)] = JSON.stringify(value);
      }
    }
  }

  // Nivel inicial derivado (Fase D): mientras la ficha de un PJ es un
  // borrador, su nivel es el que fija su campaña. Un personaje ya terminado
  // NO se recalcula al entrar en otra mesa: llega con el suyo, y solo sube
  // por milestone.
  if (row.kind !== 'boss' && row.status !== 'complete' && 'campaign_id' in plainUpdates) {
    const campaign = plainUpdates.campaign_id
      ? db.prepare('SELECT starting_level FROM campaigns WHERE id = ?').get(plainUpdates.campaign_id)
      : null;
    const startingLevel = campaign?.starting_level ?? 1;
    if (startingLevel !== row.level) {
      plainUpdates.level = startingLevel;
      updates.push('level = ?');
      values.push(startingLevel);
    }
  }

  // CA derivada (Fase A): cualquier cambio que pueda afectarla se recalcula
  // en el servidor, nunca se confía en lo que mande el cliente.
  if (row.kind !== 'boss' && ['inventory', 'abilities', 'ac_override'].some((k) => k in plainUpdates)) {
    const computedAc = computeArmorClass({
      abilities: plainUpdates.abilities ?? JSON.parse(row.abilities),
      inventory: plainUpdates.inventory ?? JSON.parse(row.inventory),
      ac_override: 'ac_override' in plainUpdates ? plainUpdates.ac_override : row.ac_override,
    });
    plainUpdates.ac = computedAc;
    updates.push('ac = ?');
    values.push(computedAc);
  }

  db.prepare(
    `UPDATE characters SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...values, row.id);
  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id);

  if ('hp_current' in plainUpdates && updated.campaign_id) {
    const combatant = db
      .prepare("SELECT id, death_state FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(updated.campaign_id, updated.id);
    if (combatant) {
      if (updated.hp_current > 0) resetDeathSaves(combatant.id);
      else if (row.hp_current > 0 || combatant.death_state === DEATH_STATES.NORMAL) startDeathSaves(combatant.id);
      notifyCombat(updated.campaign_id);
    }
    if (updated.hp_current > row.hp_current) {
      notifyCombatVisual(updated.campaign_id, {
        type: 'heal',
        characterId: updated.id,
        value: updated.hp_current - row.hp_current,
      });
    }
  }

  // Curarse o cambiar HP/CA desde la ficha refresca las barras del tablero
  if (
    updated.campaign_id &&
    ['hp_current', 'hp_max', 'ac', 'name', 'speed', 'darkvision'].some((k) => k in plainUpdates)
  ) {
    notifyCampaignMap(updated.campaign_id);
  }
  // Equiparse una armadura en plena mesa cambia la CA derivada: el chip del
  // HUD la lee del combatiente, así que hay que reenviar también el combate
  // (la resolución del ataque ya usaba la CA viva de la ficha).
  if (updated.campaign_id && updated.ac !== row.ac) {
    notifyCombat(updated.campaign_id);
  }
  res.json({ character: serialize(updated) });
});

charactersRouter.delete('/:id', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  db.prepare('DELETE FROM characters WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// --- Notas privadas del personaje (Fase 8.6) ------------------------------
// Diario de sesión: varias notas con título y fecha de sesión. A diferencia
// de todo lo demás en la app, esto es estrictamente del dueño del
// personaje: getOwned ya rechaza a cualquiera que no sea él, sin excepción
// para el DM (no hay "isDm" en ningún sitio de este bloque).

function serializeNote(row) {
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    sessionDate: row.session_date,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

charactersRouter.get('/:id/notas', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  const notes = db
    .prepare('SELECT * FROM character_notes WHERE character_id = ? ORDER BY id DESC')
    .all(row.id);
  res.json({ notes: notes.map(serializeNote) });
});

charactersRouter.post('/:id/notas', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  const { title, sessionDate, body } = req.body ?? {};
  const info = db
    .prepare('INSERT INTO character_notes (character_id, title, session_date, body) VALUES (?, ?, ?, ?)')
    .run(
      row.id,
      typeof title === 'string' ? title.trim().slice(0, 120) : '',
      typeof sessionDate === 'string' ? sessionDate.trim().slice(0, 40) : '',
      typeof body === 'string' ? body.slice(0, 20000) : ''
    );
  const note = db.prepare('SELECT * FROM character_notes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ note: serializeNote(note) });
});

function getOwnedNote(req, res) {
  const character = getOwned(req, res);
  if (!character) return null;
  const note = db
    .prepare('SELECT * FROM character_notes WHERE id = ? AND character_id = ?')
    .get(req.params.noteId, character.id);
  if (!note) {
    res.status(404).json({ error: 'Nota no encontrada' });
    return null;
  }
  return note;
}

charactersRouter.put('/:id/notas/:noteId', (req, res) => {
  const note = getOwnedNote(req, res);
  if (!note) return;
  const { title, sessionDate, body } = req.body ?? {};
  db.prepare(
    `UPDATE character_notes SET title = ?, session_date = ?, body = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    typeof title === 'string' ? title.trim().slice(0, 120) : note.title,
    typeof sessionDate === 'string' ? sessionDate.trim().slice(0, 40) : note.session_date,
    typeof body === 'string' ? body.slice(0, 20000) : note.body,
    note.id
  );
  const updated = db.prepare('SELECT * FROM character_notes WHERE id = ?').get(note.id);
  res.json({ note: serializeNote(updated) });
});

charactersRouter.delete('/:id/notas/:noteId', (req, res) => {
  const note = getOwnedNote(req, res);
  if (!note) return;
  db.prepare('DELETE FROM character_notes WHERE id = ?').run(note.id);
  res.json({ ok: true });
});
