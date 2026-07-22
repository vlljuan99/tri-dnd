import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyClassForm, classDataToForm, buildClassData,
  emptyRaceForm, raceDataToForm, buildRaceData,
  classSummary, raceSummary,
} from '../classRaceForm.js';

// El editor de la Biblioteca convierte formulario → data (SRD-compatible) y de
// vuelta. La ida y vuelta debe ser estable: lo que el DM ve al reabrir una
// clase/raza tiene que ser lo que guardó, sin perder ni inventar campos.

test('clase: ida y vuelta estable', () => {
  const form = {
    hitDie: 10,
    savingThrows: ['str', 'con'],
    spellcastingAbility: 'con',
    skillChoose: 2,
    skillFrom: ['athletics', 'perception'],
    features: [{ name: 'Furia', text: 'Resiste el dolor' }],
  };
  const back = classDataToForm(buildClassData(form));
  assert.deepEqual(back, form);
});

test('clase sin conjuros: spellcastingAbility vacío se conserva', () => {
  const form = { ...emptyClassForm(), hitDie: 12 };
  const data = buildClassData(form);
  assert.equal(data.spellcasting, null);
  assert.equal(classDataToForm(data).spellcastingAbility, '');
});

test('raza: ida y vuelta estable, y los bonos cero se descartan', () => {
  const form = {
    abilityBonuses: { dex: 2, con: 1, str: 0, wis: '' }, // 0 y '' no deben guardarse
    speed: '35',
    size: 'Mediano',
    skillProficiencies: ['acrobatics'],
    resistances: ['lightning'],
    senses: ['Visión en la oscuridad 18 m'],
    features: [],
  };
  const data = buildRaceData(form);
  // Solo dex y con sobreviven como bonos
  assert.deepEqual(
    data.ability_bonuses.map((b) => [b.ability_score.index, b.bonus]),
    [['dex', 2], ['con', 1]]
  );
  const back = raceDataToForm(data);
  assert.deepEqual(back.abilityBonuses, { dex: 2, con: 1 });
  assert.equal(back.speed, '35');
  assert.deepEqual(back.resistances, ['lightning']);
});

test('raza sin velocidad: null ↔ cadena vacía', () => {
  const data = buildRaceData(emptyRaceForm());
  assert.equal(data.speed, null);
  assert.equal(raceDataToForm(data).speed, '');
});

test('los resúmenes del listado leen el data guardado', () => {
  const classEntry = { data: buildClassData({
    hitDie: 8, savingThrows: ['dex'], spellcastingAbility: 'int', skillChoose: 1, skillFrom: [], features: [],
  }) };
  assert.match(classSummary(classEntry), /d8/);
  assert.match(classSummary(classEntry), /INT/);

  const raceEntry = { data: buildRaceData({
    abilityBonuses: { dex: 2 }, speed: '30', size: 'Mediano',
    skillProficiencies: [], resistances: ['fire'], senses: [], features: [],
  }) };
  assert.match(raceSummary(raceEntry), /\+2 DES/);
  assert.match(raceSummary(raceEntry), /Fuego/);
});
