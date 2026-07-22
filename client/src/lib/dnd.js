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

// Nombres de clase en español (el SRD ya trae "name" en inglés; se traducen
// aquí porque son solo 12 y se reutilizan en varias pantallas).
export const CLASS_NAMES = {
  barbarian: 'Bárbaro', bard: 'Bardo', cleric: 'Clérigo', druid: 'Druida',
  fighter: 'Guerrero', monk: 'Monje', paladin: 'Paladín', ranger: 'Explorador',
  rogue: 'Pícaro', sorcerer: 'Hechicero', warlock: 'Brujo', wizard: 'Mago',
};

// Característica principal orientativa por clase (no viene en el SRD como
// campo explícito; para las clases con conjuros coincide con su característica
// de lanzamiento, para el resto es la habitual de las reglas básicas de 5e).
export const PRIMARY_ABILITY = {
  ...SPELLCASTING_ABILITY,
  barbarian: 'str',
  fighter: 'str',
  monk: 'dex',
  rogue: 'dex',
};

// Descripciones y rol aproximado por clase: contenido propio (no copiado del
// SRD) pensado solo como orientación rápida en el asistente de creación.
export const CLASS_SUMMARY = {
  barbarian: { role: 'Combate cuerpo a cuerpo, resistencia y daño sostenido.', difficulty: 'Baja' },
  bard: { role: 'Apoyo, interacción social y control mediante la magia.', difficulty: 'Media' },
  cleric: { role: 'Curación, protección divina y versatilidad en combate.', difficulty: 'Media' },
  druid: { role: 'Magia natural, transformación y control del campo de batalla.', difficulty: 'Alta' },
  fighter: { role: 'Combate versátil con armas, fiable en cualquier situación.', difficulty: 'Baja' },
  monk: { role: 'Combate ágil sin armas, movilidad y golpes rápidos.', difficulty: 'Media' },
  paladin: { role: 'Combatiente sagrado con magia de apoyo y protección.', difficulty: 'Media' },
  ranger: { role: 'Exploración, combate a distancia y vínculo con la naturaleza.', difficulty: 'Media' },
  rogue: { role: 'Sigilo, daño de precisión y destreza en habilidades.', difficulty: 'Baja' },
  sorcerer: { role: 'Magia arcana innata, potente pero con recursos limitados.', difficulty: 'Alta' },
  warlock: { role: 'Magia arcana pactada, pocos espacios pero muy potentes.', difficulty: 'Media' },
  wizard: { role: 'Magia arcana erudita, el mayor abanico de hechizos.', difficulty: 'Alta' },
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

// Los nueve alineamientos clásicos de D&D: terminología básica del juego, no
// texto de trasfondo protegido del SRD.
export const ALIGNMENTS = [
  'Legal Bueno', 'Neutral Bueno', 'Caótico Bueno',
  'Legal Neutral', 'Neutral', 'Caótico Neutral',
  'Legal Malvado', 'Neutral Malvado', 'Caótico Malvado',
];

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

/**
 * Puntos de golpe máximos estimados con la regla de valor fijo por nivel
 * (máximo del dado de golpe en nivel 1, luego media fija + 1 por nivel):
 * hitDie + conMod en nivel 1, y + (hitDie/2 + 1 + conMod) por cada nivel extra.
 */
export function estimateHitPoints(hitDie, conModifier, level) {
  if (!hitDie || !level) return 0;
  const perLevel = Math.floor(hitDie / 2) + 1 + conModifier;
  return hitDie + conModifier + Math.max(0, level - 1) * perLevel;
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
  if (ABILITIES.some((ability) => ability.key === character.spellcasting_ability)) {
    return character.spellcasting_ability;
  }
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
