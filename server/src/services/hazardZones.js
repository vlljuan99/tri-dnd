import { db } from '../db.js';
import { isConditionImmune, parseConditions } from './combatRules.js';
import { conditionTimer, normalizeConditionTimers } from './combatLifecycle.js';
import {
  applyEnvironmentalDamage,
  environmentalSavingThrowBonus,
  environmentalSaveAdvantage,
  resolveEnvironmentalTarget,
} from './fluidEffects.js';
import { notifyCombatVisual, postSystemMessage } from './liveMap.js';
import { buildServerD20Roll, buildServerDamageRoll, parseDiceNotation } from './serverDice.js';

const ABILITY_LABELS = {
  str: 'Fuerza', dex: 'Destreza', con: 'Constitución',
  int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma',
};

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeHazardZone(row) {
  return {
    id: row.id,
    name: row.name,
    visualType: row.visual_type,
    cells: jsonArray(row.cells),
    triggerTiming: row.trigger_timing,
    saveAbility: row.save_ability,
    saveDc: row.save_dc,
    damageDice: row.damage_dice,
    damageType: row.damage_type,
    halfOnSave: Boolean(row.half_on_save),
    condition: row.condition,
    expiresRound: row.expires_round,
  };
}

export function activeHazardZones(mapId) {
  const map = db.prepare('SELECT campaign_id FROM maps WHERE id = ?').get(mapId);
  if (!map) return [];
  const round = db
    .prepare('SELECT combat_round FROM game_tables WHERE campaign_id = ?')
    .get(map.campaign_id)?.combat_round ?? 1;
  return db
    .prepare('SELECT * FROM combat_zones WHERE map_id = ? AND expires_round >= ? ORDER BY id')
    .all(mapId, round)
    .map(serializeHazardZone);
}

export function validateHazardDraft(draft) {
  const name = typeof draft?.name === 'string' ? draft.name.trim().slice(0, 80) : '';
  if (!name) return { error: 'La zona necesita un nombre' };
  const visualType = ['fuego', 'telarana', 'nube', 'arcana'].includes(draft.visualType)
    ? draft.visualType
    : 'arcana';
  const triggerTiming = ['enter', 'start', 'both'].includes(draft.triggerTiming)
    ? draft.triggerTiming
    : 'both';
  const duration = Number(draft.duration);
  if (!Number.isInteger(duration) || duration < 1 || duration > 20) {
    return { error: 'La zona debe durar entre 1 y 20 rondas' };
  }
  const cells = Array.isArray(draft.cells)
    ? [...new Map(draft.cells.map((cell) => [`${cell?.floorId}:${cell?.x}:${cell?.y}`, cell])).values()]
    : [];
  if (
    cells.length < 1 || cells.length > 200 ||
    cells.some((cell) => !Number.isInteger(cell?.floorId) || !Number.isInteger(cell?.x) || !Number.isInteger(cell?.y))
  ) {
    return { error: 'Las casillas de la zona no son válidas' };
  }
  const saveAbility = draft.saveAbility == null || draft.saveAbility === ''
    ? null
    : ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(draft.saveAbility)
      ? draft.saveAbility
      : undefined;
  if (saveAbility === undefined) return { error: 'La salvación de la zona no es válida' };
  const saveDc = saveAbility ? Number(draft.saveDc) : null;
  if (saveAbility && (!Number.isInteger(saveDc) || saveDc < 5 || saveDc > 30)) {
    return { error: 'La CD debe estar entre 5 y 30' };
  }
  const damageDice = typeof draft.damageDice === 'string' ? draft.damageDice.trim().slice(0, 30) : '';
  if (damageDice && !parseDiceNotation(damageDice)) return { error: 'Los dados de daño no son válidos' };
  const condition = typeof draft.condition === 'string' && draft.condition.trim()
    ? draft.condition.trim().slice(0, 40)
    : null;
  return {
    value: {
      name, visualType, triggerTiming, duration, cells, saveAbility, saveDc,
      damageDice,
      damageType: typeof draft.damageType === 'string' ? draft.damageType.slice(0, 30) : null,
      halfOnSave: draft.halfOnSave !== false,
      condition,
    },
  };
}

function addTemporaryCondition(target, condition) {
  const combatant = target.combatant;
  if (!combatant || !condition) return { changed: false, immune: false };
  if (target.kind === 'marcador' && combatant.monster_index) {
    const row = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
      .get(combatant.monster_index);
    try {
      if (row && isConditionImmune(JSON.parse(row.data), condition)) return { changed: false, immune: true };
    } catch {
      // Una entrada de compendio dañada no bloquea la zona.
    }
  }
  const conditions = parseConditions(combatant.conditions);
  const timers = normalizeConditionTimers(combatant.condition_timers).filter((timer) => timer.condition !== condition);
  const nextConditions = conditions.includes(condition) ? conditions : [...conditions, condition];
  const nextTimers = [...timers, conditionTimer(condition, { duration: 1, timing: 'start' })];
  db.prepare('UPDATE combatants SET conditions = ?, condition_timers = ? WHERE id = ?').run(
    JSON.stringify(nextConditions), JSON.stringify(nextTimers), combatant.id
  );
  return { changed: true, immune: false };
}

