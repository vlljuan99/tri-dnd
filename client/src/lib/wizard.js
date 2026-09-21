// Utilidades específicas del asistente de creación de personaje.
// No implementan reglas nuevas: solo adaptan la forma de los datos del
// compendio SRD (clases/razas) a lo que ya calculan lib/dnd.js y lib/dice.js.
import { rollDie } from './dice.js';
import { ABILITIES, PRIMARY_ABILITY, SKILLS } from './dnd.js';

export const ABILITY_METHODS = [
  { id: 'array', name: 'Array estándar', desc: 'Reparte los valores 15, 14, 13, 12, 10 y 8 entre tus características.' },
  { id: 'roll', name: 'Tirada de dados', desc: 'Tira 4d6 y descarta el más bajo, seis veces, y reparte los resultados.' },
  { id: 'point-buy', name: 'Compra por puntos', desc: '27 puntos, de 8 a 15. Manual del Jugador 2014; no incluido en el SRD 5.1.' },
  { id: 'manual', name: 'Manual · avanzado', desc: 'Escribe directamente cada valor (1–30), por ejemplo si ya tienes el personaje en papel.' },
];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COSTS = Object.freeze({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 });
export const WIZARD_FLOW_VERSION = 2;
// Nombre provisional que pone el servidor al crear el borrador: el asistente
// lo trata como «sin nombre» para que el paso de identidad lo pida de verdad.
export const PLACEHOLDER_NAME = 'Nuevo personaje';

export function hasChosenName(character) {
  const name = character?.name?.trim();
  return Boolean(name) && name !== PLACEHOLDER_NAME;
}

/** Coste antes de bonos raciales; null indica valores incompletos o fuera del rango. */
export function pointBuyCost(base) {
  if (!ABILITIES.every(({ key }) => Number.isInteger(base?.[key]) && base[key] >= 8 && base[key] <= 15)) return null;
  return ABILITIES.reduce((total, { key }) => total + POINT_BUY_COSTS[base[key]], 0);
}

export function validatePointBuy(base) {
  const errors = {};
  for (const ability of ABILITIES) {
    if (!Number.isInteger(base?.[ability.key]) || base[ability.key] < 8 || base[ability.key] > 15) {
      errors[ability.key] = `${ability.name} debe estar entre 8 y 15 antes del bono de especie.`;
    }
  }
  const cost = pointBuyCost(base);
  if (cost === null) errors.baseAbilities = 'Asigna las seis características entre 8 y 15, antes de los bonos de especie.';
  else if (cost > POINT_BUY_BUDGET) errors.baseAbilities = `Has gastado ${cost} puntos: reduce ${cost - POINT_BUY_BUDGET} para respetar el máximo de 27.`;
  // El presupuesto es un máximo: conservar puntos sin gastar no invalida un reparto.
  return errors;
}

/** Validación del reparto, compartida entre la interfaz y las pruebas de dominio. */
export function validateAbilityAssignment(wizardData = {}) {
  const { abilityMethod, baseAbilities, rolledPool } = wizardData;
  if (!ABILITY_METHODS.some(({ id }) => id === abilityMethod)) {
    return { abilityMethod: 'Elige cómo obtener tus características antes de repartirlas.' };
  }
  if (abilityMethod === 'point-buy') return validatePointBuy(baseAbilities);
  const errors = {};
  for (const { key, name } of ABILITIES) {
    if (!Number.isInteger(baseAbilities?.[key]) || baseAbilities[key] < 1 || baseAbilities[key] > 30) {
      errors[key] = `Asigna a ${name} un número entero entre 1 y 30.`;
    }
  }
  if (Object.keys(errors).length) return { ...errors, baseAbilities: 'Completa las seis características antes de continuar.' };
  if (abilityMethod !== 'manual') {
    const pool = abilityMethod === 'array' ? STANDARD_ARRAY : rolledPool;
    const values = ABILITIES.map(({ key }) => baseAbilities[key]).sort((a, b) => a - b);
    if (!Array.isArray(pool) || pool.length !== 6 || (abilityMethod === 'roll' && pool.some((value) => !Number.isInteger(value) || value < 3 || value > 18)) ||
        JSON.stringify(values) !== JSON.stringify([...pool].sort((a, b) => a - b))) {
      errors.baseAbilities = 'Usa cada valor disponible exactamente una vez: no se pueden duplicar ni cambiar las tiradas.';
    }
  }
  return errors;
}

