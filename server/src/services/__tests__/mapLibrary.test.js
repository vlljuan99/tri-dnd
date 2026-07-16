import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeToken } from '../mapLibrary.js';

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
