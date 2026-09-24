import test from 'node:test';
import assert from 'node:assert/strict';
import { endTurnWarning, unspentTurnResources } from '../domain/endTurnWarning.js';

test('lista lo que queda del turno', () => {
  assert.deepEqual(unspentTurnResources({ combatant: { actionUsed: true, bonusUsed: false }, remaining: 3 }), [
    'la acción adicional',
    '15 pies',
  ]);
  assert.deepEqual(unspentTurnResources({ combatant: { actionUsed: true, bonusUsed: true }, remaining: 0 }), []);
  assert.deepEqual(unspentTurnResources({ combatant: null }), []);
});

test('redacta la pregunta', () => {
  assert.equal(endTurnWarning(['la acción adicional', '15 pies']), 'Te quedan la acción adicional y 15 pies. ¿Terminar turno?');
  assert.equal(endTurnWarning(['la acción']), 'Te queda la acción. ¿Terminar turno?');
  assert.equal(endTurnWarning(['30 pies']), 'Te quedan 30 pies. ¿Terminar turno?');
  assert.equal(
    endTurnWarning(['la acción', 'la acción adicional', '30 pies']),
    'Te quedan la acción, la acción adicional y 30 pies. ¿Terminar turno?'
  );
  assert.equal(endTurnWarning([]), null);
});
