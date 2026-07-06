// Reglas básicas de D&D 5e para la ficha semiautomática.
// Los nombres en español coinciden con las traducciones del compendio SRD.

export const ABILITIES = [
  { key: 'str', name: 'Fuerza', short: 'FUE' },
  { key: 'dex', name: 'Destreza', short: 'DES' },
  { key: 'con', name: 'Constitución', short: 'CON' },
  { key: 'int', name: 'Inteligencia', short: 'INT' },
  { key: 'wis', name: 'Sabiduría', short: 'SAB' },
  { key: 'cha', name: 'Carisma', short: 'CAR' },
];

export const SKILLS = [
  { index: 'acrobatics', name: 'Acrobacias', ability: 'dex' },
  { index: 'animal-handling', name: 'Trato con Animales', ability: 'wis' },
  { index: 'arcana', name: 'Arcanos', ability: 'int' },
  { index: 'athletics', name: 'Atletismo', ability: 'str' },
  { index: 'deception', name: 'Engaño', ability: 'cha' },
  { index: 'history', name: 'Historia', ability: 'int' },
  { index: 'insight', name: 'Perspicacia', ability: 'wis' },
  { index: 'intimidation', name: 'Intimidación', ability: 'cha' },
  { index: 'investigation', name: 'Investigación', ability: 'int' },
  { index: 'medicine', name: 'Medicina', ability: 'wis' },
  { index: 'nature', name: 'Naturaleza', ability: 'int' },
  { index: 'perception', name: 'Percepción', ability: 'wis' },
  { index: 'performance', name: 'Interpretación', ability: 'cha' },
  { index: 'persuasion', name: 'Persuasión', ability: 'cha' },
  { index: 'religion', name: 'Religión', ability: 'int' },
  { index: 'sleight-of-hand', name: 'Juego de Manos', ability: 'dex' },
  { index: 'stealth', name: 'Sigilo', ability: 'dex' },
  { index: 'survival', name: 'Supervivencia', ability: 'wis' },
];

// Característica de lanzamiento de conjuros por clase (SRD)
export const SPELLCASTING_ABILITY = {
  bard: 'cha',
  cleric: 'wis',
  druid: 'wis',
  paladin: 'cha',
  ranger: 'wis',
  sorcerer: 'cha',
  warlock: 'cha',
  wizard: 'int',
};

export const SCHOOL_NAMES = {
  abjuration: 'Abjuración',
  conjuration: 'Conjuración',
  divination: 'Adivinación',
  enchantment: 'Encantamiento',
  evocation: 'Evocación',
  illusion: 'Ilusión',
  necromancy: 'Nigromancia',
  transmutation: 'Transmutación',
};

export const DAMAGE_TYPE_NAMES = {
  acid: 'ácido',
  bludgeoning: 'contundente',
  cold: 'frío',
  fire: 'fuego',
  force: 'fuerza',
  lightning: 'relámpago',
  necrotic: 'necrótico',
  piercing: 'perforante',
  poison: 'veneno',
  psychic: 'psíquico',
  radiant: 'radiante',
  slashing: 'cortante',
  thunder: 'trueno',
};

export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level) {
  return 2 + Math.floor((level - 1) / 4);
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function saveBonus(character, abilityKey) {
  const mod = abilityModifier(character.abilities[abilityKey]);
  const proficient = character.save_proficiencies.includes(abilityKey);
  return mod + (proficient ? proficiencyBonus(character.level) : 0);
}

export function skillBonus(character, skill) {
  const mod = abilityModifier(character.abilities[skill.ability]);
  const proficient = character.skill_proficiencies.includes(skill.index);
  return mod + (proficient ? proficiencyBonus(character.level) : 0);
}

/**
 * Característica que usa un arma del inventario:
 * a distancia → DES; sutil → la mejor de FUE/DES; resto → FUE.
 */
export function weaponAbility(character, weapon) {
  if (weapon.weaponRange === 'Ranged') return 'dex';
  if (weapon.properties?.includes('finesse')) {
    return abilityModifier(character.abilities.dex) > abilityModifier(character.abilities.str)
      ? 'dex'
      : 'str';
  }
  return 'str';
}

/** Bonificador de ataque de un arma (se asume competencia con el arma equipada) */
export function weaponAttackBonus(character, weapon) {
  const mod = abilityModifier(character.abilities[weaponAbility(character, weapon)]);
  return mod + proficiencyBonus(character.level);
}

/** Modificador de daño de un arma */
export function weaponDamageModifier(character, weapon) {
  return abilityModifier(character.abilities[weaponAbility(character, weapon)]);
}

export function spellcastingAbility(character) {
  return SPELLCASTING_ABILITY[character.class_index] ?? 'int';
}

export function spellAttackBonus(character) {
  const mod = abilityModifier(character.abilities[spellcastingAbility(character)]);
  return mod + proficiencyBonus(character.level);
}

export function spellSaveDC(character) {
  return 8 + spellAttackBonus(character);
}

/**
 * Dados de daño de un truco según nivel de personaje (escalado estándar del SRD:
 * niveles 1, 5, 11 y 17) a partir de damage_at_character_level.
 */
export function cantripDamageAtLevel(damageAtCharacterLevel, characterLevel) {
  const levels = Object.keys(damageAtCharacterLevel)
    .map(Number)
    .sort((a, b) => a - b);
  let dice = null;
  for (const lvl of levels) {
    if (characterLevel >= lvl) dice = damageAtCharacterLevel[lvl];
  }
  return dice;
}
