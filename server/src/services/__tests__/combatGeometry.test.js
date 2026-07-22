import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monsterAttackGeometry,
  rangeValidation,
  spellRangeSquares,
  weaponGeometry,
} from '../combatGeometry.js';

test('las armas usan alcance, distancia normal y distancia larga del SRD', () => {
  assert.deepEqual(
    weaponGeometry({ weaponRange: 'Ranged', range: { normal: 150, long: 600 }, properties: [] }),
    {
      ranged: true,
      reach: 0,
      normalRange: 30,
      longRange: 120,
      thrownNormalRange: null,
      thrownLongRange: null,
      thrown: false,
    }
  );
  assert.equal(weaponGeometry({ weaponRange: 'Melee', properties: ['reach'] }).reach, 2);
  assert.deepEqual(
    weaponGeometry(
      { weaponRange: 'Melee', properties: ['thrown'], throwRange: { normal: 20, long: 60 } },
      null,
      { thrown: true }
    ),
    {
      ranged: true,
      reach: 0,
      normalRange: 4,
      longRange: 12,
      thrownNormalRange: 4,
      thrownLongRange: 12,
      thrown: true,
    }
  );
});

test('la distancia larga da desventaja y más allá del máximo bloquea', () => {
  const geometry = { ranged: true, normalRange: 6, longRange: 24 };
  assert.deepEqual(rangeValidation(6, geometry), { ok: true, longRange: false });
  assert.deepEqual(rangeValidation(7, geometry), { ok: true, longRange: true });
  assert.equal(rangeValidation(25, geometry).ok, false);
});

test('lee alcance y rango de la prosa de ataques de monstruo', () => {
  assert.equal(monsterAttackGeometry({ desc: 'Melee Weapon Attack: reach 10 ft.' }).reach, 2);
  assert.deepEqual(monsterAttackGeometry({ desc: 'Ranged Weapon Attack: range 80/320 ft.' }), {
    ranged: true,
    reach: 0,
    normalRange: 16,
    longRange: 64,
  });
});

test('convierte el alcance de un conjuro a casillas', () => {
  assert.equal(spellRangeSquares({ range: '120 feet' }), 24);
  assert.equal(spellRangeSquares({ range: 'Touch' }), 1);
  assert.equal(spellRangeSquares({ range: 'Self' }), 0);
});
