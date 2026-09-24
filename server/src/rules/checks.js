// Pruebas de característica, habilidad y salvación de un PJ (Fase 4c). Hasta
// ahora el servidor solo sabía el bonificador de salvación y el de Percepción;
// las tiradas que pide el DM necesitan cualquier habilidad del SRD. Espejo del
// cliente: `SKILLS` y `skillBonus` en client/src/lib/dnd.js.

import { abilityModifier, proficiencyBonus } from './abilities.js';
import { armorPenaltyAppliesTo } from './proficiency.js';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_NAMES = {
  str: 'Fuerza',
  dex: 'Destreza',
  con: 'Constitución',
  int: 'Inteligencia',
  wis: 'Sabiduría',
  cha: 'Carisma',
};

// Las 18 habilidades del SRD 5.1 con su característica.
export const SKILLS = {
  acrobatics: { name: 'Acrobacias', ability: 'dex' },
  'animal-handling': { name: 'Trato con Animales', ability: 'wis' },
  arcana: { name: 'Arcanos', ability: 'int' },
  athletics: { name: 'Atletismo', ability: 'str' },
  deception: { name: 'Engaño', ability: 'cha' },
  history: { name: 'Historia', ability: 'int' },
  insight: { name: 'Perspicacia', ability: 'wis' },
  intimidation: { name: 'Intimidación', ability: 'cha' },
  investigation: { name: 'Investigación', ability: 'int' },
  medicine: { name: 'Medicina', ability: 'wis' },
  nature: { name: 'Naturaleza', ability: 'int' },
  perception: { name: 'Percepción', ability: 'wis' },
  performance: { name: 'Interpretación', ability: 'cha' },
  persuasion: { name: 'Persuasión', ability: 'cha' },
  religion: { name: 'Religión', ability: 'int' },
  'sleight-of-hand': { name: 'Juego de Manos', ability: 'dex' },
  stealth: { name: 'Sigilo', ability: 'dex' },
  survival: { name: 'Supervivencia', ability: 'wis' },
};

function jsonValue(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value || '') ?? fallback;
  } catch {
    return fallback;
  }
}

function scoreOf(character, ability) {
  return jsonValue(character?.abilities, {})[ability] ?? 10;
}

/** Prueba de característica a pelo: solo el modificador. */
export function abilityCheckBonus(character, ability) {
  return abilityModifier(scoreOf(character, ability));
}

/** Prueba de habilidad: modificador + competencia si la tiene. */
export function skillCheckBonus(character, skill) {
  const entry = SKILLS[skill];
  if (!entry) return 0;
  const proficient = jsonValue(character?.skill_proficiencies, []).includes(skill);
  return abilityModifier(scoreOf(character, entry.ability)) + (proficient ? proficiencyBonus(character?.level) : 0);
}

/** Salvación: modificador + competencia si la clase se la da. */
export function characterSaveBonus(character, ability) {
  const proficient = jsonValue(character?.save_proficiencies, []).includes(ability);
  return abilityModifier(scoreOf(character, ability)) + (proficient ? proficiencyBonus(character?.level) : 0);
}

/**
 * Desventaja por armadura sin competencia en pruebas y salvaciones de FUE o
 * DES (regla 2014). Las fichas del DM quedan exentas, como en el resto.
 */
export function checkDisadvantage(character, ability) {
  const shaped = {
    kind: character?.kind,
    inventory: jsonValue(character?.inventory, []),
    armor_proficiencies: jsonValue(character?.armor_proficiencies, []),
  };
  return armorPenaltyAppliesTo(shaped, ability);
}

/** Característica de la tirada: la propia o la de la habilidad. */
export function abilityForCheck({ caracteristica = null, habilidad = null }) {
  if (habilidad && SKILLS[habilidad]) return SKILLS[habilidad].ability;
  return ABILITY_KEYS.includes(caracteristica) ? caracteristica : null;
}

/** Nombre legible de una tirada pedida: «Sigilo», «Salvación de Destreza». */
export function checkLabel({ tipo, caracteristica = null, habilidad = null }) {
  if (habilidad && SKILLS[habilidad]) return SKILLS[habilidad].name;
  const name = ABILITY_NAMES[caracteristica] ?? 'característica';
  return tipo === 'salvacion' ? `Salvación de ${name}` : `Prueba de ${name}`;
}

/**
 * Prueba de grupo (SRD 5.1, «Group Checks»): el grupo la supera si AL MENOS
 * la mitad de quienes tiran la supera.
 */
export function groupCheckSucceeds(successes, total) {
  if (!Number.isInteger(total) || total <= 0) return false;
  return successes * 2 >= total;
}
