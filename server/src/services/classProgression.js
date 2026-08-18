// Progresión de clase por nivel (Fase C de la rebanada vertical): qué gana un
// personaje al llegar a cada nivel según el SRD 2014.
//
// Dos fuentes, una respuesta:
//   - `class_levels` (tabla propia, la llena `npm run sync-srd`) aporta la
//     progresión NUMÉRICA: bonificador de competencia, mejoras de
//     característica, trucos, conjuros conocidos, espacios y recursos propios.
//   - `srd_entries` categoría 'features' aporta los rasgos NARRATIVOS, que ya
//     venían sincronizados con su clase y su nivel.
//
// Este servicio es de solo lectura: no decide cuándo sube nadie de nivel (eso
// es la Fase D), solo responde «qué toca al nivel N de esta clase».
import { db } from '../db.js';

const SPELL_SLOT_LEVELS = 9;

/** Espacios de conjuro del SRD (`spell_slots_level_1..9`) como array de 9. */
export function normalizeSpellSlots(spellcasting) {
  const slots = [];
  for (let level = 1; level <= SPELL_SLOT_LEVELS; level++) {
    const value = spellcasting?.[`spell_slots_level_${level}`];
    slots.push(Number.isFinite(value) ? value : 0);
  }
  return slots;
}

/** Fila de `class_levels` a partir de una entrada de /classes/{index}/levels. */
export function classLevelRow(entry) {
  const spellcasting = entry?.spellcasting ?? null;
  return {
    classIndex: entry.class?.index ?? null,
    level: entry.level,
    profBonus: entry.prof_bonus ?? 0,
    abilityScoreBonuses: entry.ability_score_bonuses ?? 0,
    cantripsKnown: Number.isFinite(spellcasting?.cantrips_known) ? spellcasting.cantrips_known : null,
    spellsKnown: Number.isFinite(spellcasting?.spells_known) ? spellcasting.spells_known : null,
    spellSlots: spellcasting ? normalizeSpellSlots(spellcasting) : [],
    classSpecific: entry.class_specific ?? {},
  };
}

// Rasgos narrativos de una clase a un nivel concreto. Se piden a la categoría
// 'features' del compendio, que es donde siguen viviendo (con su descripción
// ya traducida cuando existe).
//
// Los rasgos de subclase se separan: el SRD los guarda con la MISMA clase (un
// rasgo de la Escuela de Evocación declara `class: wizard`), así que meterlos
// con los demás regalaría rasgos de una subclase que el personaje quizá no
// tenga. Van aparte, etiquetados con su subclase.
function featuresFor(classIndex, level) {
  const rows = db
    .prepare(
      `SELECT idx, name_en, name_es, desc_es, json_extract(data, '$.subclass.index') AS subclass
         FROM srd_entries
        WHERE category = 'features'
          AND json_extract(data, '$.class.index') = ?
          AND json_extract(data, '$.level') = ?
        ORDER BY idx`
    )
    .all(classIndex, level)
    .map((row) => ({
      index: row.idx,
      name: row.name_es || row.name_en,
      translated: Boolean(row.name_es),
      desc: row.desc_es,
      subclass: row.subclass ?? null,
    }));
  return {
    features: rows.filter((row) => !row.subclass).map(({ subclass, ...rest }) => rest),
    subclassFeatures: rows.filter((row) => row.subclass),
  };
}

function serialize(row) {
  const { features, subclassFeatures } = featuresFor(row.class_index, row.level);
  return {
    classIndex: row.class_index,
    level: row.level,
    profBonus: row.prof_bonus,
    abilityScoreBonuses: row.ability_score_bonuses,
    cantripsKnown: row.cantrips_known,
    spellsKnown: row.spells_known,
    spellSlots: JSON.parse(row.spell_slots || '[]'),
    classSpecific: JSON.parse(row.class_specific || '{}'),
    features,
    subclassFeatures,
  };
}

/** Progresión completa de una clase, del nivel 1 al 20. Vacío si no está sincronizada. */
export function classProgression(classIndex) {
  return db
    .prepare('SELECT * FROM class_levels WHERE class_index = ? ORDER BY level')
    .all(classIndex)
    .map(serialize);
}

/** Un nivel concreto de una clase, o null si no existe. */
export function classLevel(classIndex, level) {
  const row = db.prepare('SELECT * FROM class_levels WHERE class_index = ? AND level = ?').get(classIndex, level);
  return row ? serialize(row) : null;
}

/**
 * Lo que cambia al pasar de `fromLevel` a `toLevel`: los rasgos nuevos, si toca
 * mejora de característica y cuántos espacios/trucos/conjuros se ganan. Es lo
 * que necesitará el mini-asistente de subida (Fase D) para explicarse.
 */
export function levelUpGains(classIndex, fromLevel, toLevel) {
  const to = classLevel(classIndex, toLevel);
  if (!to) return null;
  const from = classLevel(classIndex, fromLevel);
  const before = from?.spellSlots ?? [];
  return {
    classIndex,
    fromLevel,
    toLevel,
    profBonus: to.profBonus,
    profBonusChanged: (from?.profBonus ?? 0) !== to.profBonus,
    // El SRD publica las mejoras ACUMULADAS hasta ese nivel: toca elegir una
    // cuando el acumulado sube respecto al nivel anterior.
    abilityScoreImprovement: to.abilityScoreBonuses > (from?.abilityScoreBonuses ?? 0),
    features: to.features.filter((feature) => !(from?.features ?? []).some((f) => f.index === feature.index)),
    // Los de subclase se ofrecen aparte: quién los gana depende de la subclase
    // elegida, no del nivel a secas.
    subclassFeatures: to.subclassFeatures,
    cantripsKnown: to.cantripsKnown,
    spellsKnown: to.spellsKnown,
    spellSlots: to.spellSlots,
    newSpellSlots: to.spellSlots.map((slots, i) => Math.max(0, slots - (before[i] ?? 0))),
  };
}
