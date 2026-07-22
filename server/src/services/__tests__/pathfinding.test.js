import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, findPathCost } from '../pathfinding.js';

test('devuelve el camino además del coste sin cambiar el contrato de coste', () => {
  const grid = new Map([
    ['0,0', 1],
    ['1,0', 1],
    ['2,0', 2],
  ]);
  const result = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.deepEqual(result, { cost: 3, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });
  assert.equal(findPathCost(grid, { x: 0, y: 0 }, { x: 2, y: 0 }), 3);
});
