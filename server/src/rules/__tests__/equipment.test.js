import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInventory, computeArmorClass } from '../equipment.js';

function espadaLarga(slot = null) {
  return {
    id: 'espada',
    name: 'Espada larga',
    qty: 1,
    slot,
    weapon: { damageDice: '1d8', damageType: 'slashing', versatileDice: '1d10', properties: ['versatile'] },
    armor: null,
  };
}

function espadon(slot = null) {
  return {
    id: 'espadon',
    name: 'Espadón',
    qty: 1,
    slot,
    weapon: { damageDice: '2d6', damageType: 'slashing', properties: ['two-handed', 'heavy'] },
    armor: null,
  };
}

function cotaDeMalla(slot = null) {
  return {
    id: 'malla',
    name: 'Cota de malla',
    qty: 1,
    slot,
    weapon: null,
    armor: { category: 'Heavy', base: 16, dexBonus: false, maxBonus: null, strMinimum: 13, stealthDisadvantage: true },
  };
}

function cotaDeEscamas(slot = null) {
  return {
    id: 'escamas',
    name: 'Cota de escamas',
    qty: 1,
    slot,
    weapon: null,
    armor: { category: 'Medium', base: 14, dexBonus: true, maxBonus: 2, strMinimum: 0, stealthDisadvantage: true },
  };
}

function escudo(slot = null) {
  return {
    id: 'escudo',
    name: 'Escudo',
    qty: 1,
    slot,
    weapon: null,
    armor: { category: 'Shield', base: 2, dexBonus: false, maxBonus: null, strMinimum: 0, stealthDisadvantage: false },
  };
}

test('un inventario vacío o solo con objetos en la mochila es válido', () => {
  assert.equal(validateInventory([]), true);
  assert.equal(validateInventory([espadaLarga(null)]), true);
});

test('un arma a dos manos no puede convivir con nada en la mano secundaria', () => {
  assert.equal(validateInventory([espadon('mano-principal'), espadaLarga('mano-secundaria')]), false);
  assert.equal(validateInventory([espadon('mano-principal'), escudo('escudo')]), false);
  assert.equal(validateInventory([espadon('mano-principal')]), true);
});

test('un arma a dos manos no puede ir directamente en la mano secundaria', () => {
  assert.equal(validateInventory([espadon('mano-secundaria')]), false);
});

test('dos armas de una mano pueden repartirse entre ambas manos', () => {
  assert.equal(validateInventory([espadaLarga('mano-principal'), espadaLarga('mano-secundaria')]), true);
});

test('el escudo ocupa la mano secundaria: no convive con un arma en ella', () => {
  assert.equal(validateInventory([espadaLarga('mano-principal'), escudo('escudo')]), true);
  assert.equal(validateInventory([escudo('escudo'), espadaLarga('mano-secundaria')]), false);
});

test('solo un objeto puede ocupar el slot de armadura o el de escudo', () => {
  assert.equal(validateInventory([cotaDeMalla('armadura'), cotaDeEscamas('armadura')]), false);
  assert.equal(validateInventory([cotaDeMalla('armadura'), escudo('escudo')]), true);
});

test('un escudo no puede ir al slot de armadura ni una armadura al de escudo', () => {
  assert.equal(validateInventory([escudo('armadura')]), false);
  assert.equal(validateInventory([cotaDeMalla('escudo')]), false);
});

test('sin armadura la CA es 10 + DES', () => {
  const personaje = { abilities: { dex: 16 }, inventory: [], ac_override: null };
  assert.equal(computeArmorClass(personaje), 13);
});

test('la armadura pesada ignora el modificador de DES', () => {
  const personaje = { abilities: { dex: 18 }, inventory: [cotaDeMalla('armadura')], ac_override: null };
  assert.equal(computeArmorClass(personaje), 16);
});

test('la armadura media limita el bonificador de DES a su tope', () => {
  const personaje = { abilities: { dex: 18 }, inventory: [cotaDeEscamas('armadura')], ac_override: null };
  assert.equal(computeArmorClass(personaje), 16, '14 base + tope de +2, no el +4 completo de DES');
});

test('el escudo suma su bonificador aparte de la armadura', () => {
  const personaje = {
    abilities: { dex: 14 },
    inventory: [cotaDeEscamas('armadura'), escudo('escudo')],
    ac_override: null,
  };
  assert.equal(computeArmorClass(personaje), 18, '14 + 2 (tope DES) + 2 (escudo)');
});

test('ac_override manda siempre sobre lo derivado', () => {
  const personaje = { abilities: { dex: 20 }, inventory: [cotaDeMalla('armadura')], ac_override: 25 };
  assert.equal(computeArmorClass(personaje), 25);
});
