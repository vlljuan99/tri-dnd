import test from 'node:test';
import assert from 'node:assert/strict';
import { gridToWorld, snapToGrid, snapToMapGrid, worldToGrid } from '../domain/grid.js';
import { canMoveToken } from '../domain/permissions.js';
import { updateTokenPosition } from '../domain/tokens.js';
import { computeBoardVision } from '../domain/vision.js';

test('convierte una posición de mundo a celda de rejilla', () => {
  assert.deepEqual(worldToGrid({ x: 2.9, y: 0, z: 4.1 }, 1), { col: 2, row: 4 });
  assert.deepEqual(worldToGrid({ x: 5.9, y: 0, z: 2.1 }, 2), { col: 2, row: 1 });
});

test('convierte una celda al centro de su posición de mundo', () => {
  assert.deepEqual(gridToWorld({ col: 3, row: 1 }, 1), { x: 3.5, y: 0, z: 1.5 });
  assert.deepEqual(gridToWorld({ col: 2, row: 2 }, 2), { x: 5, y: 0, z: 5 });
});

test('ajusta una posición al centro de la casilla', () => {
  assert.deepEqual(snapToGrid({ x: 3.2, y: 7, z: 6.8 }, 1), { x: 3.5, y: 0, z: 6.5 });
});

test('limita el ajuste de casillas a los bordes del mapa', () => {
  const map = { width: 4, height: 3, gridSize: 1 };
  assert.deepEqual(snapToMapGrid({ x: 9, y: 0, z: -2 }, map), { x: 3.5, y: 0, z: 0.5 });
});

test('valida permisos básicos de movimiento', () => {
  const user = { id: 7 };
  const token = { id: 'pj', ownerUserId: 7, visible: true };
  const enemy = { id: 'enemigo', visible: true };

  assert.equal(canMoveToken({ token, user, role: 'jugador' }), true);
  assert.equal(canMoveToken({ token: enemy, user, role: 'jugador' }), false);
  assert.equal(canMoveToken({ token: enemy, user, role: 'dm' }), true);
  assert.equal(canMoveToken({ token: { ...token, visible: false }, user, role: 'dm' }), false);
});

test('actualiza la posición de un token sin mutar el mapa original', () => {
  const map = {
    id: 'mapa',
    tokens: [
      { id: 'a', position: { x: 0.5, y: 0, z: 0.5 } },
      { id: 'b', position: { x: 1.5, y: 0, z: 1.5 } },
    ],
  };
  const updated = updateTokenPosition(map, 'b', { x: 4.5, y: 99, z: 2.5 });

  assert.equal(map.tokens[1].position.x, 1.5);
  assert.deepEqual(updated.tokens[1].position, { x: 4.5, y: 0, z: 2.5 });
  assert.notEqual(updated, map);
});

test('la visión de un enemigo respeta alcance, obstáculos y puertas cerradas', () => {
  const map = {
    width: 5,
    height: 3,
    gridSize: 1,
    disabledCells: [],
    rooms: [{
      col: 0,
      row: 0,
      width: 5,
      height: 3,
      obstacleCells: [[2, 1]],
      wallEdges: [],
    }],
    doors: [{ id: 1, kind: 'puerta', col: 0, row: 1, dirX: 1, dirY: 0, edge: true, isOpen: false }],
  };
  const visible = new Set(computeBoardVision(map, { col: 0, row: 1, radius: 4 }).map(([x, y]) => `${x},${y}`));

  assert.equal(visible.has('0,1'), true);
  assert.equal(visible.has('1,1'), false);
  assert.equal(visible.has('2,1'), false);

  map.doors[0].isOpen = true;
  const withOpenDoor = new Set(
    computeBoardVision(map, { col: 0, row: 1, radius: 4 }).map(([x, y]) => `${x},${y}`)
  );
  assert.equal(withOpenDoor.has('1,1'), true);
  assert.equal(withOpenDoor.has('2,1'), true);
  assert.equal(withOpenDoor.has('3,1'), false);
});
