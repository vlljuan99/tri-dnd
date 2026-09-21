import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABILITIES, CLASS_NAMES, PRIMARY_ABILITY } from '../dnd.js';
import {
  POINT_BUY_COSTS, STANDARD_ARRAY, applyRacialBonuses, parseProficiencyChoices,
  parseStartingEquipment, pointBuyCost, raceAutomaticSkills, randomBuild,
  recommendedBuild, restoreWizardDraft, validateAbilityAssignment, validatePointBuy, hasChosenName,
} from '../wizard.js';

const compendium = JSON.parse(readFileSync(new URL('./fixtures/wizard-srd-2014.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(readFileSync(new URL('./fixtures/wizard-legacy-anonymized.json', import.meta.url), 'utf8'));
const { classes, races, categoryMembers } = compendium;

// La comprobación usa las referencias originales, no la salida del parser que
// utiliza el generador: así detecta una elección omitida o inventada por ambos.
function referenceKeys(group) {
  return (group.from?.options ?? []).flatMap((option) => option.item?.index
    ? [option.item.index]
    : option.choice ? referenceKeys(option.choice) : []);
}

function assertValidBuild(result, classDetail, raceDetail) {
  const wd = result.wizard_data;
  assert.deepEqual(validateAbilityAssignment(wd), {});
  assert.deepEqual(result.abilities, applyRacialBonuses(wd.baseAbilities, raceDetail, wd.raceAbilityChoice));
  for (const { key } of ABILITIES) assert.ok(Number.isInteger(result.abilities[key]) && result.abilities[key] >= 1 && result.abilities[key] <= 30);
  const automatic = raceAutomaticSkills(raceDetail);
  assert.ok(automatic.every((skill) => result.skill_proficiencies.includes(skill)));
  assert.equal(new Set(result.skill_proficiencies).size, result.skill_proficiencies.length);
  classDetail.proficiency_choices.forEach((group, index) => {
    const choices = referenceKeys(group);
    if (choices.every((key) => key.startsWith('skill-'))) {
      const selected = result.skill_proficiencies.filter((key) => !automatic.includes(key));
      assert.equal(selected.length, group.choose, `${classDetail.index}: cantidad de habilidades`);
      assert.ok(selected.every((key) => choices.includes(`skill-${key}`)), `${classDetail.index}: habilidades permitidas`);
    } else {
      const selected = wd.otherProficiencyChoices[`${classDetail.index}-${index}`];
      assert.equal(selected.length, group.choose, `${classDetail.index}: otras competencias`);
      assert.equal(new Set(selected).size, selected.length);
      assert.ok(selected.every((key) => choices.includes(key)));
    }
  });
  if (raceDetail.ability_bonus_options) {
    assert.equal(wd.raceAbilityChoice.length, raceDetail.ability_bonus_options.choose);
    assert.equal(new Set(wd.raceAbilityChoice).size, wd.raceAbilityChoice.length);
    assert.ok(wd.raceAbilityChoice.every((key) => raceDetail.ability_bonus_options.from.options.some((option) => option.ability_score.index === key)));
  }
  if (raceDetail.language_options) {
    assert.ok(raceDetail.language_options.from.options.some((option) => option.item.index === wd.raceLanguageChoice));
  }
  for (const forbidden of ['name', 'level', 'hp_max', 'ac', 'speed', 'save_proficiencies', 'weapon_proficiencies', 'armor_proficiencies']) {
    assert.equal(Object.hasOwn(result, forbidden), false, `No escribe ${forbidden}`);
  }
}

test('reparto recomendado válido para las 12 clases SRD y las nueve especies', () => {
  assert.deepEqual(Object.keys(classes).sort(), Object.keys(CLASS_NAMES).sort());
  for (const classDetail of Object.values(classes)) {
    for (const raceDetail of Object.values(races)) {
      const char = { name: 'Nombre conservado', class_index: classDetail.index, race_index: raceDetail.index, wizard_data: { personal: 'se conserva' } };
      const before = structuredClone(char);
      const result = recommendedBuild({ char, classDetail, raceDetail });
      assertValidBuild(result, classDetail, raceDetail);
      assert.deepEqual(Object.values(result.wizard_data.baseAbilities).sort((a, b) => b - a), STANDARD_ARRAY);
      assert.equal(result.wizard_data.baseAbilities[PRIMARY_ABILITY[classDetail.index]], 15);
      assert.equal(result.wizard_data.personal, 'se conserva');
      assert.deepEqual(char, before);
    }
  }
});

test('personaje aleatorio: 100 ejecuciones válidas con tiradas, especies, competencias y equipo completos', () => {
  let seed = 0x5b2014;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const seenClasses = new Set();
  const seenRaces = new Set();
  const char = { name: 'No cambiar', campaign_id: 17, wizard_data: { notes: 'Elecciones anteriores' } };
  const before = structuredClone(char);
  for (let i = 0; i < 100; i++) {
    const result = randomBuild({ char, classDetails: classes, raceDetails: races, categoryMembers, rng });
    const classDetail = classes[result.class_index];
    assertValidBuild(result, classDetail, races[result.race_index]);
    assert.equal(result.wizard_data.abilityMethod, 'roll');
    assert.equal(result.wizard_data.rolledPool.length, 6);
    assert.ok(result.wizard_data.rolledPool.every((value) => value >= 3 && value <= 18));
    const { groups } = parseStartingEquipment(classDetail);
    assert.equal(groups.length, classDetail.starting_equipment_options.length);
    for (const group of groups) {
      const option = group.options.find((candidate) => candidate.key === result.wizard_data.equipmentGroupChoice[group.key]);
      assert.ok(option, `${classDetail.index}: falta la elección de ${group.key}`);
      for (const slot of option.categorySlots) {
        const selected = result.wizard_data.equipmentCategoryPicks[slot.pathKey];
        assert.equal(selected.length, slot.choose);
        assert.ok(selected.every((index) => categoryMembers[slot.categoryIndex].some((entry) => entry.index === index)));
      }
    }
    seenClasses.add(result.class_index);
    seenRaces.add(result.race_index);
  }
  assert.equal(seenClasses.size, 12);
  assert.equal(seenRaces.size, 9);
  assert.deepEqual(char, before);
});

test('el aleatorio rechaza un compendio sin cargar y los dados extremos siguen siendo válidos', () => {
  assert.throws(() => randomBuild({}), /carguen/);
  for (const value of [0, 0.999999]) {
    const result = randomBuild({ classDetails: classes, raceDetails: races, categoryMembers, rng: () => value });
    assertValidBuild(result, classes[result.class_index], races[result.race_index]);
    assert.ok(result.wizard_data.rolledPool.every((score) => score === (value === 0 ? 3 : 18)));
  }
});

test('compra por puntos: tabla PHB 2014, presupuesto de 27 y rango 8–15 antes de bonos', () => {
  assert.deepEqual(POINT_BUY_COSTS, { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 });
  const base = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
  assert.equal(pointBuyCost(base), 27);
  assert.deepEqual(validatePointBuy(base), {});
  assert.deepEqual(validateAbilityAssignment({ abilityMethod: 'point-buy', baseAbilities: base }), {});
  assert.match(validatePointBuy({ ...base, cha: 9 }).baseAbilities, /28 puntos/);
  for (const invalid of [7, 16, null, undefined, NaN, 10.5, '12']) {
    const result = validatePointBuy({ ...base, str: invalid });
    assert.match(result.str, /entre 8 y 15/);
    assert.equal(pointBuyCost({ ...base, str: invalid }), null);
  }
  assert.ok(validatePointBuy({ str: 8 }).baseAbilities);
  // Tener puntos pendientes se explica en la UI, pero no supera el presupuesto.
  assert.deepEqual(validatePointBuy({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), {});
});

test('array y tirada no permiten duplicar valores ni completar menos de seis características', () => {
  const base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  assert.deepEqual(validateAbilityAssignment({ abilityMethod: 'array', baseAbilities: base }), {});
  assert.ok(validateAbilityAssignment({ abilityMethod: 'array', baseAbilities: { ...base, cha: 15 } }).baseAbilities);
  assert.ok(validateAbilityAssignment({ abilityMethod: 'roll', baseAbilities: base, rolledPool: [20, 14, 13, 12, 10, 8] }).baseAbilities);
  assert.ok(validateAbilityAssignment({ abilityMethod: 'manual', baseAbilities: { str: 15 } }).dex);
  assert.ok(validateAbilityAssignment({ abilityMethod: 'desconocido', baseAbilities: base }).abilityMethod);
});

test('borradores reales anonimizados conservan todos los datos y abren especie/resumen en el orden nuevo', () => {
  const expectedSteps = [1, 7];
  legacy.characters.forEach((character, i) => {
    const original = structuredClone(character);
    const restored = restoreWizardDraft(character);
    assert.equal(restored.wizard_step, expectedSteps[i]);
    assert.equal(restored.wizard_data.flowVersion, 2);
    const { flowVersion, ...preservedData } = restored.wizard_data;
    assert.deepEqual(preservedData, original.wizard_data);
    assert.deepEqual({ ...restored, wizard_step: original.wizard_step, wizard_data: original.wizard_data }, original);
    assert.deepEqual(character, original);
    assert.deepEqual(restoreWizardDraft(restored), restored, 'no reordena otra vez al abrirlo');
  });
});

test('el orden antiguo recupera cada paso y no salta una especie o identidad aún sin elegir', () => {
  const complete = legacy.characters[1];
  for (const [oldStep, newStep] of [0, 2, 1, 3, 4, 5, 7].entries()) {
    assert.equal(restoreWizardDraft({ ...complete, wizard_step: oldStep }).wizard_step, newStep);
  }
  assert.equal(restoreWizardDraft({ ...complete, race_index: null, wizard_step: 1 }).wizard_step, 1);
  assert.equal(restoreWizardDraft({ ...complete, name: 'Nuevo personaje', wizard_step: 6 }).wizard_step, 6);
  assert.equal(restoreWizardDraft({ wizard_step: 0 }).wizard_step, 0);
  assert.equal(restoreWizardDraft({ ...complete, wizard_step: 6, wizard_data: { flowVersion: 2 } }).wizard_step, 6);
});

test('el compendio real incluye las herramientas anidadas del monje y categorías directas de equipo', () => {
  const choices = parseProficiencyChoices(classes.monk);
  assert.equal(choices.otherChoices.length, 1);
  assert.equal(choices.otherChoices[0].choose, 1);
  assert.ok(choices.otherChoices[0].options.some(({ key }) => key === 'lute'));
  assert.ok(choices.otherChoices[0].options.some(({ key }) => key === 'smiths-tools'));
  const equipment = parseStartingEquipment(classes.cleric);
  assert.equal(equipment.groups.at(-1).options[0].categorySlots[0].categoryIndex, 'holy-symbols');
});

test('el nombre provisional del servidor cuenta como «sin nombre» hasta el paso de identidad', () => {
  assert.equal(hasChosenName({ name: 'Nuevo personaje' }), false);
  assert.equal(hasChosenName({ name: '   ' }), false);
  assert.equal(hasChosenName({}), false);
  assert.equal(hasChosenName({ name: 'Brunilda de Hierro' }), true);
});
