import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTILE_KINDS, projectileKind } from '../projectiles.js';

const distancia = { ranged: true, reach: 0, normalRange: 16, longRange: 64 };
const cuerpoACuerpo = { ranged: false, reach: 1 };
const arrojada = { ranged: true, reach: 0, normalRange: 6, longRange: 24, thrown: true };

test('un arma cuerpo a cuerpo no dispara nada', () => {
  assert.equal(projectileKind({ geometry: cuerpoACuerpo, srdIndex: 'longsword', name: 'Espada larga' }), null);
  assert.equal(projectileKind({ geometry: null, name: 'Golpe desarmado' }), null);
});

test('cada arma del compendio dispara lo suyo', () => {
  assert.equal(projectileKind({ geometry: distancia, srdIndex: 'shortbow' }), 'flecha');
  assert.equal(projectileKind({ geometry: distancia, srdIndex: 'crossbow-heavy' }), 'virote');
  assert.equal(projectileKind({ geometry: distancia, srdIndex: 'sling' }), 'piedra');
  assert.equal(projectileKind({ geometry: distancia, srdIndex: 'blowgun' }), 'dardo');
});

test('lanzar un arma manda sobre su familia', () => {
  assert.equal(projectileKind({ geometry: arrojada, srdIndex: 'javelin' }), 'lanzada');
  assert.equal(projectileKind({ geometry: arrojada, srdIndex: 'dagger' }), 'lanzada');
  // Un arco arrojado (raro, pero posible) vuela como un trasto, no dispara
  assert.equal(projectileKind({ geometry: arrojada, srdIndex: 'shortbow' }), 'lanzada');
});

test('sin índice del SRD manda el nombre, en español o en inglés', () => {
  assert.equal(projectileKind({ geometry: distancia, name: 'Arco largo élfico' }), 'flecha');
  assert.equal(projectileKind({ geometry: distancia, name: 'Longbow, +1' }), 'flecha');
  assert.equal(projectileKind({ geometry: distancia, name: 'Ballesta pesada' }), 'virote');
  // "crossbow" contiene "bow": si el orden de las reglas se invierte, una
  // ballesta empieza a disparar flechas.
  assert.equal(projectileKind({ geometry: distancia, name: 'Heavy crossbow' }), 'virote');
  assert.equal(projectileKind({ geometry: distancia, name: 'Honda de cuero' }), 'piedra');
  assert.equal(projectileKind({ geometry: distancia, name: 'Rayo de escarcha' }), 'conjuro');
});

test('un ataque a distancia sin pistas vuela igualmente', () => {
  // Ficha de monstruo con un ataque a distancia que no dice con qué: mejor un
  // proyectil genérico que nada cruzando el tablero.
  const generico = projectileKind({ geometry: distancia, name: 'Escupitajo ácido' });
  assert.equal(generico, 'proyectil');
  assert.ok(PROJECTILE_KINDS.includes(generico));
});
