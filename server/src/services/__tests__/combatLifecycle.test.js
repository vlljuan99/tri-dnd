import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEATH_STATES,
  conditionTimer,
  damageAtZeroTransition,
  isMassiveDamage,
  resolveDeathSave,
  tickConditionTimers,
} from '../combatLifecycle.js';

test('las salvaciones de muerte persisten los estados estable y muerto', () => {
  const stable = resolveDeathSave({ state: DEATH_STATES.DYING, successes: 2, failures: 1 }, 15);
  assert.deepEqual(stable, {
    ok: true,
    natural: 15,
    outcome: 'estable',
    state: DEATH_STATES.STABLE,
    successes: 0,
    failures: 0,
  });

  const dead = resolveDeathSave({ state: DEATH_STATES.DYING, successes: 1, failures: 2 }, 4);
  assert.equal(dead.state, DEATH_STATES.DEAD);
  assert.equal(dead.failures, 3);
});

test('un 20 natural revive y un 1 natural cuenta como dos fallos', () => {
  const revived = resolveDeathSave({ state: DEATH_STATES.DYING, successes: 1, failures: 1 }, 20);
  assert.equal(revived.state, DEATH_STATES.NORMAL);
  assert.equal(revived.outcome, 'revive');

  const fumble = resolveDeathSave({ state: DEATH_STATES.DYING, successes: 0, failures: 0 }, 1);
  assert.equal(fumble.failures, 2);
  assert.equal(fumble.state, DEATH_STATES.DYING);
});

test('daño a 0 rompe la estabilización y el crítico suma dos fallos', () => {
  const result = damageAtZeroTransition({
    state: DEATH_STATES.STABLE,
    successes: 3,
    failures: 1,
    critical: true,
  });
  assert.equal(result.state, DEATH_STATES.DYING);
  assert.equal(result.successes, 0);
  assert.equal(result.failures, 2);
  assert.equal(result.addedFailures, 2);
});

test('el daño masivo usa el daño sobrante después de llegar a 0 PG', () => {
  assert.equal(isMassiveDamage({ previousHp: 4, hpMax: 12, hitPointDamage: 16 }), true);
  assert.equal(isMassiveDamage({ previousHp: 4, hpMax: 12, hitPointDamage: 15 }), false);
});

test('las condiciones descuentan en su fase y respetan una fuente de fluido activa', () => {
  const first = tickConditionTimers({
    conditions: ['aturdido', 'envenenado'],
    timers: [
      { condition: 'aturdido', remaining: 2, timing: 'end' },
      { condition: 'envenenado', remaining: 1, timing: 'start' },
    ],
    fluidConditions: ['envenenado'],
    timing: 'start',
  });
  assert.deepEqual(first.conditions, ['aturdido', 'envenenado']);
  assert.deepEqual(first.expired, []);

  const second = tickConditionTimers({ ...first, fluidConditions: [], timing: 'end' });
  assert.deepEqual(second.timers, [{ condition: 'aturdido', remaining: 1, timing: 'end' }]);
});

test('un temporizador inválido crea una condición permanente', () => {
  assert.equal(conditionTimer('cegado', { duration: 0, timing: 'start' }), null);
  assert.deepEqual(conditionTimer('cegado', { duration: 3, timing: 'start' }), {
    condition: 'cegado',
    remaining: 3,
    timing: 'start',
  });
});
