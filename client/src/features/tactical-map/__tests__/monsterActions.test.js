import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiattackPlans, planSummary } from '../domain/monsterActions.js';

test('el cliente presenta las alternativas estructuradas del multiataque', () => {
  const data = {
    actions: [
      {
        name: 'Multiattack',
        multiattack_type: 'actions',
        actions: [
          { action_name: 'Bite', count: '1' },
          { action_name: 'Claw', count: '2' },
        ],
      },
      { name: 'Bite', attack_bonus: 5 },
      { name: 'Claw', attack_bonus: 5 },
    ],
  };
  const [plan] = buildMultiattackPlans(data);
  assert.equal(planSummary(plan), '1× Bite + 2× Claw');
});

test('presenta cantidades variables sin fingir que ya están resueltas', () => {
  const data = {
    actions: [
      {
        name: 'Multiattack',
        multiattack_type: 'actions',
        actions: [{ action_name: 'Rotting Touch', count: '1d4' }],
      },
      { name: 'Rotting Touch', attack_bonus: 2 },
    ],
  };
  assert.equal(planSummary(buildMultiattackPlans(data)[0]), '1d4× Rotting Touch');
});
