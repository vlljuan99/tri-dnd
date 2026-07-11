import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardWalkable, findBoardPath, reachableWithin } from '../domain/pathfinding.js';

// Tablero de una sala 5x3 en (0,0) con obstáculo en (2,1) y terreno
// difícil (coste 3) en (2,0) — el mismo escenario que valida el servidor.
const board = {
  rooms: [
    {
      col: 0,
      row: 0,
      width: 5,
      height: 3,
      disabledCells: [],
      obstacleCells: [[2, 1]],
      terrainCells: [[2, 0, 3]],
    },
  ],
};

test('el camino rodea obstáculos y elige la ruta más barata', () => {
  const walkable = buildBoardWalkable(board);
  // De (0,1) a (4,1): recto bloqueado por el obstáculo; por arriba pisa el
  // terreno difícil (coste 6), por abajo es normal (coste 4)
  const result = findBoardPath(walkable, { col: 0, row: 1 }, { col: 4, row: 1 });
  assert.equal(result.cost, 4);
  assert.equal(result.path.length, 4);
  assert.deepEqual(result.path.at(-1), { col: 4, row: 1 });
});

test('entrar en terreno difícil cuesta su coste, no 1', () => {
  const walkable = buildBoardWalkable(board);
  const result = findBoardPath(walkable, { col: 0, row: 0 }, { col: 2, row: 0 });
  assert.equal(result.cost, 4); // (1,0)=1 + (2,0)=3
});

test('sin camino hacia obstáculos o fuera del tablero', () => {
  const walkable = buildBoardWalkable(board);
  assert.equal(findBoardPath(walkable, { col: 0, row: 0 }, { col: 2, row: 1 }), null);
  assert.equal(findBoardPath(walkable, { col: 0, row: 0 }, { col: 9, row: 9 }), null);
});

test('mismo origen y destino cuesta 0 con camino vacío', () => {
  const walkable = buildBoardWalkable(board);
  assert.deepEqual(findBoardPath(walkable, { col: 1, row: 1 }, { col: 1, row: 1 }), { cost: 0, path: [] });
});

test('el área alcanzable respeta el coste del terreno', () => {
  const walkable = buildBoardWalkable(board);
  // Con presupuesto 1 desde (1,0): las adyacentes normales sí, la de
  // terreno difícil (2,0, coste 3) no, y el obstáculo (2,1) nunca
  const cells = reachableWithin(walkable, { col: 1, row: 0 }, 1);
  const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
  assert.ok(keys.has('0,0'));
  assert.ok(keys.has('0,1'));
  assert.ok(keys.has('1,1'));
  assert.ok(!keys.has('2,0'), 'terreno difícil fuera de presupuesto 1');
  assert.ok(!keys.has('2,1'), 'obstáculo nunca alcanzable');
  // Con presupuesto 3 sí llega al terreno difícil
  const cells3 = reachableWithin(walkable, { col: 1, row: 0 }, 3);
  assert.ok(cells3.some((c) => c.col === 2 && c.row === 0));
});
