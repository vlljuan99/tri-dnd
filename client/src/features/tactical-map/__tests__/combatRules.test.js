import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttackEffects } from '../domain/combatRules.js';

test('el cliente calcula el mismo modo automático que el servidor', () => {
  assert.equal(
    resolveAttackEffects({ attackerConditions: ['envenenado'], targetConditions: ['cegado'] }).advantage,
    'none'
  );
  assert.equal(resolveAttackEffects({ targetConditions: ['derribado'], distance: 3 }).advantage, 'dis');
  assert.equal(resolveAttackEffects({ targetConditions: ['inconsciente'], distance: 1 }).autoCrit, true);
});
