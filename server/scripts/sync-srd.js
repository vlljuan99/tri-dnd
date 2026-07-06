// Sincronización manual del SRD 5e (dnd5eapi.co) a SQLite.
// Descarga las categorías relevantes, aplica las traducciones de data/translations/es.json
// y guarda todo en la tabla srd_entries. Re-ejecutable: hace upsert de cada entrada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, runMigrations } from '../src/db.js';

runMigrations();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://www.dnd5eapi.co';
const CONCURRENCY = 8;

const CATEGORIES = [
  'ability-scores',
  'classes',
  'conditions',
  'damage-types',
  'equipment',
  'magic-schools',
  'monsters',
  'races',
  'skills',
  'spells',
  'weapon-properties',
];

const translations = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/translations/es.json'), 'utf-8')
);

async function fetchJson(url, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const upsert = db.prepare(`
  INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data)
  VALUES (@category, @idx, @nameEn, @nameEs, @descEs, @data)
  ON CONFLICT (category, idx) DO UPDATE SET
    name_en = excluded.name_en,
    name_es = excluded.name_es,
    desc_es = excluded.desc_es,
    data = excluded.data
`);

async function syncCategory(category) {
  const list = await fetchJson(`${BASE}/api/2014/${category}`);
  const refs = list.results ?? [];
  process.stdout.write(`  ${category}: ${refs.length} entradas`);

  let done = 0;
  const entries = await mapWithConcurrency(refs, CONCURRENCY, async (ref) => {
    const data = await fetchJson(`${BASE}${ref.url}`);
    done++;
    if (done % 50 === 0) process.stdout.write('.');
    return data;
  });

  const t = translations[category] ?? {};
  db.transaction(() => {
    for (const data of entries) {
      const tr = t[data.index] ?? {};
      upsert.run({
        category,
        idx: data.index,
        nameEn: data.name,
        nameEs: tr.name ?? null,
        descEs: tr.desc ?? null,
        data: JSON.stringify(data),
      });
    }
  })();

  const translated = entries.filter((e) => t[e.index]?.name).length;
  console.log(` — guardadas (${translated} con nombre en español)`);
}

async function main() {
  console.log(`Sincronizando SRD 5e desde ${BASE} ...`);
  for (const category of CATEGORIES) {
    await syncCategory(category);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('srd_last_sync', datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run();
  const total = db.prepare('SELECT COUNT(*) AS n FROM srd_entries').get().n;
  console.log(`Listo: ${total} entradas en el compendio.`);
}

main().catch((err) => {
  console.error('Error durante la sincronización:', err.message);
  process.exit(1);
});
