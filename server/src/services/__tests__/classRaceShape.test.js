import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClassData, validateRaceData, validateContentData } from '../classRaceShape.js';

// --- Clases ----------------------------------------------------------------

test('una clase válida se normaliza a forma canónica', () => {
  const r = validateClassData({
    hit_die: 10,
    saving_throws: [{ index: 'str' }, { index: 'con' }],
    spellcasting_ability: 'con',
    skill_choices: { choose: 2, from: ['athletics', 'perception', 'intimidation'] },
    custom_features: [{ name: 'Furia', text: 'Entra en furia' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.hit_die, 10);
  assert.deepEqual(r.data.saving_throws.map((s) => s.index), ['str', 'con']);
  assert.equal(r.data.spellcasting.spellcasting_ability.index, 'con');
  assert.equal(r.data.skill_choices.choose, 2);
  assert.equal(r.data.custom_features[0].name, 'Furia');
});

test('el dado de golpe se limita a d6/d8/d10/d12', () => {
  assert.equal(validateClassData({ hit_die: 7 }).ok, false);
  assert.equal(validateClassData({ hit_die: 20 }).ok, false);
  assert.equal(validateClassData({ hit_die: 8 }).ok, true);
});

test('una clase sin conjuros guarda spellcasting null', () => {
  const r = validateClassData({ hit_die: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.data.spellcasting, null);
});

test('la clase nunca guarda más de dos salvaciones ni repetidas', () => {
  const r = validateClassData({
    hit_die: 8,
    saving_throws: [{ index: 'str' }, { index: 'str' }, { index: 'dex' }, { index: 'con' }],
  });
  assert.deepEqual(r.data.saving_throws.map((s) => s.index), ['str', 'dex']);
});

test('la elección de habilidades descarta índices inventados y acota el número', () => {
  const r = validateClassData({
    hit_die: 6,
    skill_choices: { choose: 9, from: ['stealth', 'no-existe', 'arcana'] },
  });
  assert.deepEqual(r.data.skill_choices.from, ['stealth', 'arcana']);
  assert.equal(r.data.skill_choices.choose, 2); // acotado al tamaño de la lista válida
});

test('una característica de lanzamiento inválida se rechaza', () => {
  assert.equal(validateClassData({ hit_die: 8, spellcasting_ability: 'luck' }).ok, false);
});

// --- Razas -----------------------------------------------------------------

test('una raza válida se normaliza a forma SRD-compatible', () => {
  const r = validateRaceData({
    ability_bonuses: [
      { ability: 'dex', amount: 2 },
      { ability: 'con', amount: 1 },
    ],
    speed: 35,
    size: 'Mediano',
    skill_proficiencies: ['acrobatics'],
    damage_resistances: ['lightning'],
    senses: ['Visión en la oscuridad 18 m'],
    custom_features: [{ name: 'Ascendencia', text: 'Naciste de la tormenta' }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.ability_bonuses[0], { ability_score: { index: 'dex', name: 'DES' }, bonus: 2 });
  assert.equal(r.data.speed, 35);
  assert.equal(r.data.size, 'Mediano');
  assert.deepEqual(r.data.skill_proficiencies, ['acrobatics']);
  assert.deepEqual(r.data.damage_resistances, ['lightning']);
});

test('un bono por característica: sin repetidos, sin ceros, acotado', () => {
  const r = validateRaceData({
    ability_bonuses: [
      { ability: 'dex', amount: 2 },
      { ability: 'dex', amount: 1 }, // repetida → se ignora
      { ability: 'con', amount: 0 }, // cero → se ignora
      { ability: 'str', amount: 99 }, // fuera de rango → se ignora
      { ability: 'wis', amount: -1 },
    ],
  });
  assert.deepEqual(
    r.data.ability_bonuses.map((b) => [b.ability_score.index, b.bonus]),
    [['dex', 2], ['wis', -1]]
  );
});

test('la velocidad es opcional pero se valida su rango', () => {
  assert.equal(validateRaceData({}).data.speed, null);
  assert.equal(validateRaceData({ speed: '' }).data.speed, null);
  assert.equal(validateRaceData({ speed: 200 }).ok, false);
  assert.equal(validateRaceData({ speed: 30 }).data.speed, 30);
});

test('resistencias y tamaño solo aceptan valores conocidos', () => {
  const r = validateRaceData({ damage_resistances: ['fire', 'inventado'], size: 'Colosal' });
  assert.deepEqual(r.data.damage_resistances, ['fire']);
  assert.equal(r.data.size, null); // 'Colosal' no está en la lista
});

test('validateContentData enruta por categoría y devuelve null para otras', () => {
  assert.equal(validateContentData('classes', { hit_die: 8 }).ok, true);
  assert.equal(validateContentData('races', {}).ok, true);
  assert.equal(validateContentData('equipment', {}), null);
});
