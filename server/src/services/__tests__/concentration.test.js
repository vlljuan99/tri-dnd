import test from 'node:test';
import assert from 'node:assert/strict';
import {
  concentrationDC,
  concentrationSaveBonus,
  buildConcentrationSaveRoll,
  resolveConcentrationSave,
} from '../concentration.js';

test('la CD es 10 o la mitad del daño, lo que sea mayor', () => {
  assert.equal(concentrationDC(1), 10);
  assert.equal(concentrationDC(20), 10);
  assert.equal(concentrationDC(21), 10);
  assert.equal(concentrationDC(22), 11);
  assert.equal(concentrationDC(39), 19);
  assert.equal(concentrationDC(40), 20);
});

test('la CD aguanta daños ausentes o absurdos sin romperse', () => {
  assert.equal(concentrationDC(0), 10);
  assert.equal(concentrationDC(-5), 10);
  assert.equal(concentrationDC(undefined), 10);
  assert.equal(concentrationDC('mucho'), 10);
});

test('el bonificador suma competencia solo si la ficha salva en Constitución', () => {
  const base = { abilities: JSON.stringify({ con: 16 }), level: 5 };
  assert.equal(concentrationSaveBonus({ ...base, save_proficiencies: '[]' }), 3);
  assert.equal(concentrationSaveBonus({ ...base, save_proficiencies: '["con"]' }), 6);
  // La competencia de otra característica no cuenta para esta salvación
  assert.equal(concentrationSaveBonus({ ...base, save_proficiencies: '["dex","wis"]' }), 3);
});

test('el bonificador sobrevive a fichas con datos corruptos', () => {
  assert.equal(concentrationSaveBonus({ abilities: 'no-json', save_proficiencies: 'ni-esto' }), 0);
  assert.equal(concentrationSaveBonus(undefined), 0);
});

test('la tirada la construye el servidor con el formato del chat', () => {
  const roll = buildConcentrationSaveRoll({
    actorName: 'Elara',
    bonus: 3,
    spell: 'Bendición',
    random: () => 0.5, // → d20 = 11
  });

  assert.equal(roll.formula, '1d20+3');
  assert.equal(roll.actorName, 'Elara');
  assert.equal(roll.label, 'Concentración (Bendición)');
  assert.equal(roll.natural, 11);
  assert.equal(roll.total, 14);
  assert.deepEqual(roll.groups[0].results, [{ rolls: [11], kept: 11 }]);
});

test('un bonificador negativo se formatea con su signo', () => {
  const roll = buildConcentrationSaveRoll({ actorName: 'Zub', bonus: -1, random: () => 0 });
  assert.equal(roll.formula, '1d20-1');
  assert.equal(roll.total, 0);
});

test('la salvación se resuelve contra la CD', () => {
  assert.equal(resolveConcentrationSave({ total: 14, natural: 11, dc: 10 }).held, true);
  assert.equal(resolveConcentrationSave({ total: 10, natural: 8, dc: 10 }).held, true);
  assert.equal(resolveConcentrationSave({ total: 9, natural: 7, dc: 10 }).held, false);
});

test('el 1 natural siempre falla y el 20 natural siempre aguanta', () => {
  // Un 1 natural con un bonificador enorme fallaría igual
  assert.deepEqual(resolveConcentrationSave({ total: 21, natural: 1, dc: 10 }), {
    held: false,
    reason: 'pifia',
  });
  // Un 20 natural aguanta aunque no llegue a una CD alta
  assert.deepEqual(resolveConcentrationSave({ total: 20, natural: 20, dc: 25 }), {
    held: true,
    reason: 'critico',
  });
});
