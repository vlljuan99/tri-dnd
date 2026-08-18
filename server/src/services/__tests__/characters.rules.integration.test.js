// Las reglas derivadas de la ficha (Fases A y B de la rebanada vertical) se
// comprueban contra el servidor REAL: lo que importa no es que el cliente las
// pinte bien, sino que un PUT a mano no pueda saltárselas.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startTestServer, registerUser, apiFetch } from './helpers/liveServer.js';

// Compendio mínimo para que el servidor pueda resolver la competencia del
// mago: su clase concede dagas, nada más.
function seedCompendio(dataDir) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    const insert = db.prepare(
      'INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES (?, ?, ?, NULL, NULL, ?)'
    );
    insert.run('classes', 'wizard', 'Wizard', JSON.stringify({ index: 'wizard', proficiencies: [{ index: 'daggers' }] }));
    insert.run(
      'proficiencies',
      'daggers',
      'Daggers',
      JSON.stringify({ index: 'daggers', type: 'Weapons', reference: { index: 'dagger' } })
    );
  } finally {
    db.close();
  }
}

function objeto(extra) {
  return { id: extra.id, name: extra.name, qty: 1, slot: extra.slot, weapon: extra.weapon ?? null, armor: extra.armor ?? null };
}

const daga = (slot) =>
  objeto({ id: 'daga', name: 'Daga', slot, weapon: { damageDice: '1d4', damageType: 'piercing', properties: ['finesse'] } });
const escudo = (slot) =>
  objeto({
    id: 'escudo',
    name: 'Escudo',
    slot,
    armor: { category: 'Shield', base: 2, dexBonus: false, maxBonus: null },
  });
const cotaDeMallas = (slot) =>
  objeto({
    id: 'malla',
    name: 'Cota de mallas',
    slot,
    armor: { category: 'Heavy', base: 16, dexBonus: false, maxBonus: null },
  });

test('el servidor impone las reglas derivadas de la ficha', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    seedCompendio(server.dataDir);
    const cookie = await registerUser(server.baseUrl, { username: 'maga', displayName: 'Maga' });

    const creada = await apiFetch(server.baseUrl, cookie, 'POST', '/api/characters', { name: 'Elda' });
    assert.equal(creada.status, 201, JSON.stringify(creada.body));
    const id = creada.body.character.id;

    // Competencia: la concede la clase, no el cliente.
    const competencias = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, {
      class_index: 'wizard',
      weapon_proficiencies: ['martial-weapons', 'simple-weapons'],
      armor_proficiencies: ['all-armor'],
    });
    assert.equal(competencias.status, 200, JSON.stringify(competencias.body));
    assert.deepEqual(competencias.body.character.weapon_proficiencies, ['dagger'], 'el mago solo es competente con dagas');
    assert.deepEqual(competencias.body.character.armor_proficiencies, [], 'y con ninguna armadura');

    // CA: derivada del equipo, nunca escrita por el cliente.
    const caAMano = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, { ac: 25 });
    assert.equal(caAMano.status, 400, 'un PJ no puede escribir su CA');

    const conArmadura = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, {
      abilities: { str: 10, dex: 14, con: 10, int: 16, wis: 10, cha: 10 },
      inventory: [cotaDeMallas('armadura'), escudo('escudo'), daga('mano-principal')],
    });
    assert.equal(conArmadura.status, 200, JSON.stringify(conArmadura.body));
    assert.equal(conArmadura.body.character.ac, 18, '16 de cota de mallas + 2 de escudo, sin DES');

    // Slots: el escudo ocupa la mano secundaria.
    const escudoYArma = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, {
      inventory: [escudo('escudo'), daga('mano-secundaria')],
    });
    assert.equal(escudoYArma.status, 400, 'no se puede empuñar un arma en la mano del escudo');
    assert.match(escudoYArma.body.error, /inventory/);
  } finally {
    await server.stop();
  }
});
