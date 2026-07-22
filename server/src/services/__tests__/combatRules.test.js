import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionsPreventActions,
  conditionsPreventMovement,
  isConditionImmune,
  resolveAttackEffects,
} from '../combatRules.js';

test('las fuentes de ventaja y desventaja se cancelan', () => {
  const result = resolveAttackEffects({
    attackerConditions: ['envenenado'],
    targetConditions: ['cegado', 'aturdido'],
  });
  assert.equal(result.advantage, 'none');
  assert.deepEqual(result.disadvantageReasons, ['atacante envenenado']);
  assert.equal(result.advantageReasons.length, 2);
});

test('derribado depende de la distancia y paralizado da crítico solo a 5 pies', () => {
  assert.equal(resolveAttackEffects({ targetConditions: ['derribado'], distance: 1 }).advantage, 'adv');
  assert.equal(resolveAttackEffects({ targetConditions: ['derribado'], distance: 2 }).advantage, 'dis');
  assert.equal(resolveAttackEffects({ targetConditions: ['paralizado'], distance: 1 }).autoCrit, true);
  assert.equal(resolveAttackEffects({ targetConditions: ['paralizado'], distance: 2 }).autoCrit, false);
  assert.equal(resolveAttackEffects({ targetConditions: ['inconsciente'], distance: 2 }).advantage, 'none');
});

test('esquivar, cota alta y la elección manual entran en la misma resolución', () => {
  const cancelled = resolveAttackEffects({ targetStance: 'esquivar', ranged: true, highGround: true });
  assert.equal(cancelled.advantage, 'none');
  const forced = resolveAttackEffects({ targetStance: 'esquivar', manualAdvantage: 'adv' });
  assert.equal(forced.advantage, 'none');
  assert.equal(resolveAttackEffects({ targetStance: 'esquivar', targetConditions: ['cegado'] }).advantage, 'adv');
  assert.equal(resolveAttackEffects({ targetStance: 'esquivar', attackerConditions: ['invisible'] }).advantage, 'adv');
});

test('las condiciones incapacitantes bloquean acciones y las de velocidad bloquean movimiento', () => {
  assert.equal(conditionsPreventActions(['aturdido']), true);
  assert.equal(conditionsPreventActions(['agarrado']), false);
  assert.equal(conditionsPreventMovement(['agarrado']), true);
  assert.equal(conditionsPreventMovement(['envenenado']), false);
});

test('las inmunidades SRD se comparan con la clave española de la mesa', () => {
  const monster = { condition_immunities: [{ index: 'poisoned' }, { index: 'exhaustion' }] };
  assert.equal(isConditionImmune(monster, 'envenenado'), true);
  assert.equal(isConditionImmune(monster, 'derribado'), false);
});
