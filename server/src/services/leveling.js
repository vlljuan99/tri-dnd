// Subida de nivel por milestone (Fase D de la rebanada vertical).
//
// El nivel de un PJ no es un campo que escriba nadie a mano: la campaña
// concede hasta qué nivel puede subir el grupo y el jugador completa la
// subida desde su ficha. Aquí vive esa transacción — comprobar que le toca,
// aplicar PG, mejora de característica, espacios de conjuro y dejar el rastro
// en el histórico — en una sola operación del servidor.
//
// Las fichas del DM (jefes, enemigos, PNJ: `kind = 'boss'`) no pasan por aquí
// y conservan su nivel editable a mano, igual que su CA.
import { db } from '../db.js';
import { isCustomIndex, customIdFromIndex } from './customLibrary.js';
import { classLevel, levelUpGains } from './classProgression.js';
import {
  MAX_LEVEL,
  applyAbilityIncreases,
  constitutionModifier,
  hitPointsGain,
  nextHitPoints,
  validateAbilityIncreases,
} from '../rules/leveling.js';

/** Dado de golpe de una clase, del SRD o de la biblioteca propia del DM. */
export function hitDieForClass(classIndex) {
  if (typeof classIndex !== 'string' || !classIndex) return null;
  const row = isCustomIndex(classIndex)
    ? db.prepare('SELECT data FROM custom_classes WHERE id = ?').get(customIdFromIndex(classIndex))
    : db.prepare("SELECT data FROM srd_entries WHERE category = 'classes' AND idx = ?").get(classIndex);
  if (!row) return null;
  const die = Number(JSON.parse(row.data || '{}').hit_die);
  return Number.isFinite(die) && die > 0 ? die : null;
}

/** Nivel máximo al que puede subir un personaje: el que su campaña haya concedido. */
export function grantedLevelFor(character) {
  if (!character?.campaign_id) return character?.level ?? 1;
  const campaign = db.prepare('SELECT granted_level FROM campaigns WHERE id = ?').get(character.campaign_id);
  return campaign?.granted_level ?? character.level ?? 1;
}

/** ¿Este personaje tiene una subida pendiente ahora mismo? */
export function canLevelUp(character) {
  return (
    character?.kind === 'pj' &&
    character.level < MAX_LEVEL &&
    character.level < grantedLevelFor(character)
  );
}

/**
 * Lo que ganaría el personaje al subir al nivel siguiente, para que la ficha
 * pueda explicarlo ANTES de confirmar: PG por los dos caminos, rasgos nuevos,
 * si toca mejora de característica y cómo quedan los espacios de conjuro.
 * Devuelve null si no le toca subir.
 */
export function levelUpPreview(character) {
  if (!canLevelUp(character)) return null;
  const abilities = JSON.parse(character.abilities || '{}');
  const conMod = constitutionModifier(abilities);
  const hitDie = hitDieForClass(character.class_index) ?? 8;
  const toLevel = character.level + 1;
  const gains = levelUpGains(character.class_index, character.level, toLevel);
  return {
    fromLevel: character.level,
    toLevel,
    hitDie,
    conModifier: conMod,
    // El valor fijo es el camino por defecto de la mesa; la tirada la resuelve
    // el jugador y se manda con la subida.
    hpFixed: hitPointsGain(hitDie, conMod, { method: 'fijo' }),
    hpRollRange: [Math.max(1, 1 + conMod), Math.max(1, hitDie + conMod)],
    // Sin progresión sincronizada (clase propia del DM) la subida sigue siendo
    // posible: da PG y nivel, pero no puede prometer rasgos ni espacios.
    progression: gains,
  };
}

/** Espacios de conjuro del nivel nuevo, en la forma que guarda `characters.spells`. */
function spellSlotsFor(classIndex, level) {
  const entry = classLevel(classIndex, level);
  if (!entry || !entry.spellSlots.length) return null;
  const slots = {};
  entry.spellSlots.forEach((count, index) => {
    if (count > 0) slots[String(index + 1)] = count;
  });
  return slots;
}

/**
 * Sube un nivel al personaje. Transaccional: nivel, PG, características,
 * espacios de conjuro e histórico entran juntos o no entra nada.
 *
 * `hpMethod`: 'fijo' (por defecto) o 'tirada' con el resultado del dado.
 * `abilityIncreases`: reparto de la mejora de característica, solo cuando el
 * nivel al que se sube la concede.
 */
