import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AZIMUTH_STEP,
  TILT_INITIAL,
  TILT_MAX,
  orbitBy,
  rotateBy,
  viewDegrees,
  withTilt,
} from '../domain/camera.js';

const inicial = { tilt: TILT_INITIAL, azimuth: 0 };

test('arrastrar hacia arriba levanta la vista y hacia abajo la aplana', () => {
  assert.ok(orbitBy(inicial, 0, -40).tilt > inicial.tilt, 'arriba = más escorzo');
  assert.ok(orbitBy(inicial, 0, 40).tilt < inicial.tilt, 'abajo = hacia cenital');
});

test('arrastrar en horizontal gira el tablero en el sentido del ratón', () => {
  assert.ok(orbitBy(inicial, 50, 0).azimuth > 0);
  assert.ok(orbitBy(inicial, -50, 0).azimuth < 0);
  assert.equal(orbitBy(inicial, 50, 0).tilt, inicial.tilt, 'girar no toca la inclinación');
});

test('la inclinación nunca se sale de sus topes', () => {
  // Sin tope, un arrastre largo mete la cámara bajo el suelo o la deja del revés
  assert.equal(orbitBy(inicial, 0, -100000).tilt, TILT_MAX);
  assert.equal(orbitBy(inicial, 0, 100000).tilt, 0);
  assert.equal(withTilt(inicial, 99).tilt, TILT_MAX);
  assert.equal(withTilt(inicial, -3).tilt, 0);
  assert.equal(withTilt(inicial, 'no es un número').tilt, 0);
});

test('cada pulsación de Q/E gira exactamente 45°', () => {
  assert.equal(rotateBy(inicial, 1).azimuth, AZIMUTH_STEP);
  assert.equal(rotateBy(inicial, -1).azimuth, -AZIMUTH_STEP);
  // Ocho pulsaciones dan la vuelta completa
  let vista = inicial;
  for (let i = 0; i < 8; i += 1) vista = rotateBy(vista, 1);
  assert.ok(Math.abs(vista.azimuth - Math.PI * 2) < 1e-9);
});

test('el HUD recibe grados enteros y un azimut siempre positivo', () => {
  assert.equal(Math.round(viewDegrees(inicial).tiltDeg), 26);
  assert.equal(viewDegrees({ tilt: 0, azimuth: -Math.PI / 2 }).azimuthDeg, 270);
  assert.equal(viewDegrees({ tilt: 0, azimuth: Math.PI / 2 }).azimuthDeg, 90);
});