/** Reordena solo la navegación; los datos de una ficha antigua se conservan íntegros. */
export function restoreWizardDraft(character) {
  const wizardData = character.wizard_data ?? {};
  let step = Number.isInteger(character.wizard_step) ? character.wizard_step : 0;
  if (wizardData.flowVersion !== WIZARD_FLOW_VERSION) {
    step = [0, 2, 1, 3, 4, 5, 7][Math.max(0, Math.min(6, step))];
    // El orden nuevo pide la especie antes de clase. Un borrador antiguo no la
    // salta aunque se hubiera detenido precisamente en la elección de clase.
    if (step > 1 && !character.race_index) step = 1;
    if (step > 2 && !character.class_index) step = 2;
    if (step === 7 && !hasChosenName(character)) step = 6;
  }
  return {
    ...character,
    wizard_step: Math.max(0, Math.min(7, step)),
    wizard_data: { ...wizardData, flowVersion: WIZARD_FLOW_VERSION },
  };
}

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
    // El monje elige una herramienta O un instrumento: ambas ramas del SRD
    // son elecciones de una referencia y se presentan como una única lista.
    function references(options) {
      return options.flatMap((option) => {
        if (option.option_type === 'reference' && option.item?.index) return [option];
        if (option.option_type === 'choice' && option.choice?.choose === 1) return references(option.choice.from?.options ?? []);
        return [];
      });
    }
    const options = references(group.from?.options ?? []);
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
    flowVersion: WIZARD_FLOW_VERSION,
    abilityMethod: null,
    baseAbilities: null,
    rolledPool: null,
    raceAbilityChoice: [],
    raceLanguageChoice: null,
    otherProficiencyChoices: {},
    equipmentGroupChoice: {},
    equipmentCategoryPicks: {},
  };
}

/**
 * Resuelve una opción de `starting_equipment_options` del SRD a algo que la
 * UI pueda pintar sin conocer los combinadores del compendio
 * (`counted_reference`, `multiple`, `choice` con `equipment_category`).
 */
function resolveEquipmentPart(part) {
  if (!part || typeof part !== 'object') return { kind: 'unknown' };
  switch (part.option_type) {
    case 'counted_reference':
      return part.of
        ? { kind: 'fixed', index: part.of.index, name: part.of.name, qty: part.count ?? 1 }
        : { kind: 'unknown' };
    case 'multiple':
      return { kind: 'bundle', parts: (part.items ?? []).map(resolveEquipmentPart) };
    case 'choice': {
      const inner = part.choice ?? {};
      if (inner.from?.option_set_type === 'equipment_category' && inner.from.equipment_category?.index) {
        return {
          kind: 'category',
          categoryIndex: inner.from.equipment_category.index,
          categoryName: inner.from.equipment_category.name,
          choose: inner.choose ?? 1,
        };
      }
      return { kind: 'unknown' };
    }
    default:
      return { kind: 'unknown' };
  }
}

// El `data` de la clase trae los nombres del SRD en inglés. `translate` deja
// que quien pinta la etiqueta los sustituya por el nombre en español del
// compendio ya cargado; sin traductor se queda el nombre original.
const RAW_NAME = (_index, name) => name;

export function partLabel(part, translate = RAW_NAME) {
  switch (part.kind) {
    case 'fixed': {
      const name = translate(part.index, part.name);
      return part.qty > 1 ? `${name} ×${part.qty}` : name;
    }
    case 'bundle':
      return part.parts.map((p) => partLabel(p, translate)).join(' + ');
    case 'category':
      return `Elige ${part.choose} de ${translate(part.categoryIndex, part.categoryName)}`;
    default:
      return 'Equipo no reconocido (añádelo luego a mano)';
  }
}

// Aplana una opción resuelta en sus objetos fijos y sus "huecos" de elección
// por categoría (p. ej. "un arma marcial"), cada uno con una clave estable
// para guardar la elección del jugador en wizard_data.
function extractOption(rawOption, groupIndex, optionIndex) {
  const resolved = resolveEquipmentPart(rawOption);
  const key = `equip-${groupIndex}-${optionIndex}`;
  const fixedGrants = [];
  const categorySlots = [];
  function walk(part, path) {
    if (part.kind === 'fixed') fixedGrants.push({ index: part.index, name: part.name, qty: part.qty });
    else if (part.kind === 'category') {
      categorySlots.push({
        pathKey: `${key}-cat-${path}`,
        categoryIndex: part.categoryIndex,
        categoryName: part.categoryName,
        choose: part.choose,
      });
    } else if (part.kind === 'bundle') {
      part.parts.forEach((p, i) => walk(p, `${path}-${i}`));
    }
  }
  walk(resolved, '0');
  return { key, part: resolved, label: partLabel(resolved), fixedGrants, categorySlots };
}

