import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFigures } from '../lib/presetFigures.js';

test('el panel de imágenes agrupa enemigos antes que objetos y omite los grupos vacíos', () => {
  const groups = groupFigures([
    { key: 'objeto-carro-volcado', kind: 'objeto' },
    { key: 'enemigo-lobo', kind: 'enemigo' },
    { key: 'enemigo-bandido', kind: 'enemigo' },
  ]);
  assert.deepEqual(groups.map((group) => group.label), ['Enemigos', 'Objetos']);
  assert.deepEqual(groups[0].figures.map((figure) => figure.key), ['enemigo-lobo', 'enemigo-bandido']);

  assert.deepEqual(groupFigures([{ key: 'objeto-yunque', kind: 'objeto' }]).map((group) => group.kind), ['objeto']);
  assert.deepEqual(groupFigures(null), []);
});
