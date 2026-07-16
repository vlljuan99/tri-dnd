import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerceptionRoll, discoverableTrapIds, perceptionBonus } from '../perception.js';

const character = {
  name: 'Lira',
  level: 5,
  abilities: JSON.stringify({ wis: 16 }),
  skill_proficiencies: JSON.stringify(['perception']),
};

test('calcula percepción con Sabiduría y competencia', () => {
  assert.equal(perceptionBonus(character), 6);
  assert.equal(perceptionBonus({ level: 1, abilities: '{"wis":8}', skill_proficiencies: '[]' }), -1);
});

test('la tirada de percepción se resuelve en servidor', () => {
  const roll = buildPerceptionRoll(character, () => 0.5);
  assert.equal(roll.formula, '1d20+6');
  assert.equal(roll.groups[0].results[0].kept, 11);
  assert.equal(roll.total, 17);
  assert.deepEqual(roll.groups, [
    { die: 'd20', sides: 20, results: [{ rolls: [11], kept: 11 }] },
  ]);
});

test('solo descubre trampas visibles cuya CD supera la tirada', () => {
  const traps = [
    { id: 1, x: 2, y: 2, perception_dc: 12 },
    { id: 2, x: 3, y: 3, perception_dc: 18 },
    { id: 3, x: 9, y: 9, perception_dc: 5 },
    { id: 4, x: 4, y: 4, perception_dc: null },
  ];
  const visible = new Set(['2,2', '3,3', '4,4']);
  assert.deepEqual(discoverableTrapIds(traps, visible, 15), [1, 4]);
});
