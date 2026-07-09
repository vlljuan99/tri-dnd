import { db } from '../db.js';
import { buildMeta } from './srdShape.js';

// Biblioteca del DM (Fase 15): objetos y hechizos propios, por usuario. Se
// guardan con la misma forma de `data` que una entrada del SRD para
// reutilizar `buildMeta`, el detalle y el consumo desde la ficha. En los
// listados del compendio se mezclan con index sintético `custom:<id>`.

// Categoría del SRD (la de las rutas /srd/:category) → tabla propia
const TABLE_BY_CATEGORY = { equipment: 'custom_items', spells: 'custom_spells' };

export function customCategorySupported(category) {
  return category in TABLE_BY_CATEGORY;
}

// index sintético para distinguir contenido propio dentro de una categoría
export const CUSTOM_PREFIX = 'custom:';
export function isCustomIndex(idx) {
  return typeof idx === 'string' && idx.startsWith(CUSTOM_PREFIX);
}
export function customIdFromIndex(idx) {
  const n = Number(idx.slice(CUSTOM_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

export function serializeCustomEntry(row, category, { full = false } = {}) {
  const data = JSON.parse(row.data || '{}');
  const entry = {
    category,
    index: `${CUSTOM_PREFIX}${row.id}`,
    name: row.name,
    nameEn: row.name,
    translated: true, // el DM lo escribe ya en español
    custom: true,
    meta: buildMeta(category, data),
  };
  if (full) {
    entry.data = data;
    entry.descEs = null;
  }
  return entry;
}

function tableFor(category) {
  const table = TABLE_BY_CATEGORY[category];
  if (!table) throw new Error('Categoría sin biblioteca propia');
  return table;
}

// Filas propias del usuario en una categoría, con filtros equivalentes a los
// del compendio (texto, y para hechizos nivel máximo; la categoría de equipo
// se filtra por equipment_category del data)
export function listCustomRows(userId, category, { q = '', cat = null, maxLevel = null } = {}) {
  const rows = db
    .prepare(`SELECT * FROM ${tableFor(category)} WHERE user_id = ? ORDER BY name`)
    .all(userId);
  const needle = q.trim().toLowerCase();
  return rows.filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (cat || maxLevel != null) {
      const data = JSON.parse(row.data || '{}');
      if (cat && data.equipment_category?.index !== cat) return false;
      if (maxLevel != null && !(Number.isInteger(data.level) && data.level <= maxLevel)) return false;
    }
    return true;
  });
}

export function getCustomRow(userId, category, id) {
  return db.prepare(`SELECT * FROM ${tableFor(category)} WHERE id = ? AND user_id = ?`).get(id, userId);
}

export function createCustomRow(userId, category, name, data) {
  const info = db
    .prepare(`INSERT INTO ${tableFor(category)} (user_id, name, data) VALUES (?, ?, ?)`)
    .run(userId, name, JSON.stringify(data));
  return getCustomRow(userId, category, info.lastInsertRowid);
}

export function updateCustomRow(userId, category, id, name, data) {
  db.prepare(
    `UPDATE ${tableFor(category)} SET name = ?, data = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(name, JSON.stringify(data), id, userId);
  return getCustomRow(userId, category, id);
}

export function deleteCustomRow(userId, category, id) {
  return db.prepare(`DELETE FROM ${tableFor(category)} WHERE id = ? AND user_id = ?`).run(id, userId).changes > 0;
}