/** Equipo inicial de una clase: fijo (`starting_equipment`) + grupos a elegir. */
export function parseStartingEquipment(classDetail) {
  const fixed = (classDetail?.starting_equipment ?? [])
    .map((entry) => ({ index: entry.equipment?.index, name: entry.equipment?.name, qty: entry.quantity ?? 1 }))
    .filter((entry) => entry.index);

  const groups = (classDetail?.starting_equipment_options ?? []).map((group, i) => ({
    key: `equip-${i}`,
    desc: group.desc,
    choose: group.choose ?? 1,
    options: (group.from?.option_set_type === 'equipment_category'
      ? [{ option_type: 'choice', choice: group }]
      : group.from?.options ?? []).map((option, j) => extractOption(option, i, j)),
  }));

  return { fixed, groups };
}

// Orientación editorial propia: prioriza la característica principal existente
// y después las que suelen sostener a esa clase. No añade reglas de personaje.
const CLASS_ABILITY_ORDER = {
  barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
  cleric: ['wis', 'con', 'str', 'dex', 'cha', 'int'],
  druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  monk: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  paladin: ['cha', 'str', 'con', 'wis', 'dex', 'int'],
  ranger: ['wis', 'dex', 'con', 'str', 'int', 'cha'],
  rogue: ['dex', 'con', 'int', 'wis', 'cha', 'str'],
  sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};

const CLASS_SKILL_ORDER = {
  barbarian: ['athletics', 'survival', 'perception', 'intimidation'],
  bard: ['performance', 'persuasion', 'insight', 'deception'],
  cleric: ['religion', 'medicine', 'insight', 'persuasion'],
  druid: ['nature', 'animal-handling', 'survival', 'medicine'],
  fighter: ['athletics', 'perception', 'survival', 'intimidation'],
  monk: ['acrobatics', 'stealth', 'insight', 'athletics'],
  paladin: ['athletics', 'persuasion', 'religion', 'insight'],
  ranger: ['survival', 'perception', 'stealth', 'nature'],
  rogue: ['stealth', 'sleight-of-hand', 'perception', 'acrobatics', 'investigation'],
  sorcerer: ['arcana', 'persuasion', 'deception', 'insight'],
  warlock: ['arcana', 'deception', 'intimidation', 'religion'],
  wizard: ['arcana', 'investigation', 'history', 'insight'],
};

function abilityPriority(classDetail, classIndex) {
  const primary = classDetail?.spellcasting?.spellcasting_ability?.index ?? PRIMARY_ABILITY[classIndex];
  return [...new Set([primary, ...(CLASS_ABILITY_ORDER[classIndex] ?? ['con', 'dex']), ...ABILITIES.map(({ key }) => key)])]
    .filter((key) => ABILITIES.some((ability) => ability.key === key));
}

