import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTurnPreview } from '../domain/turnOrder.js';

const orden = [{ id: 1 }, { id: 2 }, { id: 3 }];

test('el turno pasa al siguiente por iniciativa sin cerrar la ronda', () => {
  assert.deepEqual(nextTurnPreview(orden, 1), { next: { id: 2 }, closesRound: false });
  assert.deepEqual(nextTurnPreview(orden, 2), { next: { id: 3 }, closesRound: false });
});

test('desde el último se vuelve al primero y eso cierra la ronda', () => {
  assert.deepEqual(nextTurnPreview(orden, 3), { next: { id: 1 }, closesRound: true });
});

test('sin turno activo se arranca por el primero sin cerrar ronda', () => {
  // Pasa con el tracker recién abierto o cuando el combatiente activo se ha
  // ido del tablero (murió, o el DM lo quitó): el servidor no sube la ronda.
  assert.deepEqual(nextTurnPreview(orden, null), { next: { id: 1 }, closesRound: false });
  assert.deepEqual(nextTurnPreview(orden, 999), { next: { id: 1 }, closesRound: false });
});

test('un solo combatiente cierra ronda en cada turno', () => {
  assert.deepEqual(nextTurnPreview([{ id: 7 }], 7), { next: { id: 7 }, closesRound: true });
});

test('sin combatientes no hay nada que anticipar', () => {
  assert.deepEqual(nextTurnPreview([], 1), { next: null, closesRound: false });
  assert.deepEqual(nextTurnPreview(undefined, 1), { next: null, closesRound: false });
});