function resolveZone(campaignId, target, zone, triggerText) {
  const alreadyDown = target.kind === 'personaje'
    ? Number(target.character.hp_current) <= 0
    : Number.isInteger(target.combatant?.hp_current) && target.combatant.hp_current <= 0;
  if (alreadyDown) return { changed: false, damage: 0 };

  let saved = false;
  let saveText = '';
  if (zone.save_ability) {
    const roll = buildServerD20Roll({
      bonus: environmentalSavingThrowBonus(target, zone.save_ability),
      advantage: environmentalSaveAdvantage(target, zone.save_ability),
      label: `Salvación contra ${zone.name}`,
      actorName: target.name,
    });
    saved = !roll.fumble && (roll.crit || roll.total >= zone.save_dc);
    saveText = `${ABILITY_LABELS[zone.save_ability]} CD ${zone.save_dc}: ${roll.total} (${saved ? 'éxito' : 'fallo'}). `;
  }

  let damageResult = { damage: 0, changed: false, downed: false, suffix: '' };
  let damageText = '';
  if (zone.damage_dice) {
    const rolled = buildServerDamageRoll({
      components: [{ dice: zone.damage_dice, type: zone.damage_type, magical: true }],
      label: `Daño de ${zone.name}`,
      actorName: target.name,
    });
    const components = saved && zone.half_on_save
      ? rolled.components.map((component) => ({ ...component, amount: Math.floor(component.amount / 2) }))
      : saved
        ? rolled.components.map((component) => ({ ...component, amount: 0 }))
        : rolled.components;
    damageResult = applyEnvironmentalDamage(campaignId, target, components);
    damageText = `recibe ${damageResult.damage} de daño${saved && zone.half_on_save ? ' tras reducirlo a la mitad' : ''}${damageResult.suffix}. `;
  }

  let conditionText = '';
  if (zone.condition && !saved && !damageResult.downed) {
    const applied = addTemporaryCondition(target, zone.condition);
    conditionText = applied.immune
      ? `Es inmune a «${zone.condition}».`
      : applied.changed
        ? `Gana «${zone.condition}» hasta el inicio de su próximo turno.`
        : '';
  }
  postSystemMessage(
    campaignId,
    `${target.name} ${triggerText} ${zone.name}. ${saveText}${damageText}${conditionText}`.trim()
  );
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
  return {
    changed: damageResult.changed || Boolean(conditionText),
    damage: damageResult.damage,
    downed: damageResult.downed,
    saved,
  };
}

function zonesForPositions(mapId, round, positions, timings) {
  const keys = new Set((positions ?? []).map((position) => `${position.floorId}:${position.x}:${position.y}`));
  return db
    .prepare('SELECT * FROM combat_zones WHERE map_id = ? AND expires_round >= ? ORDER BY id')
    .all(mapId, round)
    .filter((zone) => timings.includes(zone.trigger_timing))
    .filter((zone) => jsonArray(zone.cells).some((cell) => keys.has(`${cell.floorId}:${cell.x}:${cell.y}`)));
}

export function resolveHazardMovement({ campaignId, mapId, targetKind, targetId, positions }) {
  const round = db.prepare('SELECT combat_round FROM game_tables WHERE campaign_id = ?').get(campaignId)?.combat_round ?? 1;
  const target = resolveEnvironmentalTarget(campaignId, mapId, targetKind, targetId);
  if (!target) return { changed: false, outcomes: [] };
  const outcomes = zonesForPositions(mapId, round, positions, ['enter', 'both']).map((zone) => ({
    zoneId: zone.id,
    ...resolveZone(campaignId, target, zone, 'entra en'),
  }));
  return { changed: outcomes.some((outcome) => outcome.changed), outcomes };
}

export function resolveHazardTurnStart(campaignId, combatantId, round) {
  const table = db.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
  const combatant = db.prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
  if (!table?.active_map_id || !combatant) return { changed: false, expired: false, outcomes: [] };
  const expiredRows = db
    .prepare('SELECT id, name FROM combat_zones WHERE campaign_id = ? AND expires_round < ?')
    .all(campaignId, round);
  const expired = expiredRows.length > 0;
  if (expired) {
    db.prepare('DELETE FROM combat_zones WHERE campaign_id = ? AND expires_round < ?').run(campaignId, round);
    for (const zone of expiredRows) postSystemMessage(campaignId, `Se disipa ${zone.name}.`);
  }
  const targetKind = combatant.kind === 'pj' ? 'personaje' : 'marcador';
  const targetId = combatant.kind === 'pj' ? combatant.character_id : combatant.map_token_id;
  const target = resolveEnvironmentalTarget(campaignId, table.active_map_id, targetKind, targetId);
  if (!target) return { changed: false, expired, outcomes: [] };
  const zones = zonesForPositions(
    table.active_map_id,
    round,
    [{ floorId: target.token.floor_id, x: target.token.x, y: target.token.y }],
    ['start', 'both']
  );
  const outcomes = zones.map((zone) => ({ zoneId: zone.id, ...resolveZone(campaignId, target, zone, 'empieza su turno en') }));
  return { changed: outcomes.some((outcome) => outcome.changed), expired, outcomes };
}
