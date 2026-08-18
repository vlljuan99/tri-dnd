import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceClock,
  availableHitDice,
  formatClock,
  hitDiceRecovered,
  shortRestHealing,
} from '../rest.js';

test('los dados de golpe disponibles son el nivel menos los gastados', () => {
  assert.equal(availableHitDice(5, 0), 5);
  assert.equal(availableHitDice(5, 2), 3);
  assert.equal(availableHitDice(5, 9), 0, 'nunca quedan negativos');
});

test('cada dado gastado cura su tirada más CON, y nunca resta PG', () => {
  const bueno = shortRestHealing([5, 3], 2, 8);
  assert.equal(bueno.ok, true);
  assert.equal(bueno.healed, 12, '(5+2) + (3+2)');
  assert.equal(bueno.spent, 2);

  const conPenalizador = shortRestHealing([1], -3, 8);
  assert.equal(conPenalizador.healed, 0, 'un CON muy negativo cura 0, no quita PG');
});

test('una tirada imposible en el dado de golpe se rechaza', () => {
  assert.equal(shortRestHealing([9], 0, 8).ok, false, 'un d8 no saca 9');
  assert.equal(shortRestHealing([], 0, 8).ok, false, 'gastar cero dados no es descansar');
  assert.equal(shortRestHealing('dos', 0, 8).ok, false);
});

test('el descanso largo devuelve la mitad de los dados de golpe, mínimo uno', () => {
  assert.equal(hitDiceRecovered(1), 1, 'a nivel 1 se recupera uno, no cero');
  assert.equal(hitDiceRecovered(4), 2);
  assert.equal(hitDiceRecovered(5), 2);
  assert.equal(hitDiceRecovered(20), 10);
});

test('el reloj avanza y cruza de día cuando toca', () => {
  assert.deepEqual(advanceClock(8 * 60, 60), { dayMinutes: 9 * 60, daysCrossed: 0 });
  assert.deepEqual(advanceClock(22 * 60, 8 * 60), { dayMinutes: 6 * 60, daysCrossed: 1 }, '22:00 + 8 h → 06:00 del día siguiente');
  assert.deepEqual(advanceClock(0, 48 * 60), { dayMinutes: 0, daysCrossed: 2 });
});

test('la hora se enseña en formato de 24 horas', () => {
  assert.equal(formatClock(8 * 60), '08:00');
  assert.equal(formatClock(23 * 60 + 45), '23:45');
  assert.equal(formatClock(0), '00:00');
});
