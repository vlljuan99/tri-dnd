import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallDamageRoll, fallDiceForFeet } from '../fallDamage.js';

test('la caída usa 1d6 por cada 10 pies', () => {
  assert.equal(fallDiceForFeet(10), 1);
  assert.equal(fallDiceForFeet(30), 3);
  assert.equal(fallDiceForFeet(200), 20);
});

test('rechaza alturas fuera del rango o que no sean múltiplos de 10', () => {
  assert.equal(fallDiceForFeet(0), null);
  assert.equal(fallDiceForFeet(15), null);
  assert.equal(fallDiceForFeet(210), null);
  assert.equal(fallDiceForFeet('veinte'), null);
});

test('construye una tirada de chat y suma los resultados en el servidor', () => {
  const samples = [0, 0.5, 0.999999];
  let index = 0;
  const roll = buildFallDamageRoll({
    feet: 30,
    targetName: 'Ogro de prueba',
    random: () => samples[index++],
  });

  assert.equal(roll.formula, '3d6');
  assert.equal(roll.actorName, 'Ogro de prueba');
  assert.deepEqual(roll.groups[0].results.map((result) => result.kept), [1, 4, 6]);
  assert.equal(roll.total, 11);
});
