import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armorPenaltyAppliesTo, isProficientWithWeapon, isProficientWithArmor, wearingUnproficientArmor, weaponAttackBonus } from '../proficiency.js';

test('competente por índice propio del arma', () => {
  assert.equal(isProficientWithWeapon(['dagger'], 'dagger', 'Simple'), true);
  assert.equal(isProficientWithWeapon(['dagger'], 'longsword', 'Martial'), false);
});

test('competente por categoría simple/marcial', () => {
  assert.equal(isProficientWithWeapon(['simple-weapons'], 'dagger', 'Simple'), true);
  assert.equal(isProficientWithWeapon(['simple-weapons'], 'longsword', 'Martial'), false);
  assert.equal(isProficientWithWeapon(['martial-weapons'], 'longsword', 'Martial'), true);
});

test('sin ninguna competencia relevante, no competente', () => {
  assert.equal(isProficientWithWeapon([], 'dagger', 'Simple'), false);
  assert.equal(isProficientWithWeapon(undefined, 'dagger', 'Simple'), false);
});

test('competencia de armadura por categoría, y all-armor cubre todo salvo escudos', () => {
  assert.equal(isProficientWithArmor(['light-armor'], { category: 'Light' }), true);
  assert.equal(isProficientWithArmor(['light-armor'], { category: 'Heavy' }), false);
  assert.equal(isProficientWithArmor(['all-armor'], { category: 'Heavy' }), true);
  assert.equal(isProficientWithArmor(['all-armor'], { category: 'Shield' }), false);
  assert.equal(isProficientWithArmor(['shield'], { category: 'Shield' }), true);
  assert.equal(isProficientWithArmor([], null), true, 'sin armadura equipada, no aplica penalización');
});

test('wearingUnproficientArmor detecta armadura o escudo sin competencia equipados', () => {
  const guerrero = {
    armor_proficiencies: ['all-armor', 'shield'],
    inventory: [{ slot: 'armadura', armor: { category: 'Heavy' } }, { slot: 'escudo', armor: { category: 'Shield' } }],
  };
  const mago = {
    armor_proficiencies: [],
    inventory: [{ slot: 'armadura', armor: { category: 'Heavy' } }],
  };
  assert.equal(wearingUnproficientArmor(guerrero), false);
  assert.equal(wearingUnproficientArmor(mago), true);
});

test('un jefe/enemigo del DM nunca lleva penalización de armadura', () => {
  const jefe = { kind: 'boss', armor_proficiencies: [], inventory: [{ slot: 'armadura', armor: { category: 'Heavy' } }] };
  assert.equal(wearingUnproficientArmor(jefe), false);
});

test('weaponAttackBonus solo suma competencia si el personaje es competente', () => {
  const mago = {
    level: 5,
    kind: 'pj',
    abilities: { str: 10, dex: 14 },
    weapon_proficiencies: ['dagger'],
  };
  const conEspada = weaponAttackBonus(mago, { srdIndex: 'longsword', weapon: { weaponRange: 'Melee', weaponCategory: 'Martial' } });
  const conDaga = weaponAttackBonus(mago, { srdIndex: 'dagger', weapon: { weaponRange: 'Melee', properties: ['finesse'], weaponCategory: 'Simple' } });
  assert.equal(conEspada, 0, 'sin competencia: solo el modificador de FUE (+0)');
  assert.equal(conDaga, 2 + 3, 'con competencia: DES (+2) + competencia nivel 5 (+3)');
});

test('un jefe/enemigo del DM se trata siempre como competente', () => {
  const jefe = { kind: 'boss', level: 5, abilities: { str: 14, dex: 10 }, weapon_proficiencies: [] };
  const bonus = weaponAttackBonus(jefe, { srdIndex: 'greataxe', weapon: { weaponRange: 'Melee', weaponCategory: 'Martial' } });
  assert.equal(bonus, 2 + 3);
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
