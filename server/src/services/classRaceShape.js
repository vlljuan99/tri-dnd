// Forma y validación de las clases y razas personalizables del DM (Fase 26,
// corte 1). El `data` se guarda compatible con una entrada del SRD donde es
// barato (hit_die, saving_throws, ability_bonuses, speed, size) para que
// buildMeta y el detalle del compendio lo lean sin cambios, más unos campos
// propios (destrezas, resistencias, sentidos, rasgos) que el cálculo de la
// ficha (corte 3) aplicará como efectos estructurados.
//
// Módulo puro y testable: no toca la base de datos. Valida y NORMALIZA (recorta
// texto, descarta lo que sobra, ignora claves desconocidas) en vez de confiar
// en lo que mande el cliente, porque este `data` alimentará el cálculo de la
// ficha y un valor basura ahí saldría como un número mal en la hoja de alguien.

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABEL = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };

// Índices de habilidad del SRD (los mismos 18 que client/src/lib/dnd.js SKILLS)
export const SKILL_INDEXES = [
  'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history',
  'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception',
  'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival',
];

// Tipos de daño 5e para resistencias (índice inglés, como el resto del SRD).
export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];

export const HIT_DICE = [6, 8, 10, 12];
export const SIZES = ['Diminuto', 'Pequeño', 'Mediano', 'Grande', 'Enorme', 'Gigantesco'];

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uniqueFrom(value, allowed) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (allowed.includes(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// Rasgos narrativos: siguen siendo texto libre (la mesa los narra), no efectos.
function cleanFeatures(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) => ({ name: cleanText(f?.name, 80), text: cleanText(f?.text, 2000) }))
    .filter((f) => f.name || f.text)
    .slice(0, 30);
}

// Referencia con forma SRD {index, name}, para que buildMeta y el detalle la
// lean igual que una entrada sincronizada.
function abilityRef(key) {
  return { index: key, name: ABILITY_LABEL[key] };
}

/**
 * Valida y normaliza el `data` de una CLASE personalizada. Devuelve
 * { ok:true, data } con la forma canónica, o { ok:false, error }.
 */
export function validateClassData(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Datos de clase no válidos' };
  }

  const hitDie = Number(raw.hit_die);
  if (!HIT_DICE.includes(hitDie)) {
    return { ok: false, error: 'El dado de golpe debe ser d6, d8, d10 o d12' };
  }

  // Salvaciones: 5e da dos por clase; se acepta 0–2 para no bloquear al DM
  // mientras redacta, pero nunca más de dos ni repetidas.
  const saves = uniqueFrom(
    Array.isArray(raw.saving_throws) ? raw.saving_throws.map((s) => s?.index ?? s) : [],
    ABILITY_KEYS
  ).slice(0, 2);

  // Característica de lanzamiento: una de las seis, o null (clase sin conjuros).
  let spellcasting = null;
  const spellAbility = raw.spellcasting?.spellcasting_ability?.index ?? raw.spellcasting_ability ?? null;
  if (spellAbility != null) {
    if (!ABILITY_KEYS.includes(spellAbility)) {
      return { ok: false, error: 'Característica de lanzamiento no válida' };
    }
    spellcasting = { spellcasting_ability: abilityRef(spellAbility) };
  }

  // Elección de habilidades: elige N de una lista (o de todas si la lista va vacía).
  const from = uniqueFrom(raw.skill_choices?.from, SKILL_INDEXES);
  const maxChoose = from.length > 0 ? from.length : SKILL_INDEXES.length;
  let choose = Number(raw.skill_choices?.choose);
  if (!Number.isInteger(choose) || choose < 0) choose = 0;
  choose = Math.min(choose, maxChoose);

  return {
    ok: true,
    data: {
      hit_die: hitDie,
      saving_throws: saves.map(abilityRef),
      spellcasting,
      skill_choices: { choose, from },
      custom_features: cleanFeatures(raw.custom_features),
    },
  };
}

/**
 * Valida y normaliza el `data` de una RAZA personalizada.
 */
export function validateRaceData(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Datos de raza no válidos' };
  }

  // Bonos de característica: como máximo uno por característica, +/- acotado.
  const bonuses = [];
  const seenAbility = new Set();
  const rawBonuses = Array.isArray(raw.ability_bonuses) ? raw.ability_bonuses : [];
  for (const b of rawBonuses) {
    const key = b?.ability_score?.index ?? b?.ability ?? null;
    const amount = Number(b?.bonus ?? b?.amount);
    if (!ABILITY_KEYS.includes(key) || seenAbility.has(key)) continue;
    if (!Number.isInteger(amount) || amount < -5 || amount > 5 || amount === 0) continue;
    seenAbility.add(key);
    bonuses.push({ ability_score: abilityRef(key), bonus: amount });
  }

  // Velocidad: opcional. null = usa la base del personaje (30). 0–120 pies.
  let speed = null;
  if (raw.speed != null && raw.speed !== '') {
    const s = Number(raw.speed);
    if (!Number.isInteger(s) || s < 0 || s > 120) {
      return { ok: false, error: 'La velocidad debe estar entre 0 y 120 pies' };
    }
    speed = s;
  }

  const size = SIZES.includes(raw.size) ? raw.size : null;

  return {
    ok: true,
    data: {
      ability_bonuses: bonuses,
      speed,
      size,
      skill_proficiencies: uniqueFrom(raw.skill_proficiencies, SKILL_INDEXES),
      damage_resistances: uniqueFrom(raw.damage_resistances, DAMAGE_TYPES),
      senses: (Array.isArray(raw.senses) ? raw.senses : [])
        .map((s) => cleanText(s, 60))
        .filter(Boolean)
        .slice(0, 8),
      custom_features: cleanFeatures(raw.custom_features),
    },
  };
}

// Punto de entrada por categoría, para que la ruta de biblioteca no tenga que
// saber qué validador usar.
export function validateContentData(category, raw) {
  if (category === 'classes') return validateClassData(raw);
  if (category === 'races') return validateRaceData(raw);
  return null; // no es una categoría con validación estructurada aquí
}
