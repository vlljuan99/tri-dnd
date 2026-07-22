// Sincronización manual del SRD 5e 2014 (dnd5eapi.co) a SQLite.
// Descarga el catálogo completo, aplica data/translations/es.json y guarda
// todo localmente. La aplicación nunca consulta la API externa en runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, runMigrations } from '../src/db.js';
import { SRD_CATEGORY_KEYS } from '../src/services/srdShape.js';
import { rebuildSrdFts } from '../src/services/srdSearch.js';

runMigrations();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://www.dnd5eapi.co';
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 20_000;

const translations = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/translations/es.json'), 'utf-8')
);

async function fetchJson(url, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= retries) {
        const reason = error.name === 'AbortError' ? 'tiempo de espera agotado' : error.message;
        throw new Error(`${reason} en ${url}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Espera a todos los workers incluso si falla una entrada. Así se guardan las
// demás y se pueden sincronizar las categorías posteriores; el proceso acaba
// con código de error para dejar claro que el catálogo quedó incompleto.
async function mapWithConcurrencySettled(items, limit, fn) {
  const results = new Array(items.length);
  const errors = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        errors.push({ item: items[index], error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return { results: results.filter(Boolean), errors };
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

function translatedDescription(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n\n') || null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function syncCategory(category) {
  const list = await fetchJson(`${BASE}/api/2014/${category}`);
  const refs = Array.isArray(list.results) ? list.results : [];
  process.stdout.write(`  ${category}: ${refs.length} entradas`);

  let done = 0;
  const { results: entries, errors } = await mapWithConcurrencySettled(
    refs,
    CONCURRENCY,
    async (ref) => {
      const url = new URL(ref.url, BASE).toString();
      const detail = await fetchJson(url);
      const data = {
        ...detail,
        index: detail.index ?? ref.index,
        name: detail.name ?? ref.name,
      };
      if (!data.index || !data.name) throw new Error(`Entrada sin índice o nombre en ${url}`);
      done++;
      if (done % 50 === 0) process.stdout.write('.');
      return data;
    }
  );

  const categoryTranslations = translations[category] ?? {};
  db.transaction(() => {
    for (const data of entries) {
      const translation = categoryTranslations[data.index] ?? {};
      upsert.run({
        category,
        idx: data.index,
        nameEn: data.name,
        nameEs: translation.name ?? null,
        descEs: translatedDescription(translation.desc),
        data: JSON.stringify(data),
      });
    }
  })();

  const translated = entries.filter((entry) => categoryTranslations[entry.index]?.name).length;
  const failed = errors.length ? `; ${errors.length} no se pudieron descargar` : '';
  console.log(` — guardadas ${entries.length} (${translated} con nombre en español${failed})`);
  return errors.map(({ item, error }) => ({
    category,
    index: item?.index ?? 'desconocido',
    message: error.message,
  }));
}

async function main() {
  console.log(`Sincronizando el catálogo completo del SRD 5e 2014 desde ${BASE}…`);
  const failures = [];

  for (const category of SRD_CATEGORY_KEYS) {
    try {
      failures.push(...await syncCategory(category));
    } catch (error) {
      failures.push({ category, index: '*', message: error.message });
      console.error(`  ${category}: no se pudo sincronizar (${error.message})`);
    }
  }

  const counts = db
    .prepare('SELECT category, COUNT(*) AS n FROM srd_entries GROUP BY category ORDER BY category')
    .all();
  const total = counts.reduce((sum, row) => sum + row.n, 0);

  if (failures.length) {
    const summary = `${failures.length} descargas fallidas; ${total} entradas locales disponibles`;
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('srd_last_sync_error', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run(summary);
    console.error(`Sincronización incompleta: ${summary}.`);
    process.exitCode = 1;
    return;
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('srd_last_sync', datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run();
    db.prepare("DELETE FROM meta WHERE key = 'srd_last_sync_error'").run();
  })();
  rebuildSrdFts();
  console.log(`Listo: ${total} entradas en ${counts.length} categorías del compendio (índice de búsqueda reconstruido).`);
}

main().catch((error) => {
  console.error('Error durante la sincronización:', error.message);
  process.exit(1);
});
