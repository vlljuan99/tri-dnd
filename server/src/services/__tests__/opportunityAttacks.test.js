import test from 'node:test';
import assert from 'node:assert/strict';
import { reachCrossing } from '../opportunityAttacks.js';

test('detecta el paso exacto que abandona el alcance', () => {
  const path = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
  assert.deepEqual(reachCrossing(path, { x: 0, y: 1 }, 2), {
    before: { x: 2, y: 1 },
    after: { x: 3, y: 1 },
    distance: 2,
  });
});

test('no dispara si el recorrido nunca estuvo dentro del alcance', () => {
  assert.equal(
    reachCrossing([{ x: 3, y: 1 }, { x: 4, y: 1 }], { x: 0, y: 1 }, 1),
    null
  );
});
