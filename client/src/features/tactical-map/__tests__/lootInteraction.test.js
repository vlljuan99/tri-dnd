import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBoardFromMap } from '../domain/composite.js';
import { isLootInteraction } from '../domain/interactions.js';

function mapWithObject(hasLoot) {
  return {
    name: 'Cripta',
    gridSize: 1,
    floors: [
      {
        id: 3,
        name: 'Sótano',
        rooms: [
          {
            id: 7,
            name: 'Cámara',
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            disabledCells: [],
          },
        ],
      },
    ],
    doors: [],
    characterTokens: [],
    tokens: [
      {
        id: 11,
        roomId: 7,
        kind: 'objeto',
        name: 'Poción de curación',
        x: 1,
        y: 0,
        hasLoot,
      },
    ],
  };
}

test('el mapa compuesto conserva el botín y activa el flujo Saquear', () => {
  const board = composeBoardFromMap(mapWithObject(true));
  const objectToken = board.serverTokens[0];

  assert.equal(objectToken.hasLoot, true);
  assert.equal(isLootInteraction('token', objectToken), true);
  assert.equal(isLootInteraction('door', objectToken), false);
});

test('un objeto sin botín sigue el flujo informativo normal', () => {
  const objectToken = composeBoardFromMap(mapWithObject(false)).serverTokens[0];

  assert.equal(objectToken.hasLoot, false);
  assert.equal(isLootInteraction('token', objectToken), false);
});

