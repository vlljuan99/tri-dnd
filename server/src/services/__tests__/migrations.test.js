// Una migración nunca puede llevarse por delante datos de partidas jugadas.
// La v70 (competencia real de armas y armaduras) llegó a borrar la tabla de
// personajes; aquí se comprueba que reconstruye esa competencia desde la clase
// en vez de vaciar la beta.
//
// Se aplica sobre una base TEMPORAL: se ejecutan las migraciones anteriores,
// se siembra el estado que tendría una mesa en marcha y solo entonces se
// aplica la que se quiere probar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const V70 = 70;

function applyUpTo(db, migrations, version) {
  for (let i = 0; i < version; i++) {
    const migration = migrations[i];
    if (typeof migration === 'function') migration(db);
    else db.exec(migration);
  }
}

test('la migración v70 conserva las fichas y les deriva su competencia', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tridnd-mig-'));
  // db.js abre la base al importarse: se le da una carpeta temporal para no
  // tocar la del desarrollador.
  process.env.TRIDND_DATA_DIR = dir;
  const { migrations, db: appDb } = await import('../../db.js');

  const db = new Database(path.join(dir, 'probe.db'));
  try {
    applyUpTo(db, migrations, V70 - 1);

    db.prepare(
      "INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES ('classes', 'fighter', 'Fighter', NULL, NULL, ?)"
    ).run(JSON.stringify({ index: 'fighter', proficiencies: [{ index: 'all-armor' }, { index: 'martial-weapons' }] }));
    db.prepare(
      "INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES ('proficiencies', 'martial-weapons', 'Martial Weapons', NULL, NULL, ?)"
    ).run(JSON.stringify({ index: 'martial-weapons', type: 'Weapons', reference: { index: 'martial-weapons' } }));

    db.prepare(
      "INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'veterana', 'Veterana', 'x')"
    ).run();
    const veterana = db
      .prepare(
        "INSERT INTO characters (user_id, name, class_index, level, status, kind) VALUES (1, 'Brunilda', 'fighter', 4, 'complete', 'pj')"
      )
      .run().lastInsertRowid;
    const sinClase = db
      .prepare("INSERT INTO characters (user_id, name, level, status, kind) VALUES (1, 'Borrador', 1, 'draft', 'pj')")
      .run().lastInsertRowid;

    // La migración que se está probando.
    const v70 = migrations[V70 - 1];
    if (typeof v70 === 'function') v70(db);
    else db.exec(v70);

    const filas = db.prepare('SELECT id, name, weapon_proficiencies, armor_proficiencies FROM characters ORDER BY id').all();
    assert.equal(filas.length, 2, 'las fichas de la beta siguen ahí');

    const guerrera = filas.find((row) => row.id === Number(veterana));
    assert.deepEqual(JSON.parse(guerrera.weapon_proficiencies), ['martial-weapons'], 'competencia derivada de su clase');
    assert.deepEqual(JSON.parse(guerrera.armor_proficiencies), ['all-armor']);

    const borrador = filas.find((row) => row.id === Number(sinClase));
    assert.deepEqual(JSON.parse(borrador.weapon_proficiencies), [], 'sin clase no consta ninguna, que es lo que significa');
    assert.deepEqual(JSON.parse(borrador.armor_proficiencies), []);
  } finally {
    db.close();
    // En Windows el fichero sigue bloqueado mientras haya una conexión
    // abierta: db.js abrió la suya al importarse.
    appDb.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// La v78 enlaza cada mapa con el escenario de fábrica del que salió para
// pintar sus figuras con las imágenes del administrador. Las escaramuzas ya
// montadas se reconocen por el nombre estable del mapa; una campaña que
// casualmente llame igual a un mapa suyo no debe heredar nada.
test('la migración v78 enlaza las escaramuzas ya montadas con su escenario', async () => {
  const V78 = 78;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tridnd-mig-'));
  process.env.TRIDND_DATA_DIR ??= dir;
  const { migrations } = await import('../../db.js');

  const db = new Database(path.join(dir, 'probe.db'));
  try {
    applyUpTo(db, migrations, V78 - 1);
    db.prepare(
      "INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'veterana', 'Veterana', 'x')"
    ).run();
    const campaign = (name, type) =>
      Number(
        db
          .prepare("INSERT INTO campaigns (name, dm_user_id, invite_code, campaign_type) VALUES (?, 1, ?, ?)")
          .run(name, `C${Math.random().toString(36).slice(2, 8)}`, type).lastInsertRowid
      );
    const map = (campaignId, name) =>
      Number(db.prepare('INSERT INTO maps (campaign_id, name) VALUES (?, ?)').run(campaignId, name).lastInsertRowid);

    const paso = map(campaign('Emboscada', 'escaramuza'), 'Paso del Cuervo');
    const cripta = map(campaign('Cripta', 'escaramuza'), 'Cripta de los Doce Silentes');
    const fundicion = map(campaign('Fundición', 'escaramuza'), 'Fundición de Escoria Roja');
    const propio = map(campaign('Mesa propia', 'escaramuza'), 'Sótano');
    const homonimo = map(campaign('Campaña larga', 'campana'), 'Paso del Cuervo');

    const v78 = migrations[V78 - 1];
    if (typeof v78 === 'function') v78(db);
    else db.exec(v78);

    const presetOf = (id) => db.prepare('SELECT skirmish_preset_id FROM maps WHERE id = ?').get(id).skirmish_preset_id;
    assert.equal(presetOf(paso), 'paso-del-cuervo');
    assert.equal(presetOf(cripta), 'cripta-anegada');
    assert.equal(presetOf(fundicion), 'puente-igneo');
    assert.equal(presetOf(propio), null, 'un mapa propio no sale de ningún escenario');
    assert.equal(presetOf(homonimo), null, 'una campaña no es una escaramuza aunque su mapa se llame igual');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'skirmish_figure_images'").get().n,
      1
    );
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
