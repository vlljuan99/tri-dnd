import { db } from '../db.js';
import { conditionsPreventActions, parseConditions } from './combatRules.js';
import { gridDistance, monsterAttackGeometry, weaponGeometry } from './combatGeometry.js';
import { hasLineOfSight } from './vision.js';

function abilityModifier(score) {
  return Math.floor((Number(score) - 10) / 2);
}

function proficiencyBonus(level) {
  return 2 + Math.floor((Math.max(1, Number(level) || 1) - 1) / 4);
}

function json(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function equipmentData(index) {
  if (!index || String(index).startsWith('custom:')) return null;
  const row = db.prepare("SELECT data FROM srd_entries WHERE category = 'equipment' AND idx = ?").get(index);
  return row ? json(row.data, null) : null;
}

function propertySet(weapon, data) {
  return new Set(
    (weapon?.properties?.length ? weapon.properties : data?.properties ?? [])
      .map((property) => (typeof property === 'string' ? property : property?.index))
      .filter(Boolean)
  );
}

export function characterOpportunityOptions(character) {
  const inventory = json(character.inventory, []);
  const abilities = json(character.abilities, {});
  const options = [];
  for (const item of inventory) {
    if (!item?.equipped || !item.weapon) continue;
    const data = equipmentData(item.srdIndex);
    const geometry = weaponGeometry(item.weapon, data);
    if (geometry.ranged) continue;
    const properties = propertySet(item.weapon, data);
    const strength = abilityModifier(abilities.str ?? 10);
    const dexterity = abilityModifier(abilities.dex ?? 10);
    const ability = properties.has('finesse') && dexterity > strength ? dexterity : strength;
    options.push({
      id: `arma:${item.id}`,
      name: item.name,
      attackBonus: ability + proficiencyBonus(character.level),
      reach: geometry.reach,
      damage: [
        {
          dice: item.weapon.damageDice ?? data?.damage?.damage_dice ?? null,
          amount: item.weapon.damageDice ? undefined : Math.max(0, ability),
          modifier: ability,
          type: item.weapon.damageType ?? data?.damage?.damage_type?.index ?? null,
        },
      ],
      magical: Boolean(item.weapon.magical),
      silvered: Boolean(item.weapon.silvered),
      adamantine: Boolean(item.weapon.adamantine),
    });
  }
  const strength = abilityModifier(abilities.str ?? 10);
  options.push({
    id: 'desarmado',
    name: 'Golpe desarmado',
    attackBonus: strength + proficiencyBonus(character.level),
    reach: 1,
    damage: [{ dice: null, amount: Math.max(1, 1 + strength), modifier: 0, type: 'bludgeoning' }],
    magical: false,
    silvered: false,
    adamantine: false,
  });
  return options;
}

function monsterData(index) {
  const row = index
    ? db.prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?").get(index)
    : null;
  return row ? json(row.data, null) : null;
}

export function monsterOpportunityOptions(combatant) {
  const data = monsterData(combatant.monster_index);
  if (!data) return [];
  const overrides = json(combatant.overrides, {});
  const magical = (data.special_abilities ?? []).some((ability) =>
    /magic weapons|weapon attacks are magical/i.test(`${ability.name ?? ''} ${ability.desc ?? ''}`)
  );
  return (data.actions ?? [])
    .filter((action) => Number.isInteger(action.attack_bonus))
    .map((action) => ({ action, geometry: monsterAttackGeometry(action) }))
    .filter(({ geometry }) => !geometry.ranged)
    .map(({ action, geometry }) => ({
      id: `monstruo:${action.name}`,
      name: action.name,
      attackBonus: action.attack_bonus + (Number.isInteger(overrides.attackBonus) ? overrides.attackBonus : 0),
      reach: geometry.reach,
      damage: (action.damage ?? []).map((component, index) => ({
        dice: component.damage_dice,
        modifier: index === 0 && Number.isInteger(overrides.damageBonus) ? overrides.damageBonus : 0,
        type: component.damage_type?.index ?? null,
      })),
      magical,
      silvered: false,
      adamantine: false,
    }));
}

export function reachCrossing(path, attacker, reach) {
  for (let index = 1; index < path.length; index += 1) {
    const before = path[index - 1];
    const after = path[index];
    if (gridDistance(attacker, before) <= reach && gridDistance(attacker, after) > reach) {
      return { before, after, distance: gridDistance(attacker, before) };
    }
  }
  return null;
}

function attackerRows(campaignId, moverKind, floorId, mapId) {
  const combatants = db
    .prepare(`SELECT * FROM combatants WHERE campaign_id = ? AND kind = ?`)
    .all(campaignId, moverKind === 'personaje' ? 'enemigo' : 'pj');
  const rows = [];
  for (const combatant of combatants) {
    let token;
    let character = null;
    if (combatant.kind === 'pj') {
      character = db.prepare('SELECT * FROM characters WHERE id = ?').get(combatant.character_id);
      token = db
        .prepare(
          `SELECT t.*, r.floor_id FROM map_character_tokens t
           JOIN map_rooms r ON r.id = t.room_id WHERE t.map_id = ? AND t.character_id = ?`
        )
        .get(mapId, combatant.character_id);
      if (!character || Number(character.hp_current) <= 0) continue;
    } else {
      token = db
        .prepare('SELECT t.*, r.floor_id FROM map_tokens t JOIN map_rooms r ON r.id = t.room_id WHERE t.id = ?')
        .get(combatant.map_token_id);
    }
    if (!token || token.floor_id !== floorId) continue;
    rows.push({ combatant, character, token });
  }
  return rows;
}

export function queueOpportunityAttacks({
  campaignId,
  moverKind,
  moverCharacterId = null,
  moverMapTokenId = null,
  moverName,
  moverCombatant,
  floorId,
  path,
}) {
  const table = db
    .prepare('SELECT combat_active, combat_round FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active || path.length < 2 || moverCombatant?.stance === 'destrabarse') return [];
  const moverConditions = parseConditions(moverCombatant?.conditions);
  if (moverConditions.includes('invisible')) return [];
  const mapId = db.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId)?.active_map_id;
  if (!mapId) return [];
  const rooms = db.prepare('SELECT * FROM map_rooms WHERE floor_id = ?').all(floorId);
  const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ?').all(mapId);
  const created = [];

  for (const { combatant, character, token } of attackerRows(campaignId, moverKind, floorId, mapId)) {
    if (combatant.reaction_used_round === table.combat_round || conditionsPreventActions(combatant.conditions)) continue;
    const attackerConditions = parseConditions(combatant.conditions);
    if (attackerConditions.includes('cegado')) continue;
    const options = combatant.kind === 'pj'
      ? characterOpportunityOptions(character)
      : monsterOpportunityOptions(combatant);
    const eligible = [];
    for (const option of options) {
      const crossing = reachCrossing(path, { x: token.x, y: token.y }, option.reach);
      if (!crossing) continue;
      if (
        !hasLineOfSight({
          rooms,
          doors,
          from: { x: token.x, y: token.y },
          to: crossing.before,
        })
      ) {
        continue;
      }
      eligible.push({ ...option, triggerDistance: crossing.distance });
    }
    if (!eligible.length) continue;

    if (moverKind === 'personaje') {
      db.prepare(
        'DELETE FROM opportunity_attacks WHERE attacker_combatant_id = ? AND target_character_id = ?'
      ).run(combatant.id, moverCharacterId);
    } else {
      db.prepare(
        'DELETE FROM opportunity_attacks WHERE attacker_combatant_id = ? AND target_map_token_id = ?'
      ).run(combatant.id, moverMapTokenId);
    }
    const info = db.prepare(
      `INSERT INTO opportunity_attacks
       (campaign_id, attacker_combatant_id, target_kind, target_character_id, target_map_token_id,
        attacker_name, target_name, attacks, created_round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      campaignId,
      combatant.id,
      moverKind,
      moverCharacterId,
      moverMapTokenId,
      combatant.name,
      moverName,
      JSON.stringify(eligible),
      table.combat_round
    );
    created.push(Number(info.lastInsertRowid));
  }
  return created;
}

function serialize(row) {
  return {
    id: row.id,
    attackerCombatantId: row.attacker_combatant_id,
    attackerName: row.attacker_name,
    targetName: row.target_name,
    attacks: json(row.attacks, []).map(({ damage, ...attack }) => ({
      ...attack,
      damage: damage.map((component) => ({ dice: component.dice, type: component.type })),
    })),
  };
}

export function opportunitiesForViewer(campaignId, { userId, isDm }) {
  const rows = db
    .prepare(
      `SELECT o.*, c.kind, c.character_id, c.reaction_used_round, gt.combat_round,
              ch.user_id AS character_user_id
       FROM opportunity_attacks o
       JOIN combatants c ON c.id = o.attacker_combatant_id
       JOIN game_tables gt ON gt.campaign_id = o.campaign_id
       LEFT JOIN characters ch ON ch.id = c.character_id
       WHERE o.campaign_id = ? AND o.created_round = gt.combat_round
         AND (c.reaction_used_round IS NULL OR c.reaction_used_round <> gt.combat_round)
       ORDER BY o.id`
    )
    .all(campaignId);
  return rows
    .filter((row) => isDm || (row.kind === 'pj' && row.character_user_id === userId))
    .map(serialize);
}

export function getOpportunity(campaignId, opportunityId) {
  const row = db
    .prepare('SELECT * FROM opportunity_attacks WHERE id = ? AND campaign_id = ?')
    .get(opportunityId, campaignId);
  return row ? { ...row, attacks: json(row.attacks, []) } : null;
}

export function dismissOpportunity(campaignId, opportunityId) {
  return db
    .prepare('DELETE FROM opportunity_attacks WHERE id = ? AND campaign_id = ?')
    .run(opportunityId, campaignId).changes > 0;
}

export function clearOpportunitiesForAttacker(attackerCombatantId) {
  db.prepare('DELETE FROM opportunity_attacks WHERE attacker_combatant_id = ?').run(attackerCombatantId);
}
