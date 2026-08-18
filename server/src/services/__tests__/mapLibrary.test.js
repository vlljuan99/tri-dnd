import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeRoom, serializeToken, spawnEncounterTransition } from '../mapLibrary.js';

const tokenRow = {
  id: 7,
  room_id: 3,
  kind: 'trampa',
  name: 'Techo inestable',
  monster_index: 'mimic',
  character_id: 12,
  x: 4,
  y: 5,
  hidden: 0,
  dc: 14,
  skill: 'acrobatics',
  success_consequence: 'Saltas a una zona segura.',
  failure_consequence: 'El techo cae sobre ti.',
  perception_dc: 16,
  vision_radius: 8,
  overrides: '{}',
  loot: '[]',
};

test('el DM recibe las dos consecuencias informativas de un marcador', () => {
  const token = serializeToken(tokenRow);

  assert.equal(token.successConsequence, 'Saltas a una zona segura.');
  assert.equal(token.failureConsequence, 'El techo cae sobre ti.');
  assert.equal(token.monsterIndex, 'mimic');
  assert.equal(token.characterId, 12);
});

test('el jugador no recibe consecuencias, CD ni enlaces a fichas ocultas', () => {
  const token = JSON.parse(JSON.stringify(serializeToken(tokenRow, { forPlayer: true })));

  assert.equal('successConsequence' in token, false);
  assert.equal('failureConsequence' in token, false);
  assert.equal('dc' in token, false);
  assert.equal('perceptionDc' in token, false);
  assert.equal('monsterIndex' in token, false);
  assert.equal('characterId' in token, false);
});

test('los fluidos se serializan para DM y jugador', () => {
  const row = {
    id: 2,
    floor_id: 1,
    name: 'Galería inundada',
    x: 0,
    y: 0,
    width: 3,
    height: 2,
    fluid_cells: '[[0,0,"agua"],[1,0,"arcana"]]',
    revealed: 1,
  };

  assert.deepEqual(serializeRoom(row).fluidCells, [[0, 0, 'agua'], [1, 0, 'arcana']]);
  assert.deepEqual(serializeRoom(row, { forPlayer: true }).fluidCells, [[0, 0, 'agua'], [1, 0, 'arcana']]);
});

test('el primer enemigo inicia encuentro aunque la mesa ya estuviera en turnos', () => {
  assert.deepEqual(
    spawnEncounterTransition({
      added: 2,
      startCombat: true,
      combatActiveBefore: true,
      activeEnemiesBefore: false,
    }),
    { turnModeActivated: false, encounterStarted: true }
  );
});

test('un refuerzo no repite el aviso de un combate que ya está rodando', () => {
  assert.deepEqual(
    spawnEncounterTransition({
      added: 1,
      startCombat: true,
      combatActiveBefore: true,
      activeEnemiesBefore: true,
    }),
    { turnModeActivated: false, encounterStarted: false }
  );
});
