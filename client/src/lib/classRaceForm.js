import { ABILITIES, SKILLS } from './dnd.js';

// Conversión entre el formulario del editor (Biblioteca) y el `data` con forma
// SRD-compatible que guarda el servidor para clases y razas personalizables
// (Fase 26). Mismo patrón que buildItemData/buildSpellData de customLibrary.js:
// el editor trabaja con campos planos y aquí se serializan a la forma canónica
// (que el servidor vuelve a validar y normalizar — este módulo no es la
// autoridad, solo la comodidad de la UI).

export const HIT_DICE = [6, 8, 10, 12];
export const SIZES = ['Diminuto', 'Pequeño', 'Mediano', 'Grande', 'Enorme', 'Gigantesco'];

// Tipos de daño 5e para resistencias: índice inglés (como el SRD) + etiqueta ES.
export const DAMAGE_TYPES = [
  { index: 'acid', label: 'Ácido' },
  { index: 'bludgeoning', label: 'Contundente' },
  { index: 'cold', label: 'Frío' },
  { index: 'fire', label: 'Fuego' },
  { index: 'force', label: 'Fuerza' },
  { index: 'lightning', label: 'Relámpago' },
  { index: 'necrotic', label: 'Necrótico' },
  { index: 'piercing', label: 'Perforante' },
  { index: 'poison', label: 'Veneno' },
  { index: 'psychic', label: 'Psíquico' },
  { index: 'radiant', label: 'Radiante' },
  { index: 'slashing', label: 'Cortante' },
  { index: 'thunder', label: 'Trueno' },
];

export function damageTypeLabel(index) {
  return DAMAGE_TYPES.find((d) => d.index === index)?.label ?? index;
}
export function skillLabel(index) {
  return SKILLS.find((s) => s.index === index)?.name ?? index;
}

// --- Clases ----------------------------------------------------------------

export function emptyClassForm() {
  return {
    hitDie: 8,
    savingThrows: [], // hasta 2 claves de característica
    spellcastingAbility: '', // '' = sin conjuros
    skillChoose: 2,
    skillFrom: [], // índices de habilidad; vacío = a elegir entre todas
    features: [], // { name, text }
  };
}

export function classDataToForm(data = {}) {
  return {
    hitDie: HIT_DICE.includes(data.hit_die) ? data.hit_die : 8,
    savingThrows: (data.saving_throws ?? []).map((s) => s.index),
    spellcastingAbility: data.spellcasting?.spellcasting_ability?.index ?? '',
    skillChoose: Number.isInteger(data.skill_choices?.choose) ? data.skill_choices.choose : 0,
    skillFrom: data.skill_choices?.from ?? [],
    features: (data.custom_features ?? []).map((f) => ({ name: f.name ?? '', text: f.text ?? '' })),
  };
}

export function buildClassData(form) {
  return {
    hit_die: Number(form.hitDie),
    saving_throws: form.savingThrows.map((index) => ({ index })),
    // Forma canónica anidada (la misma que guarda el servidor), para que al
    // reabrir la clase classDataToForm y classSummary la lean sin depender de
    // que haya pasado por la normalización del backend.
    spellcasting: form.spellcastingAbility
      ? { spellcasting_ability: { index: form.spellcastingAbility } }
      : null,
    skill_choices: { choose: Number(form.skillChoose) || 0, from: form.skillFrom },
    custom_features: form.features
      .map((f) => ({ name: f.name.trim(), text: f.text.trim() }))
      .filter((f) => f.name || f.text),
  };
}

// --- Razas -----------------------------------------------------------------

export function emptyRaceForm() {
  return {
    abilityBonuses: {}, // { dex: 2, con: 1 }
    speed: '',
    size: 'Mediano',
    skillProficiencies: [], // índices de habilidad concedidos
    resistances: [], // índices de tipo de daño
    senses: [], // texto libre corto
    features: [],
  };
}

export function raceDataToForm(data = {}) {
  const abilityBonuses = {};
  for (const b of data.ability_bonuses ?? []) {
    const key = b.ability_score?.index;
    if (key) abilityBonuses[key] = b.bonus;
  }
  return {
    abilityBonuses,
    speed: data.speed == null ? '' : String(data.speed),
    size: SIZES.includes(data.size) ? data.size : 'Mediano',
    skillProficiencies: data.skill_proficiencies ?? [],
    resistances: data.damage_resistances ?? [],
    senses: data.senses ?? [],
    features: (data.custom_features ?? []).map((f) => ({ name: f.name ?? '', text: f.text ?? '' })),
  };
}

export function buildRaceData(form) {
  return {
    ability_bonuses: ABILITIES
      .filter((a) => Number.isInteger(Number(form.abilityBonuses[a.key])) && Number(form.abilityBonuses[a.key]) !== 0)
      .map((a) => ({ ability_score: { index: a.key }, bonus: Number(form.abilityBonuses[a.key]) })),
    speed: form.speed === '' ? null : Number(form.speed),
    size: form.size,
    skill_proficiencies: form.skillProficiencies,
    damage_resistances: form.resistances,
    senses: form.senses.map((s) => s.trim()).filter(Boolean),
    custom_features: form.features
      .map((f) => ({ name: f.name.trim(), text: f.text.trim() }))
      .filter((f) => f.name || f.text),
  };
}

// --- Resumen para el listado ----------------------------------------------

export function classSummary(entry) {
  const d = entry.data ?? {};
  const parts = [`d${d.hit_die ?? '?'}`];
  const saves = (d.saving_throws ?? []).map((s) => ABILITIES.find((a) => a.key === s.index)?.short ?? s.index);
  if (saves.length) parts.push(`salv. ${saves.join('/')}`);
  const ability = d.spellcasting?.spellcasting_ability?.index;
  if (ability) parts.push(`conjuros por ${ABILITIES.find((a) => a.key === ability)?.short ?? ability}`);
  return parts.join(' · ');
}

export function raceSummary(entry) {
  const d = entry.data ?? {};
  const parts = [];
  const bonuses = (d.ability_bonuses ?? [])
    .map((b) => `+${b.bonus} ${ABILITIES.find((a) => a.key === b.ability_score?.index)?.short ?? b.ability_score?.index}`);
  if (bonuses.length) parts.push(bonuses.join(' '));
  if (d.speed != null) parts.push(`vel. ${d.speed}`);
  if ((d.damage_resistances ?? []).length) parts.push(`resist. ${d.damage_resistances.map(damageTypeLabel).join('/')}`);
  return parts.join(' · ') || 'Sin efectos todavía';
}
