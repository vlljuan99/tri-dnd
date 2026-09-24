import test from 'node:test';
import assert from 'node:assert/strict';
import { healthLabel } from '../healthLabels.js';

test('la etiqueta de salud cambia en los umbrales', () => {
  assert.equal(healthLabel(40, 40), 'ileso');
  assert.equal(healthLabel(39, 40), 'herido');
  assert.equal(healthLabel(21, 40), 'herido');
  assert.equal(healthLabel(20, 40), 'malherido', 'la mitad justa ya es malherido');
  assert.equal(healthLabel(11, 40), 'malherido');
  assert.equal(healthLabel(10, 40), 'a punto de caer', 'un cuarto justo');
  assert.equal(healthLabel(1, 40), 'a punto de caer');
  assert.equal(healthLabel(0, 40), 'caído');
  assert.equal(healthLabel(-3, 40), 'caído');
});

test('sin PG que leer no hay etiqueta', () => {
  assert.equal(healthLabel(null, 40), null);
  assert.equal(healthLabel(10, 0), null);
  assert.equal(healthLabel(undefined, undefined), null);
});
