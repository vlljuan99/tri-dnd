import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerD20Roll, buildServerDamageRoll, parseDiceNotation } from '../serverDice.js';

test('la tirada con ventaja conserva ambos d20 y el mayor', () => {
  const values = [0, 0.95];
  const roll = buildServerD20Roll({ bonus: 4, advantage: 'adv', label: 'Ataque', actorName: 'A', random: () => values.shift() });
  assert.deepEqual(roll.groups[0].results[0], { rolls: [1, 20], kept: 20 });
  assert.equal(roll.total, 24);
  assert.equal(roll.crit, true);
});

test('el crítico duplica dados, no modificadores, y conserva componentes', () => {
  const result = buildServerDamageRoll({
    components: [
      { dice: '1d6+2', modifier: 1, type: 'fire' },
      { dice: '1d4', type: 'cold' },
    ],
    crit: true,
    label: 'Daño',
    actorName: 'A',
    random: () => 0,
  });
  assert.equal(result.roll.formula, '2d6 + 3 + 2d4');
  assert.deepEqual(result.components.map((entry) => entry.amount), [5, 2]);
});

test('solo acepta notación de dados acotada', () => {
  assert.deepEqual(parseDiceNotation('3d8 + 4'), { number: 3, sides: 8, modifier: 4 });
  assert.equal(parseDiceNotation('100d6'), null);
});
