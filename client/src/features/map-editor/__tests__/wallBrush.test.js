import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWallStroke,
  canonicalWallEdge,
  collectWallKeys,
  nearestWallSide,
  samplePointerSegment,
} from '../lib/wallBrush.js';

test('la clave canónica identifica el mismo borde desde ambas casillas', () => {
  assert.equal(canonicalWallEdge(2, 3, 'e'), canonicalWallEdge(3, 3, 'o'));
  assert.equal(canonicalWallEdge(2, 3, 's'), canonicalWallEdge(2, 4, 'n'));
});

test('en una esquina el pincel conserva la orientación del trazo', () => {
  assert.equal(nearestWallSide(0, 0, 'n'), 'n');
  assert.equal(nearestWallSide(0, 0, 'o'), 'o');
  assert.equal(nearestWallSide(0.48, 0.02, 'o'), 'n', 'permite girar cuando el otro borde está claramente más cerca');
});

test('un trazo pinta varias paredes sin duplicar una arista equivalente', () => {
  const rooms = [
    { id: 1, x: 0, y: 0, wallEdges: [[0, 0, 'n']] },
    // La primera pared también aparece descrita desde esta sala solapada.
    { id: 2, x: 0, y: -1, wallEdges: [[0, 0, 's']] },
  ];
  const updates = applyWallStroke(
    rooms,
    [
      { roomId: 1, x: 0, y: 0, side: 'n' },
      { roomId: 1, x: 1, y: 0, side: 'n' },
      { roomId: 1, x: 1, y: 0, side: 'n' },
    ],
    'add'
  );
  const nextRooms = rooms.map((room) => {
    const update = updates.find((item) => item.roomId === room.id);
    return update ? { ...room, wallEdges: update.wallEdges } : room;
  });

  assert.deepEqual([...collectWallKeys(nextRooms)].sort(), ['h:0,0', 'h:1,0']);
  assert.equal(nextRooms.flatMap((room) => room.wallEdges).length, 2, 'queda una sola entrada por pared');
});

test('un trazo de borrado elimina las representaciones gemelas', () => {
  const rooms = [
    { id: 1, x: 0, y: 0, wallEdges: [[1, 1, 'e'], [0, 0, 'n']] },
    { id: 2, x: 2, y: 1, wallEdges: [[0, 0, 'o']] },
  ];
  const updates = applyWallStroke(
    rooms,
    [{ roomId: 1, x: 1, y: 1, side: 'e' }],
    'remove'
  );

  assert.deepEqual(updates, [
    { roomId: 1, wallEdges: [[0, 0, 'n']] },
    { roomId: 2, wallEdges: [] },
  ]);
});

test('el muestreo interpola un arrastre rápido hasta su destino', () => {
  const points = samplePointerSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
  assert.equal(points.length, 5);
  assert.deepEqual(points.at(-1), { x: 100, y: 0 });
  assert.ok(points.every((point, index) => point.x - (points[index - 1]?.x ?? 0) <= 20));
});
