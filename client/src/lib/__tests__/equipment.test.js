import test from 'node:test';
import assert from 'node:assert/strict';
import { equipItem, computeArmorClass, availableSlotsFor } from '../equipment.js';

function daga(id = 'daga') {
  return { id, name: 'Daga', qty: 1, slot: null, weapon: { damageDice: '1d4', properties: ['finesse', 'light', 'thrown'] }, armor: null };
}
function espadon(id = 'espadon') {
  return { id, name: 'Espadón', qty: 1, slot: null, weapon: { damageDice: '2d6', properties: ['two-handed', 'heavy'] }, armor: null };
}
function escudo(id = 'escudo') {
  return { id, name: 'Escudo', qty: 1, slot: null, weapon: null, armor: { category: 'Shield', base: 2, dexBonus: false, maxBonus: null } };
}
function armaduraLigera(id = 'cuero') {
  return { id, name: 'Armadura de cuero', qty: 1, slot: null, weapon: null, armor: { category: 'Light', base: 11, dexBonus: true, maxBonus: null } };
}

test('availableSlotsFor distingue arma a dos manos, arma de una mano, armadura y escudo', () => {
  assert.deepEqual(availableSlotsFor(daga()), ['mano-principal', 'mano-secundaria']);
  assert.deepEqual(availableSlotsFor(espadon()), ['mano-principal']);
  assert.deepEqual(availableSlotsFor(armaduraLigera()), ['armadura']);
  assert.deepEqual(availableSlotsFor(escudo()), ['escudo']);
});

test('equipar en un slot ocupado libera lo que había antes', () => {
  const inventory = [daga('a'), daga('b')];
  const step1 = equipItem(inventory, 'a', 'mano-principal');
  const step2 = equipItem(step1, 'b', 'mano-principal');
  assert.equal(step2.find((i) => i.id === 'a').slot, null);
  assert.equal(step2.find((i) => i.id === 'b').slot, 'mano-principal');
});

test('equipar un arma a dos manos libera la mano secundaria y el escudo', () => {
  const inventory = [daga('a'), escudo('b'), espadon('c')];
  const withOffhand = equipItem(equipItem(inventory, 'a', 'mano-secundaria'), 'b', 'escudo');
  const withTwoHanded = equipItem(withOffhand, 'c', 'mano-principal');
  assert.equal(withTwoHanded.find((i) => i.id === 'b').slot, null);
  assert.equal(withTwoHanded.find((i) => i.id === 'c').slot, 'mano-principal');
});

test('el escudo y la mano secundaria se disputan la misma mano', () => {
  const inventory = [daga('a'), escudo('b')];
  const conDaga = equipItem(inventory, 'a', 'mano-secundaria');
  const conEscudo = equipItem(conDaga, 'b', 'escudo');
  assert.equal(conEscudo.find((i) => i.id === 'a').slot, null, 'el escudo desplaza al arma secundaria');

  const deVuelta = equipItem(conEscudo, 'a', 'mano-secundaria');
  assert.equal(deVuelta.find((i) => i.id === 'b').slot, null, 'y el arma secundaria desplaza al escudo');
});

test('no se puede equipar un arma a dos manos en la mano secundaria', () => {
  const inventory = [espadon('a')];
  const next = equipItem(inventory, 'a', 'mano-secundaria');
  assert.equal(next.find((i) => i.id === 'a').slot, null, 'la petición inválida se ignora');
});

test('computeArmorClass coincide con el cálculo del servidor', () => {
  const personaje = {
    abilities: { dex: 16 },
    ac_override: null,
    inventory: [{ ...armaduraLigera(), slot: 'armadura' }, { ...escudo(), slot: 'escudo' }],
  };
  assert.equal(computeArmorClass(personaje), 11 + 3 + 2);
});
