import test from 'node:test';
import assert from 'node:assert/strict';
import { gridToWorld, snapToGrid, snapToMapGrid, worldToGrid } from '../domain/grid.js';
import { canMoveToken } from '../domain/permissions.js';
import { isTokenDowned, updateTokenPosition } from '../domain/tokens.js';
import {
  fluidTypesAlongBoardPath,
  normalizeFluidEffects,
  paintFluidCell,
} from '../domain/fluids.js';
import { composeBoardFromMap } from '../domain/composite.js';
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

test('el pincel de fluidos pinta, sustituye y borra una casilla', () => {
  const water = paintFluidCell([], 2, 3, 'agua');
  assert.deepEqual(water, [[2, 3, 'agua']]);
  assert.deepEqual(paintFluidCell(water, 2, 3, 'lava'), [[2, 3, 'lava']]);
  assert.deepEqual(paintFluidCell(water, 2, 3, 'agua'), []);
  assert.deepEqual(paintFluidCell(water, 2, 3, 'agua', { erase: true }), []);
});

test('el cliente muestra las recomendaciones y detecta los fluidos de un trayecto una sola vez', () => {
  const map = {
    rooms: [{
      col: 0, row: 0, width: 4, height: 1,
      fluidCells: [[1, 0, 'agua'], [2, 0, 'agua'], [3, 0, 'lava']],
    }],
  };
  assert.equal(normalizeFluidEffects({}).lava.damageDice, '2d6');
  assert.deepEqual(
    fluidTypesAlongBoardPath(map, [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }]),
    ['agua', 'lava']
  );
});

test('un token con cero o menos PG está inconsciente y puede volver a levantarse', () => {
  assert.equal(isTokenDowned({ hp: 0 }), true);
  assert.equal(isTokenDowned({ hp: -2 }), true);
  assert.equal(isTokenDowned({ hp: 1 }), false);
  assert.equal(isTokenDowned({ hp: null }), false);
});

test('el tablero compuesto conserva la capa de fluidos', () => {
  const board = composeBoardFromMap({
    name: 'Templo sumergido',
    gridSize: 1,
    floors: [{
      id: 1,
      name: 'Nave',
      rooms: [{
        id: 2,
        name: 'Estanque',
        x: 4,
        y: 7,
        width: 2,
        height: 1,
        disabledCells: [],
        fluidCells: [[0, 0, 'agua'], [1, 0, 'arcana']],
      }],
    }],
    doors: [],
    tokens: [],
    characterTokens: [],
    weather: 'lluvia',
    timeOfDay: 'noche',
    weatherIntensity: 0.8,
    hazardZones: [{
      id: 9,
      name: 'Nube',
      visualType: 'nube',
      cells: [{ floorId: 1, x: 5, y: 7 }],
    }],
  });

  assert.deepEqual(board.rooms[0].fluidCells, [[0, 0, 'agua'], [1, 0, 'arcana']]);
  assert.equal(board.weather, 'lluvia');
  assert.equal(board.timeOfDay, 'noche');
  assert.deepEqual(board.hazardZones[0].cells, [{ col: 1, row: 0 }]);
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

test('la niebla tóxica limita la visión mientras el token está encima', () => {
  const map = {
    width: 9, height: 1, gridSize: 1, disabledCells: [],
    rooms: [{
      col: 0, row: 0, width: 9, height: 1,
      obstacleCells: [], wallEdges: [], fluidCells: [[4, 0, 'niebla']],
    }],
    doors: [],
  };
  const visible = computeBoardVision(map, { col: 4, row: 0, radius: 6 });
  assert.equal(visible.some(([col]) => col === 1), false);
  assert.equal(visible.some(([col]) => col === 2), true);
  assert.equal(visible.some(([col]) => col === 6), true);
});
