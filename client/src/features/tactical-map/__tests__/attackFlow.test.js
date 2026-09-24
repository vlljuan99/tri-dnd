import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awaitingDamage,
  canStartAttack,
  hasAttackLeft,
  sfxForCombatVisual,
  visibleAttackRows,
} from '../domain/attackFlow.js';
import { isSfxKey } from '../../../lib/sfx/catalog.js';

const dardo = { id: 12, name: 'Dardo' };
const desarmado = { id: 'desarmado', name: 'Golpe desarmado' };
const rows = [dardo, desarmado];

test('un impacto deja el daño pendiente; un fallo o el daño ya tirado, no', () => {
  assert.equal(awaitingDamage({ type: 'attack', weaponId: 12, hit: true }), true);
  assert.equal(awaitingDamage({ type: 'attack', weaponId: 12, hit: false }), false);
  assert.equal(awaitingDamage({ type: 'damage', weaponId: 12 }), false);
  assert.equal(awaitingDamage(null), false);
  assert.equal(
    awaitingDamage({ type: 'attack', weaponId: 12, hit: true, canDamage: false }),
    false,
    'una acción sin dados de daño se queda en el impacto'
  );
});

test('solo queda otro ataque en combate y con la acción sin gastar o un Multiataque a medias', () => {
  assert.equal(hasAttackLeft({ combatActive: true, combatant: { actionUsed: false } }), true);
  assert.equal(hasAttackLeft({ combatActive: true, combatant: { actionUsed: true } }), false);
  assert.equal(
    hasAttackLeft({
      combatActive: true,
      combatant: { actionUsed: true },
      multiattackState: { planId: 'multi', remaining: [{ actionName: 'Garra', count: 1 }] },
    }),
    true
  );
  assert.equal(
    hasAttackLeft({ combatActive: true, combatant: { actionUsed: true }, multiattackState: {} }),
    false
  );
  assert.equal(hasAttackLeft({ combatActive: false, combatant: { actionUsed: false } }), false, 'fuera de combate');
  assert.equal(hasAttackLeft({ combatActive: true, combatant: null }), false, 'sin entrada en el tracker');
});

test('los botones de ataque solo se ofrecen cuando se puede atacar', () => {
  assert.equal(canStartAttack({ feedback: null, attackLeft: false }), true, 'antes del primer ataque');
  const hit = { type: 'attack', weaponId: 12, hit: true };
  assert.equal(canStartAttack({ feedback: hit, attackLeft: true }), false, 'con daño pendiente toca tirarlo');
  const miss = { type: 'attack', weaponId: 12, hit: false };
  assert.equal(canStartAttack({ feedback: miss, attackLeft: false }), false);
  assert.equal(canStartAttack({ feedback: miss, attackLeft: true }), true);
});

test('con un arma empuñada solo se ve esa', () => {
  assert.deepEqual(visibleAttackRows(rows, { armedId: 12 }), [dardo]);
  assert.deepEqual(visibleAttackRows(rows, { armedId: 'desarmado' }), [desarmado]);
  assert.deepEqual(visibleAttackRows(rows, {}), rows, 'sin arma elegida, todas');
  assert.deepEqual(visibleAttackRows(rows, { armedId: 99 }), rows, 'un arma que ya no está no vacía el panel');
});

test('tras tirar con un arma, las demás desaparecen mientras dura el ataque', () => {
  const hit = { type: 'attack', weaponId: 'desarmado', hit: true };
  assert.deepEqual(visibleAttackRows(rows, { feedback: hit, attackLeft: true }), [desarmado]);
  const miss = { type: 'attack', weaponId: 'desarmado', hit: false };
  assert.deepEqual(visibleAttackRows(rows, { feedback: miss, attackLeft: false }), [desarmado]);
  assert.deepEqual(visibleAttackRows(rows, { feedback: miss, attackLeft: true }), rows, 'con otro ataque, se elige de nuevo');
});

test('cada golpe resuelto suena con su clave del catálogo', () => {
  assert.equal(sfxForCombatVisual({ type: 'hit', critical: false }), 'attack.hit');
  assert.equal(sfxForCombatVisual({ type: 'hit', critical: true }), 'attack.crit');
  assert.equal(sfxForCombatVisual({ type: 'miss' }), 'attack.miss');
  assert.equal(sfxForCombatVisual({ type: 'heal', value: 4 }), 'heal');
  assert.equal(sfxForCombatVisual({ type: 'damage', value: 4 }), null, 'el daño no repite el sonido del impacto');
  assert.equal(sfxForCombatVisual({ type: 'proyectil' }), null);
  assert.equal(sfxForCombatVisual(null), null);
  for (const type of ['hit', 'miss', 'heal']) {
    for (const critical of [false, true]) {
      assert.ok(isSfxKey(sfxForCombatVisual({ type, critical })), `${type} apunta a una clave que existe`);
    }
  }
});
