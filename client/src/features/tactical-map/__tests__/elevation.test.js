import test from 'node:test';
import assert from 'node:assert/strict';
import { ELEV_STEP, cellGroundY, tokenGroundY } from '../domain/elevation.js';
import { buildBoardElevation } from '../domain/pathfinding.js';

// Sala 4x2 con una cornisa de dos niveles en (1,0) y un foso en (2,1).
const board = {
  gridSize: 2,
  rooms: [{ col: 0, row: 0, width: 4, height: 2, elevationCells: [[1, 0, 2], [2, 1, -1]] }],
};

test('la cornisa levanta el suelo un paso por nivel', () => {
  const elevation = buildBoardElevation(board);
  assert.equal(cellGroundY(elevation, 1, 0), 2 * ELEV_STEP);
});

test('el llano no levanta nada', () => {
  const elevation = buildBoardElevation(board);
  assert.equal(cellGroundY(elevation, 0, 0), 0);
});

test('un foso no hunde lo que hay encima', () => {
  // El bloque del foso tiene la cara superior a ras de suelo: bajar el token
  // hasta el fondo lo metería dentro del propio bloque y desaparecería.
  const elevation = buildBoardElevation(board);
  assert.equal(cellGroundY(elevation, 2, 1), 0);
});

test('un tablero sin relieve devuelve siempre el suelo', () => {
  const elevation = buildBoardElevation({ rooms: [{ col: 0, row: 0, width: 2, height: 2 }] });
  assert.equal(cellGroundY(elevation, 0, 0), 0);
  assert.equal(cellGroundY(null, 3, 3), 0);
});

test('la posición de mundo del token se traduce a la casilla que pisa', () => {
  const elevation = buildBoardElevation(board);
  // Centro de la casilla (1,0) con casillas de 2 unidades: x=3, z=1
  assert.equal(tokenGroundY(elevation, { x: 3, y: 0, z: 1 }, 2), 2 * ELEV_STEP);
  assert.equal(tokenGroundY(elevation, { x: 1, y: 0, z: 1 }, 2), 0);
  assert.equal(tokenGroundY(elevation, null, 2), 0, 'sin posición no se calcula altura');
});
