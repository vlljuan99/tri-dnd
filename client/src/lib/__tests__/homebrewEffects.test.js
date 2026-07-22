import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRacialBonuses,
  mergeAutomaticSkills,
  parseProficiencyChoices,
  raceAutomaticSkills,
  racialAbilityBonuses,
} from '../wizard.js';
import { spellAttackBonus, spellcastingAbility } from '../dnd.js';

const race = {
  ability_bonuses: [{ ability_score: { index: 'dex' }, bonus: 2 }],
  skill_proficiencies: ['perception'],
};

test('los bonos raciales conservan base y desglose por característica', () => {
  const base = { str: 10, dex: 14, con: 12, int: 10, wis: 11, cha: 8 };
  assert.equal(applyRacialBonuses(base, race).dex, 16);
  assert.deepEqual(racialAbilityBonuses(race), { dex: 2 });
});

test('las destrezas automáticas sustituyen las de la raza anterior sin borrar elecciones', () => {
  assert.deepEqual(mergeAutomaticSkills(['stealth', 'perception'], ['perception'], ['arcana']), ['stealth', 'arcana']);
  assert.deepEqual(raceAutomaticSkills(race), ['perception']);
});

test('una clase personalizada expone su elección de habilidades', () => {
  const { skillChoice } = parseProficiencyChoices({ skill_choices: { choose: 1, from: ['arcana', 'history'] } });
  assert.equal(skillChoice.choose, 1);
  assert.deepEqual(skillChoice.options.map((option) => option.key), ['arcana', 'history']);
});

test('la característica de lanzamiento puede venir de la clase personalizada', () => {
  const character = {
    class_index: 'custom:3',
    spellcasting_ability: 'cha',
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 },
  };
  assert.equal(spellcastingAbility(character), 'cha');
  assert.equal(spellAttackBonus(character), 5);
});
