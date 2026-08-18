import { db } from '../db.js';
import { isConditionImmune, parseConditions } from './combatRules.js';
import { abilityModifier, concentrationDC, proficiencyBonus } from './concentration.js';
import {
  absorbTemporaryHitPoints,
  damageAdjustmentText,
  resolveDamageComponents,
} from './damageResolution.js';
import {
  FLUID_TYPES,
  fluidTypeAtRoomPosition,
  normalizeFluidEffects,
} from './fluidRules.js';
import { notifyCombatVisual, postSystemMessage } from './liveMap.js';
import { dropLootMarker, rollLoot } from './loot.js';
import { buildServerD20Roll, buildServerDamageRoll } from './serverDice.js';
import { armorPenaltyAppliesTo } from '../rules/proficiency.js';
import { endCombatIfNoEnemiesLeft, recordDamageAtZero, startDeathSaves } from './turnEconomy.js';
import { isMassiveDamage } from './combatLifecycle.js';

const FLUID_LABELS = {
  agua: 'agua',
  lava: 'lava',
  niebla: 'niebla tóxica',
  veneno: 'veneno o cieno',
  arcana: 'agua arcana',
};
const ABILITY_LABELS = { str: 'Fuerza', dex: 'Destreza', con: 'Constitución', int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' };
const SCORE_KEYS = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };

