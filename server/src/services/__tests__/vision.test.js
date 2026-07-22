import test from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../vision.js';

function room(overrides = {}) {
  return {
    x: 0,
    y: 0,
    width: 5,
    height: 3,
    disabled_cells: '[]',
    obstacle_cells: '[]',
    wall_edges: '[]',
    ...overrides,
  };
}

test('una casilla intermedia con obstáculo corta la línea de visión', () => {
  assert.equal(
    hasLineOfSight({
      rooms: [room({ obstacle_cells: '[[2,1]]' })],
      from: { x: 0, y: 1 },
      to: { x: 4, y: 1 },
    }),
    false
  );
});

test('una puerta abierta abre la línea que la pared cerraba', () => {
  const rooms = [room({ wall_edges: '[[1,1,"e"]]' })];
  const door = {
    kind: 'puerta',
    from_x: 1,
    from_y: 1,
    to_x: 2,
    to_y: 1,
    is_open: 1,
  };
  assert.equal(hasLineOfSight({ rooms, from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }), false);
  assert.equal(hasLineOfSight({ rooms, doors: [door], from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }), true);
});
