import test from 'node:test';
import assert from 'node:assert/strict';
import { esSacudida, UMBRAL_SACUDIDA } from '../lib/shake.js';

test('una sacudida deliberada cuenta; el móvil en reposo o al andar, no', () => {
  assert.equal(esSacudida({ x: 0, y: 9.8, z: 0 }), false, 'en reposo solo está la gravedad');
  assert.equal(esSacudida({ x: 6, y: 11, z: 3 }), false, 'andar con el móvil en la mano');
  assert.equal(esSacudida({ x: 22, y: 14, z: 8 }), true);
  assert.equal(esSacudida({ x: UMBRAL_SACUDIDA, y: 0, z: 0 }), false, 'el umbral exacto no basta');
});

test('lecturas incompletas del acelerómetro no disparan nada', () => {
  assert.equal(esSacudida(null), false);
  assert.equal(esSacudida({ x: null, y: 30, z: 0 }), false);
  assert.equal(esSacudida({ x: 40, y: 0 }), false);
});
