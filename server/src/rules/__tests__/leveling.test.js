import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAbilityIncreases,
  hitPointsGain,
  nextHitPoints,
  validateAbilityIncreases,
} from '../leveling.js';

test('el valor fijo de PG es la mitad del dado más uno, y suma CON', () => {
  assert.equal(hitPointsGain(10, 2, { method: 'fijo' }), 8, 'd10 → 6 + 2 de CON');
  assert.equal(hitPointsGain(6, 0, { method: 'fijo' }), 4, 'd6 → 4');
});

test('un modificador de CON muy negativo nunca deja el nivel a cero PG', () => {
  assert.equal(hitPointsGain(6, -5, { method: 'fijo' }), 1, 'el manual garantiza 1 PG por nivel');
});

test('la tirada tiene que caber en el dado de golpe', () => {
  assert.equal(hitPointsGain(8, 1, { method: 'tirada', roll: 8 }), 9);
  assert.equal(hitPointsGain(8, 1, { method: 'tirada', roll: 9 }), null, 'un d8 no saca 9');
  assert.equal(hitPointsGain(8, 1, { method: 'tirada', roll: 0 }), null);
  assert.equal(hitPointsGain(8, 1, { method: 'tirada', roll: null }), null);
});

test('la mejora reparte dos puntos como mucho y respeta el tope de 20', () => {
  const abilities = { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 };
  assert.equal(validateAbilityIncreases({ str: 2 }, abilities).ok, true);
  assert.equal(validateAbilityIncreases({ str: 1, con: 1 }, abilities).ok, true);
  assert.equal(validateAbilityIncreases({ str: 1, con: 1, dex: 1 }, abilities).ok, false, 'tres puntos no');
  assert.equal(validateAbilityIncreases({ str: 3 }, abilities).ok, false, 'ninguna sube 3 de golpe');
  assert.equal(validateAbilityIncreases({ str: 2 }, { ...abilities, str: 19 }).ok, false, '19 + 2 pasa de 20');
  assert.equal(validateAbilityIncreases({ luck: 1 }, abilities).ok, false, 'característica inventada');
  assert.deepEqual(validateAbilityIncreases(null, abilities), { ok: true, increases: {} });
});

test('aplicar la mejora no pasa de 20 ni toca lo demás', () => {
  const next = applyAbilityIncreases({ str: 19, con: 14 }, { str: 2, con: 1 });
  assert.deepEqual(next, { str: 20, con: 15 });
});

test('los PG nuevos se suman a los que ya tenía, no se recalculan', () => {
  assert.deepEqual(nextHitPoints({ hpMax: 12, hpCurrent: 5 }, 7), { hpMax: 19, hpCurrent: 12 });
});
