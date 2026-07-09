import { Router, raw as expressRaw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { AVATAR_UPLOADS_DIR } from '../config.js';
import { extensionForMimeType } from '../utils/uploads.js';
import { generateAvatarImage } from '../services/avatarImageGeneration.js';
import { notifyCampaignMap } from '../services/liveMap.js';

export const charactersRouter = Router();
charactersRouter.use(requireAuth);

// Campos JSON del personaje: se guardan como texto y se sirven parseados
const JSON_FIELDS = [
  'abilities',
  'save_proficiencies',
  'skill_proficiencies',
  'inventory',
  'spells',
  'other_proficiencies',
  'wizard_data',
];
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

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
  const { name, kind } = req.body ?? {};
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  const isBoss = kind === 'boss';
  // Todo PJ nuevo nace como borrador: el cliente debe llevarlo al asistente
  // guiado en vez de abrir la ficha completa vacía. Un jefe/boss no pasa por
  // el asistente (no elige clase/raza del SRD) — nace "completo" y el DM
  // rellena su ficha directamente (stats, avatar, notas).
  const info = db
    .prepare('INSERT INTO characters (user_id, name, status, kind) VALUES (?, ?, ?, ?)')
    .run(req.user.id, trimmed || (isBoss ? 'Nuevo jefe' : 'Nuevo personaje'), isBoss ? 'complete' : 'draft', isBoss ? 'boss' : 'pj');
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ character: serialize(row) });
});

// Lectura: cualquier usuario autenticado (las fichas de compañeros se ven en solo lectura)
charactersRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Personaje no encontrado' });
  res.json({ character: serialize(row), editable: row.user_id === req.user.id });
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
  hp_current: (v) => Number.isInteger(v) && v >= -99 && v <= 999,
  hp_temp: (v) => Number.isInteger(v) && v >= 0 && v <= 999,
  ac: (v) => Number.isInteger(v) && v >= 0 && v <= 40,
  speed: (v) => Number.isInteger(v) && v >= 0 && v <= 300,
  darkvision: (v) => Number.isInteger(v) && v >= 0 && v <= 30,
  abilities: (v) =>
    v && typeof v === 'object' && ABILITY_KEYS.every((k) => Number.isInteger(v[k]) && v[k] >= 1 && v[k] <= 30),
  save_proficiencies: (v) => Array.isArray(v) && v.every((s) => ABILITY_KEYS.includes(s)),
  skill_proficiencies: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  other_proficiencies: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string') && JSON.stringify(v).length < 5000,
  inventory: (v) => Array.isArray(v) && JSON.stringify(v).length < 50000,
  spells: (v) => v && typeof v === 'object' && JSON.stringify(v).length < 50000,
  features: (v) => typeof v === 'string' && v.length <= 20000,
  notes: (v) => typeof v === 'string' && v.length <= 20000,
  background: (v) => typeof v === 'string' && v.length <= 2000,
  alignment: (v) => typeof v === 'string' && v.length <= 100,
  pronouns: (v) => typeof v === 'string' && v.length <= 100,
  avatar_path: (v) => v === null || (typeof v === 'string' && v.length <= 300),
  status: (v) => v === 'draft' || v === 'complete',
  wizard_step: (v) => Number.isInteger(v) && v >= 0 && v <= 10,
  wizard_data: (v) => v && typeof v === 'object' && JSON.stringify(v).length < 20000,
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

  db.prepare(
    `UPDATE characters SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...values, row.id);
  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id);

  // Curarse o cambiar HP/CA desde la ficha refresca las barras del tablero
  if (
    updated.campaign_id &&
    ['hp_current', 'hp_max', 'ac', 'name', 'speed', 'darkvision'].some((k) => k in plainUpdates)
  ) {
    notifyCampaignMap(updated.campaign_id);
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
