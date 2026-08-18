// Descansos y reloj de campaña (Fase F de la rebanada vertical).
//
// El descanso es un acto de MESA: lo declara quien dirige y afecta a todo el
// grupo, que es como funciona en la partida y lo único que deja el reloj
// coherente (ocho horas son ocho horas para todos, no ocho por jugador).
// Gastar dados de golpe, en cambio, es decisión de cada jugador y va por su
// propia puerta.
//
// El reloj es una capacidad opcional: con él apagado todo esto funciona igual
// y ninguna regla lo consulta.
import { db } from '../db.js';
import { classLevel } from './classProgression.js';
import { hitDieForClass } from './leveling.js';
import { abilityModifier } from '../rules/abilities.js';
import {
  REST_MINUTES,
  advanceClock,
  availableHitDice,
  hitDiceRecovered,
  shortRestHealing,
} from '../rules/rest.js';

/** Espacios de conjuro máximos de una clase a un nivel, o null si no lanza. */
function spellSlotsFor(classIndex, level) {
  const entry = classLevel(classIndex, level);
  if (!entry || !entry.spellSlots.length) return null;
  const slots = {};
  entry.spellSlots.forEach((count, index) => {
    if (count > 0) slots[String(index + 1)] = count;
  });
  return slots;
}

/** Estado de descanso de una ficha, para pintarlo sin recalcularlo en el cliente. */
export function restStateFor(character) {
  const hitDie = hitDieForClass(character.class_index) ?? 8;
  return {
    hitDie,
    total: character.level,
    spent: character.hit_dice_spent ?? 0,
    available: availableHitDice(character.level, character.hit_dice_spent ?? 0),
  };
}

/**
 * Gastar dados de golpe para curarse (descanso corto). Cada dado suma su
 * tirada más el modificador de CON; nunca se pasa de los PG máximos ni se
 * gastan más dados de los que quedan.
 */
export function spendHitDice(characterId, rolls) {
  return db.transaction(() => {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!character) return { ok: false, error: 'Personaje no encontrado' };
    if (character.kind !== 'pj') return { ok: false, error: 'Las fichas del DM no gastan dados de golpe' };

    const state = restStateFor(character);
    if (!Array.isArray(rolls) || rolls.length > state.available) {
      return { ok: false, error: `Solo te quedan ${state.available} dados de golpe` };
    }
    const abilities = JSON.parse(character.abilities || '{}');
    const healing = shortRestHealing(rolls, abilityModifier(abilities.con ?? 10), state.hitDie);
    if (!healing.ok) return { ok: false, error: healing.error };

    const hpCurrent = Math.min(character.hp_max, character.hp_current + healing.healed);
    db.prepare(
      "UPDATE characters SET hp_current = ?, hit_dice_spent = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(hpCurrent, state.spent + healing.spent, character.id);

    return {
      ok: true,
      error: null,
      healed: hpCurrent - character.hp_current,
      rolled: healing.healed,
      hpCurrent,
      hitDice: { ...state, spent: state.spent + healing.spent, available: state.available - healing.spent },
    };
  })();
}

/**
 * Descanso de todo el grupo. El corto no cura solo (para eso están los dados
 * de golpe, que gasta cada jugador); el largo devuelve PG al máximo, la mitad
 * de los dados de golpe y los espacios de conjuro.
 *
 * Con el reloj encendido avanza 1 h o 8 h y cruza de día cuando toca; apagado,
 * el descanso hace exactamente lo mismo sin tocar el tiempo.
 */
export function restCampaign(campaignId, type) {
  if (type !== 'corto' && type !== 'largo') return { ok: false, error: 'El descanso es corto o largo' };
  return db.transaction(() => {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) return { ok: false, error: 'Campaña no encontrada' };

    const characters = db
      .prepare("SELECT * FROM characters WHERE campaign_id = ? AND kind = 'pj'").all(campaignId);
    const restored = [];
    if (type === 'largo') {
      const update = db.prepare(
        `UPDATE characters SET hp_current = hp_max, hp_temp = 0, hit_dice_spent = ?, spells = ?,
           updated_at = datetime('now') WHERE id = ?`
      );
      for (const character of characters) {
        const recovered = hitDiceRecovered(character.level);
        const spent = Math.max(0, (character.hit_dice_spent ?? 0) - recovered);
        const spells = JSON.parse(character.spells || '{"known":[],"prepared":[],"slots":{}}');
        const slots = spellSlotsFor(character.class_index, character.level);
        if (slots) spells.slots = slots;
        // Los espacios gastados vuelven enteros: es justo lo que devuelve un
        // descanso largo. `slotsUsed` queda a cero aunque hoy nadie lo gaste
        // todavía, para que el día que se consuman esto ya sea correcto.
        spells.slotsUsed = {};
        update.run(spent, JSON.stringify(spells), character.id);
        restored.push({
          characterId: character.id,
          name: character.name,
          hpRestored: character.hp_max - character.hp_current,
          hitDiceRecovered: (character.hit_dice_spent ?? 0) - spent,
        });
      }
    }

    let clock = null;
    if (campaign.clock_enabled) {
      const advanced = advanceClock(campaign.day_minutes ?? 0, REST_MINUTES[type]);
      db.prepare('UPDATE campaigns SET day_minutes = ?, elapsed_days = elapsed_days + ? WHERE id = ?').run(
        advanced.dayMinutes,
        advanced.daysCrossed,
        campaignId
      );
      clock = {
        dayMinutes: advanced.dayMinutes,
        daysCrossed: advanced.daysCrossed,
        elapsedDays: (campaign.elapsed_days ?? 0) + advanced.daysCrossed,
      };
    }

    return { ok: true, error: null, type, restored, clock };
  })();
}

/**
 * Enciende o apaga el reloj de la campaña. Al encenderlo por primera vez la
 * hora arranca en un valor por defecto; al apagarlo se conserva tal cual, así
 * que volver a encenderlo no pierde nada.
 */
export function setCampaignClock(campaignId, enabled) {
  const campaign = db.prepare('SELECT clock_enabled, day_minutes FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return { ok: false, error: 'Campaña no encontrada' };
  db.prepare('UPDATE campaigns SET clock_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, campaignId);
  return { ok: true, error: null, clockEnabled: Boolean(enabled), dayMinutes: campaign.day_minutes ?? 480 };
}
