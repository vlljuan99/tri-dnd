import test from 'node:test';
import assert from 'node:assert/strict';
import { spellAimValidation, spellArea, spellAreaCells } from '../domain/spellAreas.js';

test('el cliente convierte una esfera a casillas', () => {
  const area = spellArea({ area_of_effect: { type: 'sphere', size: 20 } });
  assert.deepEqual(area, { type: 'sphere', size: 4, width: 1 });
  const cells = spellAreaCells({ origin: { x: 0, y: 0 }, aim: { x: 4, y: 4 }, area });
  assert.equal(cells.length, 49);
  assert.equal(
    cells.some((cell) => cell.x === 8 && cell.y === 4),
    true
  );
});

test('el cliente bloquea un centro fuera de alcance', () => {
  assert.equal(
    spellAimValidation({ range: '60 feet' }, { x: 0, y: 0 }, { x: 13, y: 0 }).ok,
    false
  );
});
