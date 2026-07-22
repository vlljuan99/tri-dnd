import test from 'node:test';
import assert from 'node:assert/strict';
import { monsterAttackGeometry, rangeValidation, weaponGeometry } from '../domain/combatGeometry.js';

test('el cliente refleja alcance y banda larga antes de tirar', () => {
  const bow = weaponGeometry({ weaponRange: 'Ranged', range: { normal: 30, long: 120 } });
  assert.equal(bow.normalRange, 6);
  assert.equal(rangeValidation(8, bow).longRange, true);
  assert.equal(rangeValidation(25, bow).ok, false);
});

test('el cliente reconoce alcance 10 pies de un monstruo', () => {
  assert.equal(monsterAttackGeometry({ desc: 'Melee Weapon Attack: reach 10 ft.' }).reach, 2);
});

test('el cliente permite lanzar un arma arrojadiza en sus dos bandas', () => {
  const javelin = weaponGeometry(
    { weaponRange: 'Melee', properties: ['thrown'], throwRange: { normal: 30, long: 120 } },
    { thrown: true }
  );
  assert.equal(javelin.ranged, true);
  assert.equal(javelin.normalRange, 6);
  assert.equal(javelin.longRange, 24);
});
