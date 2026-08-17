import assert from 'node:assert/strict';
import test from 'node:test';
import { sceneLighting, TACTICAL_CAMERA_DISTANCE, weatherFog } from '../domain/weather.js';

test('la lluvia no satura el tablero situado bajo la cámara táctica', () => {
  const map = { weather: 'lluvia', weatherIntensity: 0.7, width: 26, height: 18 };
  const fog = weatherFog(map);
  const farthestBoardPoint = TACTICAL_CAMERA_DISTANCE + Math.hypot(map.width, map.height) / 2;

  assert.equal(fog.color, '#283039');
  assert.ok(fog.near < TACTICAL_CAMERA_DISTANCE);
  assert.ok(fog.far > farthestBoardPoint);
});

test('la niebla conserva visibles hasta las esquinas de un mapa grande', () => {
  const map = { weather: 'niebla', weatherIntensity: 1, width: 50, height: 40 };
  const fog = weatherFog(map);
  const farthestBoardPoint = TACTICAL_CAMERA_DISTANCE + Math.hypot(map.width, map.height) / 2;

  assert.ok(fog.near < TACTICAL_CAMERA_DISTANCE);
  assert.ok(fog.far > farthestBoardPoint);
});

test('los climas sin bruma no añaden fog a la escena', () => {
  assert.equal(weatherFog({ weather: 'despejado', width: 20, height: 20 }), null);
  assert.equal(weatherFog({ weather: 'nieve', width: 20, height: 20 }), null);
});

test('una intensidad cero de lluvia se conserva como valor válido', () => {
  const noIntensity = weatherFog({ weather: 'lluvia', weatherIntensity: 0, width: 20, height: 20 });
  const defaultIntensity = weatherFog({ weather: 'lluvia', width: 20, height: 20 });

  assert.ok(noIntensity.near > defaultIntensity.near);
});

test('la iluminación nocturna es más tenue que la diurna', () => {
  const day = sceneLighting({ timeOfDay: 'dia' }, false);
  const night = sceneLighting({ timeOfDay: 'noche' }, false);

  assert.ok(night.ambient < day.ambient);
  assert.ok(night.directional < day.directional);
});
