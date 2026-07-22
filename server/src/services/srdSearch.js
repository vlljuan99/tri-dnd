// Búsqueda de texto completo del compendio sobre la tabla virtual FTS5
// `srd_fts` (creada en la migración v48). El índice se puebla desde aquí —no
// desde la migración— porque aplanar la prosa de cada entrada necesita lógica
// JS (services/srdShape.js) que no cabe en SQL puro. Reconstruirlo es barato
// (unos pocos miles de filas) y idempotente.
import { db } from '../db.js';
import { buildSearchText, collectReferenceIndexes } from './srdShape.js';

const SRD_FTS_VERSION = '2';

// Rehace el índice entero a partir de srd_entries. Se llama al sincronizar el
// SRD (sync-srd.js) y como red de seguridad al arrancar si está desfasado.
export function rebuildSrdFts() {
  const rows = db.prepare('SELECT category, idx, name_en, name_es, desc_es, data FROM srd_entries').all();
  const translatedNames = new Map();
  for (const row of rows) {
    if (!row.name_es) continue;
    const names = translatedNames.get(row.idx) ?? new Set();
    names.add(row.name_es);
    translatedNames.set(row.idx, names);
  }
  const insert = db.prepare('INSERT INTO srd_fts (category, idx, text) VALUES (?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM srd_fts').run();
    for (const row of rows) {
      let data = {};
      try {
        data = JSON.parse(row.data);
      } catch {
        data = {};
      }
        const relatedNames = [...collectReferenceIndexes(data)].flatMap((index) =>
          [...(translatedNames.get(index) ?? [])]
        );
        const text = buildSearchText(data, {
          nameEs: row.name_es,
          nameEn: row.name_en,
          descEs: row.desc_es,
          relatedNames,
        });
      insert.run(row.category, row.idx, text);
    }
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('srd_fts_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(SRD_FTS_VERSION);
  })();
  return rows.length;
}

// Rellena el índice si el número de filas no coincide con srd_entries (base
// recién migrada, sincronización previa a esta función, o índice a medias).
// No hace nada en el caso normal —ya poblado—, así que es seguro en cada boot.
export function ensureSrdFtsPopulated() {
  const entries = db.prepare('SELECT COUNT(*) AS n FROM srd_entries').get().n;
  if (entries === 0) return; // nada que indexar hasta el primer sync-srd
  const indexed = db.prepare('SELECT COUNT(*) AS n FROM srd_fts').get().n;
  const version = db.prepare("SELECT value FROM meta WHERE key = 'srd_fts_version'").get()?.value;
  if (indexed === entries && version === SRD_FTS_VERSION) return;
  const built = rebuildSrdFts();
  console.log(`[srd] índice de búsqueda reconstruido: ${built} entradas`);
}

// Traduce el texto libre del usuario a una consulta MATCH de FTS5: cada palabra
// se convierte en una búsqueda por prefijo entre comillas (que además escapa
// cualquier carácter especial), unidas por AND. "bola fue" → "bola"* AND "fue"*
export function ftsQueryString(q) {
  const tokens = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' AND ');
}

// Filas de srd_entries que casan con `q`, ordenadas por relevancia (bm25).
// Devuelve [] si la consulta no tiene términos alfanuméricos utilizables.
export function searchSrdRows(q, { categories = [], limit = 5000 } = {}) {
  const match = ftsQueryString(q);
  if (!match) return [];
  const selected = Array.isArray(categories) ? categories.filter(Boolean) : [];
  const categoryClause = selected.length
    ? `AND e.category IN (${selected.map(() => '?').join(', ')})`
    : '';
  return db
    .prepare(
      `SELECT e.*
         FROM srd_fts
         JOIN srd_entries e ON e.category = srd_fts.category AND e.idx = srd_fts.idx
        WHERE srd_fts MATCH ?
          ${categoryClause}
        ORDER BY bm25(srd_fts)
        LIMIT ?`
    )
    .all(match, ...selected, Math.max(1, Math.min(Number(limit) || 5000, 10_000)));
}
