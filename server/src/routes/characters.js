import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

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
  const { name } = req.body ?? {};
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  // Todo personaje nuevo nace como borrador: el cliente debe llevarlo al
  // asistente guiado en vez de abrir la ficha completa vacía.
  const info = db
    .prepare("INSERT INTO characters (user_id, name, status) VALUES (?, ?, 'draft')")
    .run(req.user.id, trimmed || 'Nuevo personaje');
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ character: serialize(row) });
});

// Lectura: cualquier usuario autenticado (las fichas de compañeros se ven en solo lectura)
charactersRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Personaje no encontrado' });
  res.json({ character: serialize(row), editable: row.user_id === req.user.id });
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
  res.json({ character: serialize(updated) });
});

charactersRouter.delete('/:id', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  db.prepare('DELETE FROM characters WHERE id = ?').run(row.id);
  res.json({ ok: true });
});
