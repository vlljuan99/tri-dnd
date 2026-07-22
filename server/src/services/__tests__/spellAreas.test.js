import test from 'node:test';
import assert from 'node:assert/strict';
import { spellAimValidation, spellArea, spellAreaCells, spellDamageNotation } from '../spellAreas.js';

test('normaliza esfera y pinta todas las casillas de su radio', () => {
  const area = spellArea({ area_of_effect: { type: 'sphere', size: 10 } });
  assert.deepEqual(area, { type: 'sphere', size: 2, width: 1 });
  const cells = spellAreaCells({ origin: { x: 0, y: 0 }, aim: { x: 3, y: 3 }, area });
  assert.equal(cells.length, 13);
  assert.equal(cells.some((cell) => cell.x === 5 && cell.y === 3), true);
  assert.equal(cells.some((cell) => cell.x === 6 && cell.y === 3), false);
});

test('el cono sale del lanzador en la dirección elegida', () => {
  const cells = spellAreaCells({
    origin: { x: 0, y: 0 },
    aim: { x: 3, y: 0 },
    area: { type: 'cone', size: 3, width: 1 },
  });
  assert.equal(cells.some((cell) => cell.x === 3 && cell.y === 2), true);
  assert.equal(cells.some((cell) => cell.x === -1 && cell.y === 0), false);
});

test('valida alcance y elige el daño de truco o espacio', () => {
  assert.equal(spellAimValidation({ range: '30 feet' }, { x: 0, y: 0 }, { x: 7, y: 0 }).ok, false);
  assert.equal(spellDamageNotation({ damage: { damage_at_character_level: { 1: '1d10', 5: '2d10' } } }, 7), '2d10');
  assert.equal(spellDamageNotation({ level: 3, damage: { damage_at_slot_level: { 3: '8d6', 4: '9d6' } } }, 7, 4), '9d6');
});