export function levelUpCharacter(characterId, { hpMethod = 'fijo', hpRoll = null, abilityIncreases = null } = {}) {
  return db.transaction(() => {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!character) return { ok: false, error: 'Personaje no encontrado' };
    if (character.kind !== 'pj') {
      return { ok: false, error: 'Las fichas del DM llevan el nivel a mano, no por milestone' };
    }
    if (character.level >= MAX_LEVEL) return { ok: false, error: 'Ya estás al nivel máximo' };
    if (!character.campaign_id) {
      return { ok: false, error: 'Este personaje no está en ninguna campaña: nadie puede concederle el nivel' };
    }
    if (character.level >= grantedLevelFor(character)) {
      return { ok: false, error: 'Tu DM todavía no ha concedido ese nivel' };
    }
    if (hpMethod !== 'fijo' && hpMethod !== 'tirada') {
      return { ok: false, error: 'Los PG se ganan por valor fijo o por tirada' };
    }

    const toLevel = character.level + 1;
    const hitDie = hitDieForClass(character.class_index) ?? 8;
    const abilities = JSON.parse(character.abilities || '{}');

    // La mejora de característica se aplica ANTES de calcular los PG: subir
    // CON en este mismo nivel ya cuenta para el dado de golpe de este nivel.
    const gains = levelUpGains(character.class_index, character.level, toLevel);
    const offersImprovement = Boolean(gains?.abilityScoreImprovement);
    if (!offersImprovement && abilityIncreases && Object.keys(abilityIncreases).length > 0) {
      return { ok: false, error: 'Este nivel no concede mejora de característica' };
    }
    const checked = validateAbilityIncreases(offersImprovement ? abilityIncreases : null, abilities);
    if (!checked.ok) return { ok: false, error: checked.error };
    const nextAbilities = applyAbilityIncreases(abilities, checked.increases);

    const gain = hitPointsGain(hitDie, constitutionModifier(nextAbilities), { method: hpMethod, roll: hpRoll });
    if (gain == null) return { ok: false, error: `La tirada debe ser un d${hitDie} (1-${hitDie})` };
    const { hpMax, hpCurrent } = nextHitPoints(
      { hpMax: character.hp_max, hpCurrent: character.hp_current },
      gain
    );

    const spells = JSON.parse(character.spells || '{"known":[],"prepared":[],"slots":{}}');
    const slots = spellSlotsFor(character.class_index, toLevel);
    if (slots) spells.slots = slots;

    // La ficha desglosa cada característica en «base + raza»; las mejoras se
    // acumulan aparte para que ese desglose siga cuadrando y se vea de dónde
    // sale cada punto.
    const wizardData = JSON.parse(character.wizard_data || '{}');
    const improvements = { ...(wizardData.abilityImprovements ?? {}) };
    for (const [key, value] of Object.entries(checked.increases)) {
      improvements[key] = (improvements[key] ?? 0) + value;
    }
    wizardData.abilityImprovements = improvements;

    db.prepare(
      `UPDATE characters SET level = ?, hp_max = ?, hp_current = ?, abilities = ?, spells = ?,
         wizard_data = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      toLevel,
      hpMax,
      hpCurrent,
      JSON.stringify(nextAbilities),
      JSON.stringify(spells),
      JSON.stringify(wizardData),
      character.id
    );

    db.prepare(
      `INSERT INTO character_levelups (character_id, from_level, to_level, hp_gained, hp_method, hp_roll, ability_increases)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      character.id,
      character.level,
      toLevel,
      gain,
      hpMethod,
      hpMethod === 'tirada' ? hpRoll : null,
      JSON.stringify(checked.increases)
    );

    return {
      ok: true,
      error: null,
      gained: {
        fromLevel: character.level,
        toLevel,
        hpGained: gain,
        hpMax,
        hpMethod,
        abilityIncreases: checked.increases,
        features: gains?.features ?? [],
        spellSlots: slots,
      },
    };
  })();
}

/** Histórico de subidas de un personaje, de la más reciente a la más antigua. */
export function levelHistory(characterId) {
  return db
    .prepare('SELECT * FROM character_levelups WHERE character_id = ? ORDER BY to_level DESC, id DESC')
    .all(characterId)
    .map((row) => ({
      fromLevel: row.from_level,
      toLevel: row.to_level,
      hpGained: row.hp_gained,
      hpMethod: row.hp_method,
      hpRoll: row.hp_roll,
      abilityIncreases: JSON.parse(row.ability_increases || '{}'),
      at: row.created_at,
    }));
}

/**
 * El DM concede un nivel al grupo. No toca ninguna ficha: solo sube el techo
 * de la campaña, y cada jugador completa su subida cuando quiera.
 */
export function grantCampaignLevel(campaignId, level) {
  const campaign = db.prepare('SELECT granted_level FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return { ok: false, error: 'Campaña no encontrada' };
  const next = level ?? campaign.granted_level + 1;
  if (!Number.isInteger(next) || next < 1 || next > MAX_LEVEL) {
    return { ok: false, error: `El nivel debe estar entre 1 y ${MAX_LEVEL}` };
  }
  if (next < campaign.granted_level) {
    return { ok: false, error: 'Un nivel concedido no se retira: el grupo ya lo tiene' };
  }
  db.prepare('UPDATE campaigns SET granted_level = ? WHERE id = ?').run(next, campaignId);
  return { ok: true, error: null, grantedLevel: next, previousLevel: campaign.granted_level };
}
