import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock } from '../clock.js';

// Espejo de server/src/rules/rest.js: los dos tienen que decir la misma hora.
test('la hora coincide con la que calcula el servidor', () => {
  assert.equal(formatClock(8 * 60), '08:00');
  assert.equal(formatClock(16 * 60), '16:00');
  assert.equal(formatClock(23 * 60 + 45), '23:45');
  assert.equal(formatClock(0), '00:00');
});

test('una hora fuera del día se normaliza en vez de romper la mesa', () => {
  assert.equal(formatClock(25 * 60), '01:00');
  assert.equal(formatClock(-60), '23:00');
  assert.equal(formatClock(undefined), '00:00');
});
