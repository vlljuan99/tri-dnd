import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTILE_LOOKS, flightDuration, projectileLook, resolveProjectile } from '../domain/projectiles.js';

const tokens = [
  { id: 'a', characterId: 25, serverId: null, position: { x: 1, y: 0, z: 1 } },
  { id: 'b', characterId: null, serverId: 61, position: { x: 9, y: 0, z: 1 } },
];

test('cada familia tiene su aspecto y el desconocido cae en el genérico', () => {
  assert.equal(projectileLook('flecha').shape, 'asta');
  assert.equal(projectileLook('piedra').shape, 'bola');
  assert.equal(projectileLook('lanzada').spin, true, 'el arma arrojada gira al volar');
  assert.equal(projectileLook('flecha').spin, false, 'una flecha vuela recta');
  assert.deepEqual(projectileLook('lo-que-sea'), PROJECTILE_LOOKS.proyectil);
});

test('el vuelo dura según la distancia, pero acotado por los dos extremos', () => {
  const corto = flightDuration(1, 'flecha');
  const largo = flightDuration(20, 'flecha');
  assert.ok(largo > corto, 'más lejos, más tiempo en el aire');
  assert.ok(corto >= 140, 'ni un disparo pegado es instantáneo');
  assert.ok(flightDuration(500, 'flecha') <= 900, 'ni uno lejísimos deja la mesa esperando');
});

test('las dos puntas se resuelven contra las fichas del tablero', () => {
  const vuelo = resolveProjectile(
    { type: 'proyectil', kind: 'flecha', from: { characterId: 25 }, to: { mapTokenId: 61 }, hit: true },
    tokens
  );
  assert.equal(vuelo.from.id, 'a');
  assert.equal(vuelo.to.id, 'b');
  assert.equal(vuelo.hit, true);
});

test('si una de las dos fichas ya no está, no vuela nada', () => {
  const visual = { type: 'proyectil', kind: 'flecha', from: { characterId: 99 }, to: { mapTokenId: 61 } };
  assert.equal(resolveProjectile(visual, tokens), null);
  assert.equal(resolveProjectile({ ...visual, from: { characterId: 25 }, to: { mapTokenId: 999 } }, tokens), null);
});

test('los demás efectos de combate no se confunden con un proyectil', () => {
  assert.equal(resolveProjectile({ type: 'damage', characterId: 25, value: 7 }, tokens), null);
  assert.equal(resolveProjectile(null, tokens), null);
});
