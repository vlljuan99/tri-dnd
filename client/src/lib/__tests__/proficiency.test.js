import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armorPenaltyAppliesTo, isProficientWithWeapon, isProficientWithArmor, wearingUnproficientArmor } from '../proficiency.js';
import { weaponAttackBonus } from '../dnd.js';

test('competente por índice propio o por categoría simple/marcial', () => {
  assert.equal(isProficientWithWeapon(['dagger'], 'dagger', 'Simple'), true);
  assert.equal(isProficientWithWeapon(['simple-weapons'], 'dagger', 'Simple'), true);
  assert.equal(isProficientWithWeapon(['martial-weapons'], 'dagger', 'Simple'), false);
  assert.equal(isProficientWithWeapon([], 'dagger', 'Simple'), false);
});

test('competencia de armadura: all-armor cubre ligera/media/pesada, no escudos', () => {
  assert.equal(isProficientWithArmor(['all-armor'], { category: 'Medium' }), true);
  assert.equal(isProficientWithArmor(['all-armor'], { category: 'Shield' }), false);
  assert.equal(isProficientWithArmor([], null), true);
});

test('wearingUnproficientArmor exime a las fichas del DM', () => {
  const jefe = { kind: 'boss', armor_proficiencies: [], inventory: [{ slot: 'armadura', armor: { category: 'Heavy' } }] };
  assert.equal(wearingUnproficientArmor(jefe), false);
});

test('weaponAttackBonus del cliente coincide con el del servidor para el mismo personaje', () => {
  const mago = { level: 5, kind: 'pj', abilities: { str: 10, dex: 14 }, weapon_proficiencies: ['dagger'] };
  const conEspada = weaponAttackBonus(mago, {
    srdIndex: 'longsword',
    weapon: { weaponRange: 'Melee', weaponCategory: 'Martial', properties: [] },
  });
  const conDaga = weaponAttackBonus(mago, {
    srdIndex: 'dagger',
    weapon: { weaponRange: 'Melee', weaponCategory: 'Simple', properties: ['finesse'] },
  });
  assert.equal(conEspada, 0, 'sin competencia: solo el modificador de FUE (+0)');
  assert.equal(conDaga, 2 + 3, 'con competencia: DES (+2) + competencia nivel 5 (+3)');
});

test('la armadura sin competencia da desventaja solo en FUE y DES', () => {
  const conCota = {
    kind: 'pj',
    armor_proficiencies: [],
    inventory: [{ slot: 'armadura', armor: { category: 'Heavy', base: 16 } }],
  };
  assert.equal(armorPenaltyAppliesTo(conCota, 'str'), true);
  assert.equal(armorPenaltyAppliesTo(conCota, 'dex'), true);
  assert.equal(armorPenaltyAppliesTo(conCota, 'con'), false, 'la salvación de CON no se ve afectada');
  assert.equal(armorPenaltyAppliesTo(conCota, 'wis'), false);

  const competente = { ...conCota, armor_proficiencies: ['heavy-armor'] };
  assert.equal(armorPenaltyAppliesTo(competente, 'str'), false);

  const jefe = { ...conCota, kind: 'boss' };
  assert.equal(armorPenaltyAppliesTo(jefe, 'dex'), false, 'las fichas del DM quedan exentas');
});
