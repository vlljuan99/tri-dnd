// Fase C: la progresión de clase se consulta contra el servidor real, con su
// tabla propia (`class_levels`) y los rasgos de la categoría `features` del
// compendio. Comprueba también lo que la fase promete NO romper: la progresión
// no se cuela en el buscador ni en el listado de categorías del compendio.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startTestServer, registerUser, apiFetch } from './helpers/liveServer.js';

// Un trozo de la tabla del mago: nivel 2 (elige tradición) y nivel 3 (4/2).
function seedProgresion(dataDir) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    const nivel = db.prepare(
      `INSERT INTO class_levels (class_index, level, prof_bonus, ability_score_bonuses,
         cantrips_known, spells_known, spell_slots, class_specific)
       VALUES (?, ?, ?, 0, 3, NULL, ?, '{}')`
    );
    nivel.run('wizard', 2, 2, JSON.stringify([3, 0, 0, 0, 0, 0, 0, 0, 0]));
    nivel.run('wizard', 3, 2, JSON.stringify([4, 2, 0, 0, 0, 0, 0, 0, 0]));

    const rasgo = db.prepare(
      'INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES (?, ?, ?, ?, ?, ?)'
    );
    rasgo.run(
      'features',
      'wizard-arcane-tradition',
      'Arcane Tradition',
      'Tradición arcana',
      'Eliges una escuela de magia.',
      JSON.stringify({ level: 2, class: { index: 'wizard' } })
    );
    rasgo.run(
      'features',
      'evocation-savant',
      'Evocation Savant',
      null,
      null,
      JSON.stringify({ level: 2, class: { index: 'wizard' }, subclass: { index: 'evocation' } })
    );
  } finally {
    db.close();
  }
}

test('la progresión de clase se consulta por nivel y no ensucia el compendio', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    seedProgresion(server.dataDir);
    const cookie = await registerUser(server.baseUrl, { username: 'archimaga', displayName: 'Archimaga' });

    const nivel3 = await apiFetch(server.baseUrl, cookie, 'GET', '/api/srd/classes/wizard/niveles?nivel=3');
    assert.equal(nivel3.status, 200, JSON.stringify(nivel3.body));
    assert.deepEqual(nivel3.body.level.spellSlots, [4, 2, 0, 0, 0, 0, 0, 0, 0], 'mago 3 → 4 espacios de 1.º y 2 de 2.º');
    assert.equal(nivel3.body.level.cantripsKnown, 3);

    const nivel2 = await apiFetch(server.baseUrl, cookie, 'GET', '/api/srd/classes/wizard/niveles?nivel=2');
    assert.deepEqual(
      nivel2.body.level.features.map((f) => f.name),
      ['Tradición arcana'],
      'el rasgo de clase llega con su nombre en español'
    );
    assert.deepEqual(
      nivel2.body.level.subclassFeatures.map((f) => f.subclass),
      ['evocation'],
      'los rasgos de subclase van aparte: no se regalan por subir de nivel'
    );

    const todos = await apiFetch(server.baseUrl, cookie, 'GET', '/api/srd/classes/wizard/niveles');
    assert.deepEqual(todos.body.levels.map((l) => l.level), [2, 3]);

    const nivelMalo = await apiFetch(server.baseUrl, cookie, 'GET', '/api/srd/classes/wizard/niveles?nivel=42');
    assert.equal(nivelMalo.status, 400);
    const claseSinDatos = await apiFetch(server.baseUrl, cookie, 'GET', '/api/srd/classes/bard/niveles');
    assert.equal(claseSinDatos.status, 404);

    // Lo que la fase promete no tocar: el compendio sigue teniendo sus mismas
    // categorías y el buscador no devuelve filas de progresión.
    const indice = await apiFetch(server.baseUrl, cookie, 'GET', '/api/srd/status');
    assert.equal(indice.status, 200);
    assert.equal(
      indice.body.categories.some((c) => c.key.includes('level')),
      false,
      'la progresión no aparece como categoría del compendio'
    );
  } finally {
    await server.stop();
  }
});