function shuffled(values, rng) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildChoices({ char, classDetail, raceDetail, pool, method, rng }) {
  if (!classDetail) throw new Error('Espera a que se cargue la clase para preparar el reparto.');
  const classIndex = classDetail.index ?? char.class_index;
  const order = abilityPriority(classDetail, classIndex);
  const values = [...pool].sort((a, b) => b - a);
  const baseAbilities = Object.fromEntries(order.map((key, i) => [key, values[i]]));
  const raceSkills = raceAutomaticSkills(raceDetail);
  const { skillChoice, otherChoices } = parseProficiencyChoices(classDetail);
  const eligibleSkills = (skillChoice?.options ?? []).map(({ key }) => key).filter((key) => !raceSkills.includes(key));
  const prioritySkills = rng
    ? shuffled(eligibleSkills, rng)
    : [...new Set([...(CLASS_SKILL_ORDER[classIndex] ?? []), ...eligibleSkills])].filter((key) => eligibleSkills.includes(key));
  const chosenSkills = prioritySkills.slice(0, skillChoice?.choose ?? 0);
  const otherProficiencyChoices = {};
  const otherProficiencies = [];
  for (const group of otherChoices) {
    const options = rng ? shuffled(group.options, rng) : group.options;
    const chosen = options.slice(0, group.choose);
    otherProficiencyChoices[group.groupKey] = chosen.map(({ key }) => key);
    otherProficiencies.push(...chosen.map(({ name }) => name));
  }
  const availableBonuses = (raceDetail?.ability_bonus_options?.from?.options ?? []).map((option) => option.ability_score?.index).filter(Boolean);
  const existingBonuses = char.wizard_data?.raceAbilityChoice ?? [];
  const bonusOrder = rng ? shuffled(availableBonuses, rng) : [...new Set([...existingBonuses, ...order])].filter((key) => availableBonuses.includes(key));
  const raceAbilityChoice = bonusOrder.slice(0, raceDetail?.ability_bonus_options?.choose ?? 0);
  const languageOptions = (raceDetail?.language_options?.from?.options ?? []).map((option) => option.item?.index).filter(Boolean);
  const existingLanguage = char.wizard_data?.raceLanguageChoice;
  const raceLanguageChoice = rng
    ? shuffled(languageOptions, rng)[0] ?? null
    : languageOptions.includes(existingLanguage) ? existingLanguage : languageOptions[0] ?? null;
  return {
    abilities: applyRacialBonuses(baseAbilities, raceDetail, raceAbilityChoice),
    skill_proficiencies: [...new Set([...chosenSkills, ...raceSkills])],
    other_proficiencies: otherProficiencies,
    wizard_data: {
      ...emptyWizardData(),
      ...char.wizard_data,
      flowVersion: WIZARD_FLOW_VERSION,
      abilityMethod: method,
      baseAbilities,
      poolAssignment: { ...baseAbilities },
      rolledPool: method === 'roll' ? [...pool] : null,
      raceAbilityChoice,
      raceLanguageChoice,
      appliedRaceSkillProficiencies: raceSkills,
      otherProficiencyChoices,
    },
  };
}

/** Un reparto editable con el array estándar y las competencias habituales permitidas. */
export function recommendedBuild({ char = {}, classDetail, raceDetail }) {
  return buildChoices({ char, classDetail, raceDetail, pool: STANDARD_ARRAY, method: 'array' });
}

/** Selecciones de equipo inicial; StepEquipo sigue siendo quien materializa el inventario. */
export function startingEquipmentChoices({ classDetail, categoryMembers = {}, rng = Math.random }) {
  const { groups } = parseStartingEquipment(classDetail);
  const equipmentGroupChoice = {};
  const equipmentCategoryPicks = {};
  for (const [index, group] of groups.entries()) {
    const rawOptions = classDetail?.starting_equipment_options?.[index]?.from?.options ?? [];
    const eligible = group.options.filter((option, i) => !rawOptions[i]?.prerequisites?.length &&
      option.categorySlots.every((slot) => categoryMembers[slot.categoryIndex]?.length));
    const option = shuffled(eligible, rng)[0];
    if (!option) continue;
    equipmentGroupChoice[group.key] = option.key;
    for (const slot of option.categorySlots) {
      const members = categoryMembers[slot.categoryIndex];
      equipmentCategoryPicks[slot.pathKey] = Array.from({ length: slot.choose }, () => {
        const member = members[Math.floor(rng() * members.length)];
        return typeof member === 'string' ? member : member.index;
      });
    }
  }
  return { equipmentGroupChoice, equipmentCategoryPicks };
}

/** Especie, clase, tiradas y elecciones válidas; nunca inventa ni sustituye el nombre. */
export function randomBuild({ char = {}, classDetails = {}, raceDetails = {}, categoryMembers = {}, rng = Math.random }) {
  const classOptions = Object.entries(classDetails).filter(([, detail]) => detail);
  const raceOptions = Object.entries(raceDetails).filter(([, detail]) => detail);
  if (!classOptions.length || !raceOptions.length) throw new Error('Espera a que se carguen las especies y clases de esta campaña.');
  const [classIndex, selectedClass] = classOptions[Math.floor(rng() * classOptions.length)];
  const [raceIndex, selectedRace] = raceOptions[Math.floor(rng() * raceOptions.length)];
  const pool = Array.from({ length: 6 }, () => {
    const dice = Array.from({ length: 4 }, () => 1 + Math.floor(rng() * 6)).sort((a, b) => a - b);
    return dice[1] + dice[2] + dice[3];
  });
  const classDetail = { ...selectedClass, index: classIndex };
  const patch = buildChoices({ char, classDetail, raceDetail: selectedRace, pool, method: 'roll', rng });
  return {
    ...patch,
    class_index: classIndex,
    race_index: raceIndex,
    wizard_data: {
      ...patch.wizard_data,
      ...startingEquipmentChoices({ classDetail, categoryMembers, rng }),
      appliedEquipmentSignature: null,
    },
  };
}
