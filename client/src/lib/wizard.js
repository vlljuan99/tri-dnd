// Utilidades específicas del asistente de creación de personaje.
// No implementan reglas nuevas: solo adaptan la forma de los datos del
// compendio SRD (clases/razas) a lo que ya calculan lib/dnd.js y lib/dice.js.
import { rollDie } from './dice.js';
import { SKILLS } from './dnd.js';

export const ABILITY_METHODS = [
  { id: 'array', name: 'Array estándar', desc: 'Reparte los valores 15, 14, 13, 12, 10 y 8 entre tus características.' },
  { id: 'roll', name: 'Tirada de dados', desc: 'Tira 4d6 y descarta el más bajo, seis veces, y reparte los resultados.' },
  { id: 'manual', name: 'Introducción manual', desc: 'Escribe directamente cada valor (1-30), por ejemplo si ya tienes el personaje en papel.' },
];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/** Tira una característica: 4d6, descarta el dado más bajo, suma el resto. */
export function rollAbilityScore() {
  const dice = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)];
  dice.sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

export function rollAbilityPool() {
  return Array.from({ length: 6 }, rollAbilityScore);
}

/** Aplica los bonificadores raciales (fijos + elegidos) sobre una base de características. */
export function applyRacialBonuses(base, raceDetail, abilityChoice = []) {
  const result = { ...base };
  for (const b of raceDetail?.ability_bonuses ?? []) {
    const key = b.ability_score?.index;
    if (key) result[key] = (result[key] ?? 10) + b.bonus;
  }
  const options = raceDetail?.ability_bonus_options;
  if (options) {
    for (const key of abilityChoice) {
      const opt = options.from?.options?.find((o) => o.ability_score?.index === key);
      if (opt) result[key] = (result[key] ?? 10) + opt.bonus;
    }
  }
  for (const k of Object.keys(result)) result[k] = Math.max(1, Math.min(30, result[k]));
  return result;
}

export function racialAbilityBonuses(raceDetail, abilityChoice = []) {
  const bonuses = {};
  for (const bonus of raceDetail?.ability_bonuses ?? []) {
    const key = bonus.ability_score?.index;
    if (key) bonuses[key] = (bonuses[key] ?? 0) + bonus.bonus;
  }
  const options = raceDetail?.ability_bonus_options;
  if (options) {
    for (const key of abilityChoice) {
      const option = options.from?.options?.find((candidate) => candidate.ability_score?.index === key);
      if (option) bonuses[key] = (bonuses[key] ?? 0) + option.bonus;
    }
  }
  return bonuses;
}

export function raceAutomaticSkills(raceDetail) {
  const custom = Array.isArray(raceDetail?.skill_proficiencies) ? raceDetail.skill_proficiencies : [];
  const srd = (raceDetail?.proficiencies ?? [])
    .map((proficiency) => proficiency?.index)
    .filter((index) => typeof index === 'string' && index.startsWith('skill-'))
    .map((index) => index.replace(/^skill-/, ''));
  return [...new Set([...custom, ...srd])].filter((index) => SKILLS.some((skill) => skill.index === index));
}

export function mergeAutomaticSkills(current, previousAutomatic = [], nextAutomatic = []) {
  const previous = new Set(previousAutomatic);
  return [...new Set([...(current ?? []).filter((index) => !previous.has(index)), ...nextAutomatic])];
}

/**
 * Extrae de una clase del SRD:
 * - skillChoice: el grupo de "elige N habilidades" (si existe), con nombres en español
 *   tomados de SKILLS cuando es posible.
 * - otherChoices: el resto de grupos de competencia a elegir (instrumentos,
 *   herramientas...), con las opciones tal cual las da el compendio (en inglés
 *   si no hay traducción, igual que el resto de la app).
 */
export function parseProficiencyChoices(classDetail) {
  if (classDetail?.skill_choices) {
    const allowed = classDetail.skill_choices.from?.length
      ? classDetail.skill_choices.from
      : SKILLS.map((skill) => skill.index);
    return {
      skillChoice: {
        choose: classDetail.skill_choices.choose ?? 0,
        desc: 'Elige las habilidades de tu clase personalizada.',
        options: allowed
          .map((index) => SKILLS.find((skill) => skill.index === index))
          .filter(Boolean)
          .map((skill) => ({ key: skill.index, name: skill.name })),
      },
      otherChoices: [],
    };
  }
  const groups = classDetail?.proficiency_choices ?? [];
  let skillChoice = null;
  const otherChoices = [];

  groups.forEach((group, i) => {
    const options = (group.from?.options ?? []).filter((o) => o.option_type === 'reference' && o.item?.index);
    if (options.length === 0) return;
    const isSkillGroup = options.every((o) => o.item.index.startsWith('skill-'));
    if (isSkillGroup && !skillChoice) {
      skillChoice = {
        choose: group.choose,
        desc: group.desc,
        options: options.map((o) => {
          const skillIndex = o.item.index.replace(/^skill-/, '');
          const known = SKILLS.find((s) => s.index === skillIndex);
          return { key: skillIndex, name: known?.name ?? o.item.name };
        }),
      };
      return;
    }
    otherChoices.push({
      groupKey: `${classDetail.index}-${i}`,
      choose: group.choose,
      desc: group.desc,
      options: options.map((o) => ({ key: o.item.index, name: o.item.name })),
    });
  });

  return { skillChoice, otherChoices };
}

/** Competencias automáticas de armadura/armas/instrumentos de una clase (sin elección). */
export function classAutoProficiencies(classDetail) {
  return (classDetail?.proficiencies ?? []).filter((p) => !p.index.startsWith('saving-throw-'));
}

export function emptyWizardData() {
  return {
    abilityMethod: null,
    baseAbilities: null,
    rolledPool: null,
    raceAbilityChoice: [],
    raceLanguageChoice: null,
    otherProficiencyChoices: {},
  };
}