function jsonValue(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function monsterData(monsterIndex) {
  if (!monsterIndex) return null;
  const row = db
    .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
    .get(monsterIndex);
  return row ? jsonValue(row.data, null) : null;
}

function characterRaceData(character) {
  const index = character?.race_index;
  if (!index) return null;
  let row;
  if (String(index).startsWith('custom:')) {
    const id = Number(String(index).slice('custom:'.length));
    row = Number.isInteger(id)
      ? db
          .prepare(
            `SELECT race.data FROM custom_races race
             LEFT JOIN campaigns campaign ON campaign.id = ?
             WHERE race.id = ? AND (race.user_id = ? OR race.user_id = campaign.dm_user_id)`
          )
          .get(character.campaign_id, id, character.user_id)
      : null;
  } else {
    row = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'races' AND idx = ?")
      .get(index);
  }
  return row ? jsonValue(row.data, null) : null;
}

export function resolveEnvironmentalTarget(campaignId, mapId, targetKind, targetId) {
  if (targetKind === 'personaje') {
    const token = db
      .prepare(
        `SELECT token.*, room.floor_id FROM map_character_tokens token
         JOIN map_rooms room ON room.id = token.room_id
         WHERE token.map_id = ? AND token.character_id = ?`
      )
      .get(mapId, targetId);
    const character = db
      .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?')
      .get(targetId, campaignId);
    if (!token || !character) return null;
    const combatant = db
      .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(campaignId, targetId);
    return { kind: 'personaje', name: character.name, token, character, combatant };
  }

  const token = db
    .prepare(
      `SELECT token.*, room.floor_id FROM map_tokens token
       JOIN map_rooms room ON room.id = token.room_id
       JOIN map_floors floor ON floor.id = room.floor_id
       WHERE token.id = ? AND floor.map_id = ?`
    )
    .get(targetId, mapId);
  if (!token || !['enemigo', 'aliado'].includes(token.kind)) return null;
  const combatant = db
    .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
    .get(campaignId, targetId);
  return { kind: 'marcador', name: token.name, token, combatant };
}

export function environmentalSavingThrowBonus(target, ability) {
  if (target.kind === 'personaje') {
    const abilities = jsonValue(target.character.abilities, {});
    const proficient = jsonValue(target.character.save_proficiencies, []).includes(ability);
    return abilityModifier(abilities[ability] ?? 10) + (proficient ? proficiencyBonus(target.character.level) : 0);
  }
  const data = monsterData(target.combatant?.monster_index ?? target.token.monster_index);
  const explicit = (data?.proficiencies ?? []).find(
    (entry) => entry.proficiency?.index === `saving-throw-${ability}`
  );
  if (Number.isFinite(Number(explicit?.value))) return Number(explicit.value);
  return abilityModifier(data?.[SCORE_KEYS[ability]] ?? 10);
}

/**
 * Desventaja ambiental: un personaje con armadura o escudo sin competencia la
 * arrastra a TODA salvación de FUE o DES, no solo a los ataques (Fase B, cabo
 * pendiente). Los enemigos y marcadores del DM no pasan por esa regla.
 */
export function environmentalSaveAdvantage(target, ability) {
  if (target.kind !== 'personaje') return 'none';
  const character = {
    kind: target.character.kind,
    inventory: jsonValue(target.character.inventory, []),
    armor_proficiencies: jsonValue(target.character.armor_proficiencies, []),
  };
  return armorPenaltyAppliesTo(character, ability) ? 'disadvantage' : 'none';
}

function damageProfile(target) {
  const data = target.kind === 'personaje'
    ? characterRaceData(target.character)
    : monsterData(target.combatant?.monster_index ?? target.token.monster_index);
  return {
    resistances: data?.damage_resistances ?? [],
    vulnerabilities: data?.damage_vulnerabilities ?? [],
    immunities: data?.damage_immunities ?? [],
    petrified: parseConditions(target.combatant?.conditions).includes('petrificado'),
  };
}

function clearFluidConditions(combatant) {
  if (!combatant) return false;
  const tracked = jsonValue(combatant.fluid_conditions, []);
  if (!tracked.length) return false;
  const current = parseConditions(combatant.conditions);
  const next = current.filter((condition) => !tracked.includes(condition));
  db.prepare("UPDATE combatants SET conditions = ?, fluid_conditions = '[]' WHERE id = ?").run(
    JSON.stringify(next),
    combatant.id
  );
  combatant.conditions = JSON.stringify(next);
  combatant.fluid_conditions = '[]';
  return true;
}

function addFluidCondition(target, condition) {
  const combatant = target.combatant;
  if (!combatant || !condition) return { changed: false, immune: false };
  const monster = target.kind === 'marcador'
    ? monsterData(combatant.monster_index ?? target.token.monster_index)
    : null;
  if (monster && isConditionImmune(monster, condition)) return { changed: false, immune: true };
  const current = parseConditions(combatant.conditions);
  if (current.includes(condition)) return { changed: false, immune: false };
  const tracked = jsonValue(combatant.fluid_conditions, []);
  const next = [...current, condition];
  const nextTracked = [...new Set([...tracked, condition])];
  db.prepare('UPDATE combatants SET conditions = ?, fluid_conditions = ? WHERE id = ?').run(
    JSON.stringify(next),
    JSON.stringify(nextTracked),
    combatant.id
  );
  combatant.conditions = JSON.stringify(next);
  combatant.fluid_conditions = JSON.stringify(nextTracked);
  return { changed: true, immune: false };
}

function concentrationSuffix(campaignId, combatant, damage, downed) {
  if (!combatant?.concentration_spell || damage <= 0) return '';
  if (downed) {
    db.prepare('UPDATE combatants SET concentration_spell = NULL WHERE id = ?').run(combatant.id);
    return ` Pierde la concentración en ${combatant.concentration_spell}.`;
  }
  return ` Debe salvar concentración (Constitución CD ${concentrationDC(damage)}).`;
}

export function applyEnvironmentalDamage(campaignId, target, components) {
  const resolved = resolveDamageComponents(components, damageProfile(target), { source: 'environment' });
  const damage = resolved.appliedTotal;
  const adjustments = damageAdjustmentText(resolved.components);
  let suffix = adjustments.length ? ` (${adjustments.join('; ')})` : '';

  if (target.kind === 'personaje') {
    const previousHp = target.character.hp_current ?? 0;
    const absorbed = absorbTemporaryHitPoints(damage, target.character.hp_temp);
    const nextHp = Math.max(0, previousHp - absorbed.hitPointDamage);
    db.prepare("UPDATE characters SET hp_current = ?, hp_temp = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextHp,
      absorbed.remainingTemporaryHitPoints,
      target.character.id
    );
    target.character.hp_current = nextHp;
    target.character.hp_temp = absorbed.remainingTemporaryHitPoints;
    if (damage > 0 && nextHp <= 0 && target.combatant) {
      const massive = isMassiveDamage({
        previousHp,
        hpMax: target.character.hp_max,
        hitPointDamage: absorbed.hitPointDamage,
      });
      if (previousHp > 0 && !massive) startDeathSaves(target.combatant.id);
      else recordDamageAtZero(target.combatant.id, { massive });
    }
    suffix += concentrationSuffix(campaignId, target.combatant, damage, nextHp <= 0);
    return { damage, changed: damage > 0, downed: nextHp <= 0, suffix };
  }

  const combatant = target.combatant;
  if (!combatant || !Number.isInteger(combatant.hp_current)) {
    return { damage, changed: false, downed: false, suffix };
  }
  const absorbed = absorbTemporaryHitPoints(damage, combatant.hp_temp);
  const nextHp = Math.max(0, combatant.hp_current - absorbed.hitPointDamage);
  const firstDefeat = damage > 0 && combatant.hp_current > 0 && nextHp <= 0;
  const rolledLoot = firstDefeat ? rollLoot(jsonValue(target.token.loot, [])) : [];
  let conditions = parseConditions(combatant.conditions);
  if (nextHp <= 0 && !conditions.includes('inconsciente')) conditions = [...conditions, 'inconsciente'];
  db.transaction(() => {
    db.prepare('UPDATE combatants SET hp_current = ?, hp_temp = ?, conditions = ? WHERE id = ?').run(
      nextHp,
      absorbed.remainingTemporaryHitPoints,
      JSON.stringify(conditions),
      combatant.id
    );
    if (firstDefeat) {
      db.prepare("UPDATE map_tokens SET loot = '[]' WHERE id = ?").run(target.token.id);
      dropLootMarker(target.token, rolledLoot);
    }
  })();
  combatant.hp_current = nextHp;
  combatant.hp_temp = absorbed.remainingTemporaryHitPoints;
  combatant.conditions = JSON.stringify(conditions);
  suffix += concentrationSuffix(campaignId, combatant, damage, nextHp <= 0);
  if (rolledLoot.length) suffix += ' Deja algo tras de sí.';
  if (damage > 0 && nextHp <= 0 && endCombatIfNoEnemiesLeft(campaignId)) {
    suffix += ' Ya no quedan enemigos conscientes: vuelve el movimiento libre.';
  }
  return { damage, changed: damage > 0, downed: nextHp <= 0, suffix };
}

function fluidTypesAtPositions(mapId, positions) {
  const rooms = db
    .prepare(
      `SELECT room.* FROM map_rooms room
       JOIN map_floors floor ON floor.id = room.floor_id
       WHERE floor.map_id = ?`
    )
    .all(mapId);
  const found = [];
  for (const position of positions ?? []) {
    const room = rooms.find(
      (entry) => entry.floor_id === position.floorId && fluidTypeAtRoomPosition(entry, position.x, position.y)
    );
    const type = room ? fluidTypeAtRoomPosition(room, position.x, position.y) : null;
    if (FLUID_TYPES.includes(type) && !found.includes(type)) found.push(type);
  }
  return found;
}

function resolveTypes(campaignId, target, effects, types, trigger) {
  let changed = clearFluidConditions(target.combatant);
  const alreadyDown = target.kind === 'personaje'
    ? Number(target.character.hp_current) <= 0
    : Number.isInteger(target.combatant?.hp_current) && target.combatant.hp_current <= 0;
  if (alreadyDown) return { changed, outcomes: [] };
  const outcomes = [];
  for (const type of types) {
    const effect = effects[type];
    if (!effect?.damageDice && !effect?.condition) continue;
    let saved = false;
    let saveText = '';
    if (effect.saveAbility) {
      const roll = buildServerD20Roll({
        bonus: environmentalSavingThrowBonus(target, effect.saveAbility),
        advantage: environmentalSaveAdvantage(target, effect.saveAbility),
        label: `Salvación contra ${FLUID_LABELS[type]}`,
        actorName: target.name,
      });
      saved = !roll.fumble && (roll.crit || roll.total >= effect.saveDc);
      saveText = `${ABILITY_LABELS[effect.saveAbility]} CD ${effect.saveDc}: ${roll.total} (${saved ? 'éxito' : 'fallo'}). `;
    }

    let damageResult = { damage: 0, changed: false, downed: false, suffix: '' };
    let damageText = '';
    if (effect.damageDice) {
      const rolled = buildServerDamageRoll({
        components: [{ dice: effect.damageDice, type: effect.damageType, magical: type === 'arcana' }],
        label: `Daño de ${FLUID_LABELS[type]}`,
        actorName: target.name,
      });
      const components = saved
        ? rolled.components.map((component) => ({ ...component, amount: Math.floor(component.amount / 2) }))
        : rolled.components;
      damageResult = applyEnvironmentalDamage(campaignId, target, components);
      if (damageResult.damage > 0) {
        notifyCombatVisual(campaignId, {
          type: 'damage',
          ...(target.kind === 'personaje'
            ? { characterId: target.character.id }
            : { mapTokenId: target.token.id }),
          value: damageResult.damage,
          strong: damageResult.damage >= 10,
        });
      }
      changed ||= damageResult.changed;
      damageText = `${rolled.roll.total} de daño tirado; recibe ${damageResult.damage}${saved ? ' tras reducirlo a la mitad' : ''}${damageResult.suffix}.`;
    }

    let conditionText = '';
    if (effect.condition && !saved && !damageResult.downed) {
      const condition = addFluidCondition(target, effect.condition);
      changed ||= condition.changed;
      conditionText = condition.immune
        ? ` Es inmune a «${effect.condition}».`
        : condition.changed
          ? ` Gana el estado «${effect.condition}».`
          : '';
    }
    const body = `${target.name} ${trigger} ${FLUID_LABELS[type]}. ${saveText}${damageText}${conditionText}`.trim();
    postSystemMessage(campaignId, body);
    outcomes.push({ type, saved, damage: damageResult.damage, condition: conditionText ? effect.condition : null });
    if (damageResult.downed) break;
  }
  return { changed, outcomes };
}

export function resolveFluidMovement({ campaignId, mapId, targetKind, targetId, positions }) {
  const map = db.prepare('SELECT * FROM maps WHERE id = ? AND campaign_id = ?').get(mapId, campaignId);
  const target = map ? resolveEnvironmentalTarget(campaignId, map.id, targetKind, targetId) : null;
  if (!map || !target) return { changed: false, outcomes: [] };
  const types = fluidTypesAtPositions(map.id, positions);
  return resolveTypes(campaignId, target, normalizeFluidEffects(map.fluid_effects), types, 'cruza');
}

export function resolveFluidTurnEnd(campaignId, combatantId) {
  const table = db.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
  const combatant = db.prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
  if (!table?.active_map_id || !combatant) return { changed: false, outcomes: [] };
  const targetKind = combatant.kind === 'pj' ? 'personaje' : 'marcador';
  const targetId = combatant.kind === 'pj' ? combatant.character_id : combatant.map_token_id;
  const target = resolveEnvironmentalTarget(campaignId, table.active_map_id, targetKind, targetId);
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(table.active_map_id);
  if (!target || !map) return { changed: false, outcomes: [] };
  const type = fluidTypesAtPositions(map.id, [{ floorId: target.token.floor_id, x: target.token.x, y: target.token.y }]);
  return resolveTypes(campaignId, target, normalizeFluidEffects(map.fluid_effects), type, 'termina su turno sobre');
}
