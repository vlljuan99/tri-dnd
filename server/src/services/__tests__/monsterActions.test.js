import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiattackPlans, consumeMonsterAttack } from '../monsterActions.js';

const actionsMonster = {
  actions: [
    {
      name: 'Multiattack',
      multiattack_type: 'actions',
      actions: [
        { action_name: 'Bite', count: '1', type: 'melee' },
        { action_name: 'Claw', count: '2', type: 'melee' },
        { action_name: 'Roar', count: '1', type: 'ability' },
      ],
    },
    { name: 'Bite', attack_bonus: 7, damage: [{ damage_dice: '1d10' }] },
    { name: 'Claw', attack_bonus: 7, damage: [{ damage_dice: '2d6' }] },
    { name: 'Roar', desc: 'Cada criatura debe salvar.' },
  ],
};

test('convierte un multiataque estructurado y omite aptitudes sin ataque', () => {
  assert.deepEqual(buildMultiattackPlans(actionsMonster), [
    {
      id: 'multi-0',
      label: 'Multiataque',
      actions: [
        { actionName: 'Bite', count: 1, type: 'melee' },
        { actionName: 'Claw', count: 2, type: 'melee' },
      ],
    },
  ]);
});

test('convierte cada alternativa de action_options en un plan distinto', () => {
  const data = {
    actions: [
      {
        name: 'Multiattack',
        multiattack_type: 'action_options',
        action_options: {
          from: {
            options: [
              { option_type: 'action', action_name: 'Bow', count: 2 },
              {
                option_type: 'multiple',
                items: [
                  { option_type: 'action', action_name: 'Sword', count: 2 },
                  { option_type: 'action', action_name: 'Dagger', count: 1 },
                ],
              },
            ],
          },
        },
      },
      { name: 'Bow', attack_bonus: 3 },
      { name: 'Sword', attack_bonus: 3 },
      { name: 'Dagger', attack_bonus: 3 },
    ],
  };
  const plans = buildMultiattackPlans(data);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[1].actions, [
    { actionName: 'Sword', count: 2, type: null },
    { actionName: 'Dagger', count: 1, type: null },
  ]);
});

test('consume exactamente los golpes del plan y termina la secuencia', () => {
  const plans = buildMultiattackPlans(actionsMonster);
  const first = consumeMonsterAttack({ actionUsed: false, state: {}, actionName: 'Claw', planId: 'multi-0', plans });
  assert.equal(first.ok, true);
  assert.deepEqual(first.state.remaining, [
    { actionName: 'Bite', count: 1, type: 'melee' },
    { actionName: 'Claw', count: 1, type: 'melee' },
  ]);
  const second = consumeMonsterAttack({ actionUsed: true, state: first.state, actionName: 'Bite', planId: 'multi-0', plans });
  const third = consumeMonsterAttack({ actionUsed: true, state: second.state, actionName: 'Claw', planId: 'multi-0', plans });
  assert.equal(third.completed, true);
  assert.deepEqual(third.state, {});
  assert.equal(
    consumeMonsterAttack({ actionUsed: true, state: third.state, actionName: 'Claw', planId: null, plans }).ok,
    false
  );
});

test('normaliza los calificadores del vampiro al nombre real de la acción', () => {
  const data = {
    actions: [
      {
        name: 'Multiattack',
        multiattack_type: 'action_options',
        action_options: {
          from: {
            options: [
              {
                option_type: 'multiple',
                items: [
                  { option_type: 'action', action_name: 'Unarmed Strike (Vampire Form Only)', count: 1 },
                  { option_type: 'action', action_name: 'Bite (Bat or Vampire Form Only)', count: 1 },
                ],
              },
            ],
          },
        },
      },
      { name: 'Unarmed Strike', attack_bonus: 9 },
      { name: 'Bite', attack_bonus: 9 },
    ],
  };
  assert.deepEqual(buildMultiattackPlans(data)[0].actions.map((entry) => entry.actionName), [
    'Unarmed Strike',
    'Bite',
  ]);
});

test('resuelve una cantidad en dados una sola vez al empezar la secuencia', () => {
  const data = {
    actions: [
      {
        name: 'Multiattack',
        multiattack_type: 'actions',
        actions: [{ action_name: 'Rotting Touch', count: '1d4', type: 'melee' }],
      },
      { name: 'Rotting Touch', attack_bonus: 2 },
    ],
  };
  const plans = buildMultiattackPlans(data);
  assert.equal(plans[0].actions[0].countFormula, '1d4');
  const first = consumeMonsterAttack({
    actionUsed: false,
    state: {},
    actionName: 'Rotting Touch',
    planId: plans[0].id,
    plans,
    random: () => 0.99,
  });
  assert.deepEqual(first.resolvedCounts, [{ actionName: 'Rotting Touch', count: 4 }]);
  assert.equal(first.state.remaining[0].count, 3);
});

test('la hidra permite fijar sus cabezas actuales al iniciar el multiataque', () => {
  const data = {
    actions: [
      {
        name: 'Multiattack',
        multiattack_type: 'actions',
        actions: [{ action_name: 'Bite', count: 'Number of Heads', type: 'melee' }],
      },
      { name: 'Bite', attack_bonus: 8 },
    ],
  };
  const plans = buildMultiattackPlans(data);
  assert.equal(plans[0].actions[0].variableCount, 'heads');
  const first = consumeMonsterAttack({
    actionUsed: false,
    state: {},
    actionName: 'Bite',
    planId: plans[0].id,
    plans,
    countOverrides: { Bite: 7 },
  });
  assert.equal(first.state.remaining[0].count, 6);
});
