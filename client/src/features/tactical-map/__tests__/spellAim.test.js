import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCANE_COLOR, ELEMENT_COLORS, elementColor, spellElement } from '../domain/elements.js';
import { absoluteToBoard, boardToAbsolute } from '../domain/grid.js';

test('el color del destello sale del tipo de daño del conjuro', () => {
  assert.equal(spellElement({ damage: { damage_type: { index: 'fire', name: 'Fire' } } }), 'fire');
  assert.equal(elementColor('fire'), ELEMENT_COLORS.fire);
  assert.equal(elementColor('COLD'), ELEMENT_COLORS.cold);
});

test('un conjuro sin daño tipado usa el violeta arcano', () => {
  assert.equal(spellElement({ name: 'Sugestión' }), null);
  assert.equal(spellElement({ damage: { damage_type: { index: 'inventado' } } }), null);
  assert.equal(elementColor(null), ARCANE_COLOR);
  assert.equal(elementColor('inventado'), ARCANE_COLOR);
});

test('el apuntado viaja en coordenadas absolutas del editor', () => {
  // El tablero compuesto empieza en la casilla (12, 7) del editor: lo que se
  // dibuja como (0, 0) es esa casilla, y es la que debe recibir el servidor.
  const map = { origin: { x: 12, y: 7 } };
  assert.deepEqual(boardToAbsolute({ col: 0, row: 0 }, map), { x: 12, y: 7 });
  assert.deepEqual(boardToAbsolute({ col: 3, row: 2 }, map), { x: 15, y: 9 });
  assert.deepEqual(absoluteToBoard({ x: 15, y: 9 }, map), { col: 3, row: 2 });
});

test('sin origen de planta la conversión es la identidad', () => {
  assert.deepEqual(boardToAbsolute({ col: 4, row: 5 }, {}), { x: 4, y: 5 });
  assert.deepEqual(absoluteToBoard({ x: 4, y: 5 }, undefined), { col: 4, row: 5 });
});
