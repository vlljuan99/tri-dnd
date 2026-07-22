// Tiempo real de la mesa de juego: chat, tiradas compartidas (incluidas las
// ocultas del DM), presencia y estado "en vivo" de la sesión.
import jwt from 'jsonwebtoken';
import { parseCookie } from 'cookie';
import { db } from './db.js';
import { JWT_SECRET, COOKIE_NAME } from './config.js';
import { getMembership, countPlayers } from './routes/campaigns.js';
import {
  bindCampaignMemberEvicter,
  bindCombatBroadcaster,
  bindChatPoster,
  postSystemMessage,
  notifyCampaignMap,
  notifyCombatStarted,
} from './services/liveMap.js';
import { getActiveMapId, touchMap } from './services/mapLibrary.js';
import { rollLoot, dropLootMarker } from './services/loot.js';
import { buildFallDamageRoll, fallDiceForFeet } from './services/fallDamage.js';
import { buildPerceptionRoll, discoverableTrapIds } from './services/perception.js';
import {
  abilityModifier,
  concentrationDC,
  concentrationSaveBonus,
  buildConcentrationSaveRoll,
  proficiencyBonus,
  resolveConcentrationSave,
} from './services/concentration.js';
import { computeFloorVision, hasLineOfSight } from './services/vision.js';
import {
  monsterAttackGeometry,
  rangeValidation,
  weaponGeometry,
} from './services/combatGeometry.js';
import {
  orderedCombatants,
  rollInitiativeDetailed,
  rollInitiativeFor,
  setManualInitiative,
  initiativeSummary,
  setConcentration,
  monsterSpeedFeet,
  startTurnFor,
  ensureTurnStarted,
  activateTurnMode,
  deactivateTurnMode,
  trySpendAction,
  trySpendMonsterAttack,
  tryUseBonusAction,
  tryUseReaction,
  trySpecialAction,
  toggleCondition,
  startDeathSaves,
  recordDeathSave,
  endCombatIfNoEnemiesLeft,
} from './services/turnEconomy.js';
import { parseConditions, resolveAttackEffects } from './services/combatRules.js';
import {
  absorbTemporaryHitPoints,
  damageDetailForViewer,
  damageAdjustmentText,
  resolveDamageComponents,
  sanitizeDamageComponents,
} from './services/damageResolution.js';
import { buildMultiattackPlans, parseMultiattackState } from './services/monsterActions.js';
import { sanitizeChatReferences, standaloneChatReference } from './services/chatReferences.js';
import { buildServerD20Roll, buildServerDamageRoll, parseDiceNotation } from './services/serverDice.js';
import {
  clearOpportunitiesForAttacker,
  dismissOpportunity,
  getOpportunity,
  opportunitiesForViewer,
} from './services/opportunityAttacks.js';
import {
  spellAimValidation,
  spellArea,
  spellAreaCells,
  spellDamageNotation,
} from './services/spellAreas.js';

const roomName = (campaignId) => `campaign:${campaignId}`;

function serializeMessage(row) {
  let references = [];
  if (row.type === 'chat') {
    try {
      const parsed = JSON.parse(row.srd_references || '[]');
      if (Array.isArray(parsed)) references = parsed;
    } catch {
      references = [];
    }
  }
  return {
    id: row.id,
    type: row.type,
    author: row.user_id ? { id: row.user_id, name: row.author_name ?? '—' } : null,
    body: row.type === 'roll' ? JSON.parse(row.body) : row.body,
    references,
    hidden: Boolean(row.hidden),
    createdAt: row.created_at,
  };
}

function insertMessage({ campaignId, userId, type, body, hidden = false, references = [] }) {
  const info = db
    .prepare(
      'INSERT INTO chat_messages (campaign_id, user_id, type, body, hidden, srd_references) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(campaignId, userId, type, body, hidden ? 1 : 0, JSON.stringify(references));
  const row = db
    .prepare(
      `SELECT m.*, u.display_name AS author_name FROM chat_messages m
       LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?`
    )
    .get(info.lastInsertRowid);
  return serializeMessage(row);
}

function recentMessages(campaignId, { includeHidden, userId }) {
  const rows = db
    .prepare(
      `SELECT m.*, u.display_name AS author_name FROM chat_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.campaign_id = ? AND (m.hidden = 0 OR ? OR m.user_id = ?)
       ORDER BY m.id DESC LIMIT 100`
    )
    .all(campaignId, includeHidden ? 1 : 0, userId);
  return rows.reverse().map(serializeMessage);
}

// --- Tracker de iniciativa ------------------------------------------------

// Vista de un combatiente según quién la recibe: el HP/CA exacto de los
// enemigos solo llega al socket del DM, nunca al de los jugadores (mismo
// patrón que las tiradas ocultas: el filtrado ocurre en el backend). Los
// recursos del turno (movimiento/acción/acción adicional/reacción) sí
// viajan a todos: son necesarios para saber qué puede hacer cada cual.
function combatantView(row, { isDm, round }) {
  let conditions = [];
  try {
    conditions = JSON.parse(row.conditions || '[]');
  } catch {
    conditions = [];
  }
  const base = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    initiative: row.initiative,
    // De dónde sale la iniciativa: null = sin tirar todavía, 'auto' = la tiró
    // el servidor, 'manual' = la escribió el DM. Público para todos: el orden
    // de turnos ya lo es, y saber si un número está tirado o puesto a mano es
    // justo lo que hace auditable la automatización.
    initiativeSource: row.initiative_source ?? null,
    characterId: row.character_id,
    mapTokenId: row.map_token_id ?? null,
    movedSquares: row.moved_squares,
    actionUsed: Boolean(row.action_used),
    bonusUsed: Boolean(row.bonus_used),
    reactionAvailable: row.reaction_used_round !== round,
    dashed: Boolean(row.dashed),
    stance: row.stance ?? null,
    conditions,
    // Qué hechizo concentra (null = ninguno). Público: la mesa entera ve al
    // mago apretando los dientes, y el grupo decide a quién protege.
    concentration: row.concentration_spell ?? null,
  };
  if (row.kind === 'pj' && row.character_id) {
    const c = db.prepare('SELECT hp_current, hp_max, hp_temp, ac, speed FROM characters WHERE id = ?').get(row.character_id);
    if (c) {
      const downed = Number.isInteger(c.hp_current) && c.hp_current <= 0;
      Object.assign(base, {
        hpCurrent: c.hp_current,
        hpMax: c.hp_max,
        hpTemp: c.hp_temp ?? 0,
        ac: c.ac,
        speed: c.speed,
        // Desglose de la tirada (1d20 + DES). El del grupo es público: los
        // jugadores comprueban entre ellos que el servidor tiró limpio.
        initiativeRoll:
          row.initiative_d20 != null ? { d20: row.initiative_d20, modifier: row.initiative_mod } : null,
        downed,
        // Muerto de verdad (3 fallos): a diferencia de "agonizando", ya no
        // se pueden tirar más salvaciones de muerte ni volver con un 20.
        dead: downed && row.death_failures >= 3,
        // Salvaciones de muerte: visibles para toda la mesa (el grupo ve caer
        // a un compañero), solo tienen sentido mientras está agonizando.
        deathSaves: downed
          ? { successes: row.death_successes, failures: row.death_failures }
          : null,
      });
    }
  } else if (row.kind === 'enemigo' && isDm) {
    const overrides = JSON.parse(row.overrides || '{}');
    Object.assign(base, {
      hpCurrent: row.hp_current,
      hpMax: row.hp_max,
      hpTemp: row.hp_temp ?? 0,
      ac: row.ac,
      // El desglose del enemigo es del DM, como sus PG y su CA: el modificador
      // de DES delata su ficha. El total sí lo ve todo el mundo (base.initiative):
      // el orden de turnos siempre ha sido público.
      initiativeRoll:
        row.initiative_d20 != null ? { d20: row.initiative_d20, modifier: row.initiative_mod } : null,
      monsterIndex: row.monster_index,
      speed: Number.isInteger(overrides.speed) ? overrides.speed : monsterSpeedFeet(row.monster_index),
      // Variante por instancia (miniboss): el bloque de estadísticas del DM
      // aplica estos deltas a los ataques y muestra los rasgos añadidos.
      overrides,
      multiattackState: parseMultiattackState(row.multiattack_state),
    });
  }
  return base;
}

// Un combatiente en el resumen de iniciativa: «Elara 19 (d20:17 +2 DES)».
function formatInitiativeRoll({ name, d20, modifier, total }) {
  const sign = modifier >= 0 ? '+' : '−';
  return `${name} ${total} (d20:${d20} ${sign}${Math.abs(modifier)} DES)`;
}

// Narra en el chat lo que acaba de tirar el servidor. La automatización solo
// es aceptable si la mesa puede ver de dónde sale cada número, así que el
// desglose del grupo va en un mensaje público; el de los enemigos delata su
// modificador de DES, así que va en uno oculto (solo DM), igual que sus PG y
// su CA. El total de todos, enemigos incluidos, siempre ha sido público.
function narrateInitiativeRolls(campaignId, rolls) {
  if (!rolls.length) return;

  const party = rolls.filter((r) => r.kind === 'pj');
  const enemies = rolls.filter((r) => r.kind !== 'pj');

  postSystemMessage(
    campaignId,
    `Iniciativa tirada por la mesa — ${[
      ...party.map(formatInitiativeRoll),
      ...enemies.map((r) => `${r.name} ${r.total}`),
    ].join(' · ')}`
  );

  if (enemies.length) {
    postSystemMessage(
      campaignId,
      `Iniciativa de los enemigos — ${enemies.map(formatInitiativeRoll).join(' · ')}`,
      { hidden: true }
    );
  }
}

function combatStateFor(campaignId, { isDm = false, userId = null } = {}) {
  const table = db
    .prepare('SELECT combat_active, combat_round, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  const round = table?.combat_round ?? 1;
  return {
    active: Boolean(table?.combat_active),
    round,
    turnId: table?.combat_turn_id ?? null,
    combatants: orderedCombatants(campaignId).map((r) => combatantView(r, { isDm, round })),
    opportunities: opportunitiesForViewer(campaignId, { isDm, userId }),
  };
}

// --- Combate en el tablero -------------------------------------------------

// Localiza y valida el objetivo de un ataque en el mapa activo. La CA nunca
// viaja al cliente: el impacto se decide aquí. Devuelve { error } o
// { ac, name, kind, token, combatant?, character? }.
function validateAttackGeometry(mapId, attacker, resolved, geometry) {
  const distance = Math.max(Math.abs(resolved.token.x - attacker.x), Math.abs(resolved.token.y - attacker.y));
  if (!geometry) return { ok: true, distance, longRange: false };
  const range = rangeValidation(distance, geometry);
  if (!range.ok) return range;
  const rooms = db.prepare('SELECT * FROM map_rooms WHERE floor_id = ?').all(attacker.floor_id);
  const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ?').all(mapId);
  const visible = hasLineOfSight({
    rooms,
    doors,
    from: { x: attacker.x, y: attacker.y },
    to: { x: resolved.token.x, y: resolved.token.y },
  });
  return visible ? { ok: true, distance, longRange: range.longRange } : { ok: false, error: 'No hay línea de visión' };
}

function resolveCombatTarget(campaignId, attackerCharacter, target, { geometry = null } = {}) {
  const mapId = getActiveMapId(campaignId);
  if (!mapId) return { error: 'La mesa no tiene mapa activo' };

  const attacker = db
    .prepare(
      `SELECT t.*, r.floor_id FROM map_character_tokens t
       JOIN map_rooms r ON r.id = t.room_id
       WHERE t.map_id = ? AND t.character_id = ?`
    )
    .get(mapId, attackerCharacter.id);
  if (!attacker) return { error: 'Tu personaje no está en el tablero' };

  let resolved;
  if (target?.kind === 'marcador') {
    const row = db
      .prepare(
        `SELECT t.*, r.floor_id, r.revealed FROM map_tokens t
         JOIN map_rooms r ON r.id = t.room_id
         JOIN map_floors f ON f.id = r.floor_id
         WHERE t.id = ? AND f.map_id = ?`
      )
      .get(target.id, mapId);
    if (!row || row.hidden) return { error: 'Objetivo no encontrado' };
    // Misma regla que la vista del jugador: la sala vale como visible si está
    // revelada o si es donde está su propio personaje ahora mismo (nunca
    // pierde de vista su sala aunque el DM no la haya marcado revelada)
    if (!row.revealed && row.room_id !== attacker.room_id) {
      return { error: 'Objetivo no encontrado' };
    }
    if (row.kind !== 'enemigo' && row.kind !== 'aliado') return { error: 'Eso no se puede atacar' };
    const combatant = db
      .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
      .get(campaignId, row.id);
    resolved = { ac: combatant?.ac ?? 10, name: row.name, kind: 'marcador', token: row, combatant };
  } else if (target?.kind === 'personaje') {
    if (Number(target.id) === attackerCharacter.id) return { error: 'No puedes atacarte a ti mismo' };
    const row = db
      .prepare(
        `SELECT t.*, r.floor_id FROM map_character_tokens t
         JOIN map_rooms r ON r.id = t.room_id
         WHERE t.map_id = ? AND t.character_id = ?`
      )
      .get(mapId, target.id);
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(target.id);
    if (!row || !character) return { error: 'Objetivo no encontrado' };
    const combatant = db
      .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(campaignId, character.id);
    resolved = { ac: character.ac ?? 10, name: character.name, kind: 'personaje', token: row, character, combatant };
  } else {
    return { error: 'Objetivo no válido' };
  }

  if (resolved.token.floor_id !== attacker.floor_id) {
    return { error: 'El objetivo está en otra planta' };
  }
  const validation = validateAttackGeometry(mapId, attacker, resolved, geometry);
  if (!validation.ok) return { error: validation.error };
  return {
    ...resolved,
    attackerToken: attacker,
    distance: validation.distance,
    longRange: validation.longRange,
  };
}

// Igual que resolveCombatTarget, pero el ATACANTE es un marcador del DM
// (enemigo/aliado), no un personaje: se usa cuando el DM ataca a un PJ (o a
// otro marcador) con un enemigo. Comparte la resolución del objetivo con
// resolveCombatTarget salvo la posición del atacante, que aquí sale de
// map_tokens en vez de map_character_tokens.
function resolveCombatTargetFromMarker(campaignId, attackerTokenId, target, { geometry = null } = {}) {
  const mapId = getActiveMapId(campaignId);
  if (!mapId) return { error: 'La mesa no tiene mapa activo' };

  const attacker = db
    .prepare(
      `SELECT t.*, r.floor_id FROM map_tokens t
       JOIN map_rooms r ON r.id = t.room_id
       JOIN map_floors f ON f.id = r.floor_id
       WHERE t.id = ? AND f.map_id = ?`
    )
    .get(attackerTokenId, mapId);
  if (!attacker) return { error: 'El atacante no está en el tablero' };

  let resolved;
  if (target?.kind === 'marcador') {
    if (Number(target.id) === Number(attackerTokenId)) return { error: 'No puede atacarse a sí mismo' };
    const row = db
      .prepare(
        `SELECT t.*, r.floor_id, r.revealed FROM map_tokens t
         JOIN map_rooms r ON r.id = t.room_id
         JOIN map_floors f ON f.id = r.floor_id
         WHERE t.id = ? AND f.map_id = ?`
      )
      .get(target.id, mapId);
    if (!row || row.hidden) return { error: 'Objetivo no encontrado' };
    const combatant = db
      .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
      .get(campaignId, row.id);
    resolved = { ac: combatant?.ac ?? 10, name: row.name, kind: 'marcador', token: row, combatant };
  } else if (target?.kind === 'personaje') {
    const row = db
      .prepare(
        `SELECT t.*, r.floor_id FROM map_character_tokens t
         JOIN map_rooms r ON r.id = t.room_id
         WHERE t.map_id = ? AND t.character_id = ?`
      )
      .get(mapId, target.id);
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(target.id);
    if (!row || !character) return { error: 'Objetivo no encontrado' };
    const combatant = db
      .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(campaignId, character.id);
    resolved = { ac: character.ac ?? 10, name: character.name, kind: 'personaje', token: row, character, combatant };
  } else {
    return { error: 'Objetivo no válido' };
  }

  if (resolved.token.floor_id !== attacker.floor_id) return { error: 'El objetivo está en otra planta' };
  const validation = validateAttackGeometry(mapId, attacker, resolved, geometry);
  if (!validation.ok) return { error: validation.error };
  return {
    ...resolved,
    attackerToken: attacker,
    distance: validation.distance,
    longRange: validation.longRange,
  };
}

// Objetivo de daño ambiental elegido por el DM. A diferencia de un ataque,
// no hay atacante ni distancia que validar: basta con que la criatura siga
// existiendo en el mapa activo. Los objetos y trampas no reciben daño.
function resolveCombatDamageTarget(campaignId, target) {
  const mapId = getActiveMapId(campaignId);
  if (!mapId) return { error: 'La mesa no tiene mapa activo' };

  if (target?.kind === 'marcador') {
    const token = db
      .prepare(
        `SELECT t.*, r.floor_id FROM map_tokens t
         JOIN map_rooms r ON r.id = t.room_id
         JOIN map_floors f ON f.id = r.floor_id
         WHERE t.id = ? AND f.map_id = ?`
      )
      .get(target.id, mapId);
    if (!token || (token.kind !== 'enemigo' && token.kind !== 'aliado')) {
      return { error: 'Objetivo no encontrado' };
    }
    const combatant = db
      .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
      .get(campaignId, token.id);
    return { name: token.name, kind: 'marcador', token, combatant };
  }

  if (target?.kind === 'personaje') {
    const token = db
      .prepare(
        `SELECT t.*, r.floor_id FROM map_character_tokens t
         JOIN map_rooms r ON r.id = t.room_id
         WHERE t.map_id = ? AND t.character_id = ?`
      )
      .get(mapId, target.id);
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(target.id);
    if (!token || !character) return { error: 'Objetivo no encontrado' };
    return { name: character.name, kind: 'personaje', token, character };
  }

  return { error: 'Objetivo no válido' };
}

function monsterData(monsterIndex) {
  if (!monsterIndex) return null;
  const entry = db
    .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
    .get(monsterIndex);
  if (!entry) return null;
  try {
    return JSON.parse(entry.data);
  } catch {
    return null;
  }
}

const SPELLCASTING_FALLBACK = {
  bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis',
  sorcerer: 'cha', warlock: 'cha', wizard: 'int',
};

function jsonValue(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function spellDataForCharacter(character, spellIndex) {
  const spellbook = jsonValue(character.spells, { known: [], prepared: [] });
  const known = (spellbook.known ?? []).find((spell) => spell.index === spellIndex);
  if (!known) return { error: 'Ese conjuro no está en la ficha' };

  let row;
  if (String(spellIndex).startsWith('custom:')) {
    const customId = Number(String(spellIndex).slice('custom:'.length));
    row = Number.isInteger(customId)
      ? db
          .prepare(
            `SELECT spell.data FROM custom_spells spell
             WHERE spell.id = ? AND spell.user_id = ?`
          )
          .get(customId, character.user_id)
      : null;
  } else {
    row = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'spells' AND idx = ?")
      .get(spellIndex);
  }
  if (!row) return { error: 'No se encuentra la definición del conjuro' };
  const data = jsonValue(row.data, null);
  if (Number(data?.level) > 0 && !(spellbook.prepared ?? []).includes(spellIndex)) {
    return { error: 'Ese conjuro no está preparado' };
  }
  return data ? { data, known } : { error: 'La definición del conjuro no es válida' };
}

function spellcastingAbilityFor(character) {
  const classIndex = character.class_index;
  let data = null;
  if (typeof classIndex === 'string' && classIndex.startsWith('custom:')) {
    const id = Number(classIndex.slice('custom:'.length));
    const row = Number.isInteger(id)
      ? db
          .prepare(
            `SELECT custom_class.data FROM custom_classes custom_class
             JOIN campaigns campaign ON campaign.id = ?
             WHERE custom_class.id = ? AND custom_class.user_id IN (?, campaign.dm_user_id)`
          )
          .get(character.campaign_id, id, character.user_id)
      : null;
    data = row ? jsonValue(row.data, null) : null;
  } else if (classIndex) {
    const row = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'classes' AND idx = ?")
      .get(classIndex);
    data = row ? jsonValue(row.data, null) : null;
  }
  return data?.spellcasting?.spellcasting_ability?.index ?? SPELLCASTING_FALLBACK[classIndex] ?? 'int';
}

function spellProfile(character) {
  const abilities = jsonValue(character.abilities, {});
  const ability = spellcastingAbilityFor(character);
  const bonus = abilityModifier(abilities[ability] ?? 10) + proficiencyBonus(character.level);
  return { ability, attackBonus: bonus, saveDc: 8 + bonus };
}

function savingThrowBonus(resolved, ability) {
  if (resolved.kind === 'personaje') {
    const abilities = jsonValue(resolved.character.abilities, {});
    const proficient = jsonValue(resolved.character.save_proficiencies, []).includes(ability);
    return abilityModifier(abilities[ability] ?? 10) + (proficient ? proficiencyBonus(resolved.character.level) : 0);
  }
  const data = monsterData(resolved.combatant?.monster_index ?? resolved.token.monster_index);
  const explicit = (data?.proficiencies ?? []).find(
    (entry) => entry.proficiency?.index === `saving-throw-${ability}`
  );
  return Number.isFinite(Number(explicit?.value))
    ? Number(explicit.value)
    : abilityModifier(data?.[{ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' }[ability]] ?? 10);
}

function savingThrowAdvantage(resolved, combatant, ability) {
  const conditions = parseConditions(combatant?.conditions);
  const monster = resolved.kind === 'marcador'
    ? monsterData(combatant?.monster_index ?? resolved.token.monster_index)
    : null;
  const magicResistance = (monster?.special_abilities ?? []).some((feature) =>
    /magic resistance/i.test(feature.name ?? '')
  );
  const advantage = magicResistance || (combatant?.stance === 'esquivar' && ability === 'dex');
  const disadvantage = ability === 'dex' && conditions.includes('apresado');
  if (advantage === disadvantage) return 'none';
  return advantage ? 'adv' : 'dis';
}

function spellDamageComponents(data, character, slotLevel, critical = false) {
  const rawNotation = spellDamageNotation(data, character.level, slotLevel);
  const abilities = jsonValue(character.abilities, {});
  const castingModifier = abilityModifier(abilities[spellcastingAbilityFor(character)] ?? 10);
  const notation = typeof rawNotation === 'string'
    ? rawNotation.replace(/\+\s*MOD\b/i, castingModifier >= 0 ? `+ ${castingModifier}` : `- ${Math.abs(castingModifier)}`)
    : rawNotation;
  if (!parseDiceNotation(notation)) return null;
  return buildServerDamageRoll({
    components: [{ dice: notation, type: data.damage?.damage_type?.index ?? null, magical: true }],
    crit: critical,
    label: `Daño de ${data.name ?? 'conjuro'}`,
    actorName: character.name,
  });
}

function spellAreaTargets(campaignId, attackerToken, cells, { isDm }) {
  const mapId = getActiveMapId(campaignId);
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  const targets = [];
  const characters = db
    .prepare(
      `SELECT token.character_id AS id, token.x, token.y
       FROM map_character_tokens token
       JOIN map_rooms room ON room.id = token.room_id
       WHERE token.map_id = ? AND room.floor_id = ?`
    )
    .all(mapId, attackerToken.floor_id);
  for (const row of characters) {
    if (!keys.has(`${row.x},${row.y}`)) continue;
    const resolved = resolveCombatDamageTarget(campaignId, { kind: 'personaje', id: row.id });
    if (!resolved.error) targets.push(resolved);
  }
  const markers = db
    .prepare(
      `SELECT token.id, token.x, token.y, token.hidden, room.revealed, token.room_id
       FROM map_tokens token JOIN map_rooms room ON room.id = token.room_id
       WHERE token.map_id = ? AND room.floor_id = ? AND token.kind IN ('enemigo', 'aliado')`
    )
    .all(mapId, attackerToken.floor_id);
  for (const row of markers) {
    if (!keys.has(`${row.x},${row.y}`)) continue;
    if (!isDm && (row.hidden || (!row.revealed && row.room_id !== attackerToken.room_id))) continue;
    const resolved = resolveCombatDamageTarget(campaignId, { kind: 'marcador', id: row.id });
    if (!resolved.error) targets.push(resolved);
  }
  return targets;
}

function halfDamage(components) {
  return components.map((component) => ({ ...component, amount: Math.floor(component.amount / 2) }));
}

function elevationAtToken(token) {
  if (!token?.room_id) return 0;
  const room = db.prepare('SELECT x, y, elevation_cells FROM map_rooms WHERE id = ?').get(token.room_id);
  if (!room) return 0;
  try {
    const localX = token.x - room.x;
    const localY = token.y - room.y;
    return JSON.parse(room.elevation_cells || '[]').find(([x, y]) => x === localX && y === localY)?.[2] ?? 0;
  } catch {
    return 0;
  }
}

function attackEffectsFor(attackerCombatant, resolved, { melee, manualAdvantage }) {
  const attackerConditions = parseConditions(attackerCombatant?.conditions);
  const targetConditions = parseConditions(resolved.combatant?.conditions);
  if (attackerCombatant?.kind === 'pj' && attackerCombatant?.downed && !attackerConditions.includes('inconsciente')) {
    attackerConditions.push('inconsciente');
  }
  if (
    resolved.kind === 'personaje' &&
    Number(resolved.character?.hp_current) <= 0 &&
    !targetConditions.includes('inconsciente')
  ) {
    targetConditions.push('inconsciente');
  }
  return resolveAttackEffects({
    attackerConditions,
    targetConditions,
    targetStance: resolved.combatant?.stance ?? null,
    distance: resolved.distance,
    highGround: !melee && elevationAtToken(resolved.attackerToken) > elevationAtToken(resolved.token),
    ranged: !melee,
    longRange: Boolean(resolved.longRange),
    manualAdvantage,
  });
}

function characterWeapon(character, weaponId, { thrown = false } = {}) {
  if (weaponId === 'desarmado') {
    return {
      id: 'desarmado',
      name: 'Golpe desarmado',
      melee: true,
      damageTypes: ['bludgeoning'],
      magical: false,
      silvered: false,
      adamantine: false,
      geometry: { ranged: false, reach: 1, normalRange: null, longRange: null },
    };
  }
  let inventory;
  try {
    inventory = JSON.parse(character.inventory || '[]');
  } catch {
    inventory = [];
  }
  const item = inventory.find((candidate) => candidate.id === weaponId && candidate.weapon && candidate.equipped);
  if (!item) return null;
  let equipmentData = null;
  if (item.srdIndex && !String(item.srdIndex).startsWith('custom:')) {
    const entry = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'equipment' AND idx = ?")
      .get(item.srdIndex);
    try {
      equipmentData = entry ? JSON.parse(entry.data) : null;
    } catch {
      equipmentData = null;
    }
  }
  const geometry = weaponGeometry(item.weapon, equipmentData, { thrown });
  if (thrown && !geometry.thrown) return null;
  return {
    id: item.id,
    name: item.name,
    melee: !geometry.ranged,
    damageTypes: [item.weapon.damageType ?? null],
    magical: Boolean(item.weapon.magical),
    silvered: Boolean(item.weapon.silvered),
    adamantine: Boolean(item.weapon.adamantine),
    geometry,
  };
}

function monsterAction(data, actionName) {
  if (!data || typeof actionName !== 'string') return null;
  const action = (data.actions ?? []).find(
    (candidate) => candidate.name?.toLowerCase() === actionName.trim().toLowerCase()
  );
  if (!action || !Number.isInteger(action.attack_bonus)) return null;
  const geometry = monsterAttackGeometry(action);
  return {
    action,
    name: action.name,
    melee: !geometry.ranged,
    geometry,
    damageTypes: (action.damage ?? [])
      .filter((component) => typeof component.damage_dice === 'string')
      .map((component) => component.damage_type?.index ?? null),
  };
}

function monsterUsesMagicalAttacks(data) {
  return (data?.special_abilities ?? []).some((ability) =>
    /magic weapons|weapon attacks are magical/i.test(`${ability.name ?? ''} ${ability.desc ?? ''}`)
  );
}

function characterRaceData(character) {
  const index = character?.race_index;
  if (typeof index !== 'string' || !index) return null;
  let row;
  if (index.startsWith('custom:')) {
    const id = Number(index.slice('custom:'.length));
    if (!Number.isInteger(id)) return null;
    row = db
      .prepare(
        `SELECT race.data
         FROM custom_races race
         LEFT JOIN campaigns campaign ON campaign.id = ?
         WHERE race.id = ?
           AND (race.user_id = ? OR race.user_id = campaign.dm_user_id)`
      )
      .get(character.campaign_id, id, character.user_id);
  } else {
    row = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'races' AND idx = ?")
      .get(index);
  }
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function targetDamageProfile(resolved) {
  const data =
    resolved.kind === 'personaje'
      ? characterRaceData(resolved.character)
      : monsterData(resolved.combatant?.monster_index ?? resolved.token?.monster_index);
  const conditions = parseConditions(resolved.combatant?.conditions);
  return {
    resistances: data?.damage_resistances ?? [],
    vulnerabilities: data?.damage_vulnerabilities ?? [],
    immunities: data?.damage_immunities ?? [],
    petrified: conditions.includes('petrificado'),
  };
}

// Aplica daño ya resuelto a un objetivo (personaje o marcador), sea cual sea
// quien ataca (un PJ o un enemigo controlado por el DM): la resolución del
// objetivo puede venir de cualquiera de los dos caminos de arriba, pero
// aplicar el daño es exactamente lo mismo. Devuelve el mensaje de sistema a
// narrar y el detalle para quien preguntó (remainingHp, maxHp, defeated).
// Recibir daño concentrando obliga a una salvación de Constitución (CD 10 o
// la mitad del daño). La app no la tira sola: avisa a la mesa con la CD ya
// calculada y deja el botón en el tracker, porque quien concentra puede tener
// rasgos que la modifiquen y eso vive en texto libre de la ficha. Sin este
// aviso la regla simplemente se olvidaba.
function promptConcentrationCheck(campaignId, combatant, damage) {
  if (!combatant?.concentration_spell) return '';
  const dc = concentrationDC(damage);
  postSystemMessage(
    campaignId,
    `${combatant.name} concentra en ${combatant.concentration_spell} y recibe ${damage} de daño: salvación de Constitución CD ${dc}.`
  );
  return ` Debe salvar concentración (CD ${dc}).`;
}

// Caer inconsciente rompe la concentración sin salvación posible.
function dropConcentrationOnDowned(campaignId, combatant) {
  if (!combatant?.concentration_spell) return '';
  db.prepare('UPDATE combatants SET concentration_spell = NULL WHERE id = ?').run(combatant.id);
  postSystemMessage(
    campaignId,
    `${combatant.name} cae inconsciente: pierde la concentración en ${combatant.concentration_spell}.`
  );
  return '';
}

function applyCombatDamage(campaignId, resolved, incoming, { source = 'attack', critical = false } = {}) {
  const resolution = resolveDamageComponents(incoming.components, targetDamageProfile(resolved), { source });
  const damage = resolution.appliedTotal;
  const adjustments = damageAdjustmentText(resolution.components);
  let body;
  const detail = {
    damage,
    rolledDamage: resolution.rolledTotal,
    components: resolution.components,
    adjustments,
    tempAbsorbed: 0,
    remainingTempHp: null,
    remainingHp: null,
    maxHp: null,
    defeated: false,
  };
  const adjustmentSuffix = adjustments.length ? ` (${adjustments.join('; ')})` : '';

  if (resolved.kind === 'marcador') {
    const combatant = resolved.combatant;
    if (combatant && Number.isInteger(combatant.hp_current)) {
      const absorption = absorbTemporaryHitPoints(damage, combatant.hp_temp);
      const newHp = combatant.hp_current - absorption.hitPointDamage;
      detail.tempAbsorbed = absorption.absorbed;
      detail.remainingTempHp = absorption.remainingTemporaryHitPoints;
      detail.maxHp = combatant.hp_max ?? null;
      if (damage > 0 && newHp <= 0) {
        // Botín (Fase 20): al caer se tira su tabla y lo que toca queda en
        // un marcador saqueable en su casilla
        const rolledLoot = rollLoot(JSON.parse(resolved.token.loot || '[]'));
        db.transaction(() => {
          db.prepare('DELETE FROM combatants WHERE id = ?').run(combatant.id);
          const table = db
            .prepare('SELECT combat_turn_id FROM game_tables WHERE campaign_id = ?')
            .get(campaignId);
          if (table?.combat_turn_id === combatant.id) {
            db.prepare('UPDATE game_tables SET combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
          }
          db.prepare('DELETE FROM map_tokens WHERE id = ?').run(resolved.token.id);
          dropLootMarker(resolved.token, rolledLoot);
        })();
        detail.remainingHp = 0;
        detail.defeated = true;
        body = `${resolved.name} recibe ${damage} puntos de daño${adjustmentSuffix} y cae derrotado.`;
        if (absorption.absorbed) body += ' Sus PG temporales absorben parte del golpe.';
        if (rolledLoot.length) body += ' Deja algo tras de sí.';
        // Sin enemigos que queden, se acabó el encuentro: vuelta a
        // movimiento libre sola, sin esperar a que el DM lo pulse
        if (endCombatIfNoEnemiesLeft(campaignId)) {
          body += ' Sin enemigos: movimiento libre.';
        } else {
          // Si seguía siendo su turno (o nadie tenía turno), que el
          // siguiente combatiente pueda actuar en vez de quedar bloqueada la mesa
          ensureTurnStarted(campaignId);
        }
      } else {
        db.prepare('UPDATE combatants SET hp_current = ?, hp_temp = ? WHERE id = ?').run(
          newHp,
          absorption.remainingTemporaryHitPoints,
          combatant.id
        );
        detail.remainingHp = newHp;
        body = `${resolved.name} recibe ${damage} puntos de daño${adjustmentSuffix}.`;
        if (absorption.absorbed) body += ' Sus PG temporales absorben parte del golpe.';
        // Un PNJ lanzador también concentra: mismo aviso que para el grupo
        if (damage > 0) body += promptConcentrationCheck(campaignId, combatant, damage);
      }
    } else {
      // Sin ficha en el tracker (p. ej. un aliado): solo se narra
      body = `${resolved.name} recibe ${damage} puntos de daño${adjustmentSuffix}.`;
    }
  } else {
    const prevHp = resolved.character.hp_current ?? 0;
    const absorption = absorbTemporaryHitPoints(damage, resolved.character.hp_temp);
    const newHp = Math.max(-99, prevHp - absorption.hitPointDamage);
    db.prepare("UPDATE characters SET hp_current = ?, hp_temp = ?, updated_at = datetime('now') WHERE id = ?").run(
      newHp,
      absorption.remainingTemporaryHitPoints,
      resolved.character.id
    );
    detail.tempAbsorbed = absorption.absorbed;
    detail.remainingTempHp = absorption.remainingTemporaryHitPoints;
    detail.remainingHp = newHp;
    detail.maxHp = resolved.character.hp_max ?? null;
    detail.defeated = newHp <= 0;

    // Salvaciones de muerte: al caer por primera vez, empieza a agonizar
    // (0/0). Si ya estaba a 0 y recibe más daño, cuenta como un fallo de
    // salvación, o dos si el golpe fue crítico.
    const pjCombatant = db
      .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(campaignId, resolved.character.id);
    if (damage > 0 && newHp <= 0) {
      if (prevHp > 0) {
        if (pjCombatant) startDeathSaves(pjCombatant.id);
        dropConcentrationOnDowned(campaignId, pjCombatant);
        body = `${resolved.name} recibe ${damage} puntos de daño${adjustmentSuffix} y cae inconsciente.`;
      } else if (pjCombatant) {
        const addedFailures = critical ? 2 : 1;
        const failures = Math.min(3, pjCombatant.death_failures + addedFailures);
        db.prepare('UPDATE combatants SET death_failures = ? WHERE id = ?').run(failures, pjCombatant.id);
        body =
          failures >= 3
            ? `${resolved.name} recibe daño estando inconsciente y muere.`
            : `${resolved.name} recibe daño estando inconsciente: falla ${addedFailures === 2 ? 'dos salvaciones' : 'una salvación'} de muerte (${failures}/3).`;
      } else {
        body = `${resolved.name} recibe ${damage} puntos de daño${adjustmentSuffix} y cae inconsciente.`;
      }
    } else {
      body = `${resolved.name} recibe ${damage} puntos de daño${adjustmentSuffix}.`;
      if (damage > 0) body += promptConcentrationCheck(campaignId, pjCombatant, damage);
    }
    if (absorption.absorbed) body += ` Sus PG temporales absorben ${absorption.absorbed}.`;
  }

  return { body, detail };
}

// Valida al atacante de un evento de combate: personaje de la campaña, del
// propio usuario (o cualquiera si eres el DM), con tirada razonable
function validateCombatEvent({ campaignId, characterId, roll, user, membershipRole }) {
  const character = db
    .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?')
    .get(characterId, campaignId);
  if (!character) return { error: 'Personaje no encontrado en esta campaña' };
  if (membershipRole !== 'dm' && character.user_id !== user.id) {
    return { error: 'Solo puedes atacar con tu propio personaje' };
  }
  if (!Number.isFinite(Number(roll?.total))) return { error: 'Tirada no válida' };
  if (JSON.stringify(roll ?? {}).length > 8000) return { error: 'Tirada demasiado grande' };
  return { character };
}

function validateAttackMode(roll, effects) {
  if (effects.blocked) return { error: 'Las condiciones actuales impiden atacar' };
  if ((roll?.advantage ?? 'none') !== effects.advantage) {
    return { error: 'Las condiciones del ataque han cambiado; vuelve a tirar' };
  }
  return { ok: true };
}

export function setupSockets(io) {
  // Autenticación por la misma cookie de sesión que la API
  io.use((socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const payload = jwt.verify(cookies[COOKIE_NAME] ?? '', JWT_SECRET);
      const user = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(payload.sub);
      if (!user) return next(new Error('Sesión no válida'));
      socket.data.user = { id: user.id, name: user.display_name };
      next();
    } catch {
      next(new Error('Sesión no válida'));
    }
  });

  function onlineMembers(campaignId) {
    const room = io.sockets.adapter.rooms.get(roomName(campaignId));
    const seen = new Map();
    for (const sid of room ?? []) {
      const s = io.sockets.sockets.get(sid);
      if (s) seen.set(s.data.user.id, s.data.user);
    }
    return [...seen.values()];
  }

  // Si el DM expulsa a alguien, abandonar la sala es parte de la operación
  // de seguridad: eliminar la membresía en SQLite impediría nuevas acciones,
  // pero el socket ya unido todavía podría recibir broadcasts.
  bindCampaignMemberEvicter((campaignId, userId) => {
    const room = roomName(campaignId);
    for (const sid of io.sockets.adapter.rooms.get(room) ?? []) {
      const memberSocket = io.sockets.sockets.get(sid);
      if (memberSocket?.data.user.id !== userId) continue;
      memberSocket.leave(room);
      memberSocket.data.campaigns?.delete(campaignId);
      memberSocket.emit('campaign:removed', { campaignId });
    }
    io.to(room).emit('room:members', onlineMembers(campaignId));
  });

  // Emite un mensaje a la sala; los ocultos solo llegan al DM y a su autor
  function broadcastMessage(campaignId, message, { senderId, dmUserId }) {
    if (!message.hidden) {
      io.to(roomName(campaignId)).emit('chat:new', message);
      return;
    }
    const room = io.sockets.adapter.rooms.get(roomName(campaignId));
    for (const sid of room ?? []) {
      const s = io.sockets.sockets.get(sid);
      if (s && (s.data.user.id === senderId || s.data.user.id === dmUserId)) {
        s.emit('chat:new', message);
      }
    }
  }

  // Emite el estado de combate a cada socket de la sala con la vista que le
  // corresponde según su rol (el DM ve HP/CA exactos de los enemigos)
  function broadcastCombat(campaignId) {
    const room = io.sockets.adapter.rooms.get(roomName(campaignId));
    for (const sid of room ?? []) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      const membership = getMembership(campaignId, s.data.user.id);
      if (!membership) continue;
      s.emit(
        'combat:state',
        combatStateFor(campaignId, { isDm: membership.role === 'dm', userId: s.data.user.id })
      );
    }
  }
  // Las rutas HTTP del mapa también meten enemigos en el tracker al
  // revelarse una sala
  bindCombatBroadcaster(broadcastCombat);

  // Los eventos con disparador (Fase 19) publican mensajes de sistema desde
  // los servicios: firmados por el DM de la campaña y, si el evento es
  // oculto, filtrados igual que una tirada oculta (solo DM/autor los reciben)
  bindChatPoster((campaignId, { body, hidden, userId }) => {
    const dmUserId = db.prepare('SELECT dm_user_id FROM campaigns WHERE id = ?').get(campaignId)?.dm_user_id;
    if (!dmUserId) return;
    const senderId = userId ?? dmUserId;
    const message = insertMessage({ campaignId, userId: senderId, type: 'system', body, hidden });
    broadcastMessage(campaignId, message, { senderId, dmUserId });
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    socket.on('room:join', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
      const table = db.prepare('SELECT is_live FROM game_tables WHERE campaign_id = ?').get(campaignId);

      socket.join(roomName(campaignId));
      socket.data.campaigns = socket.data.campaigns ?? new Set();
      socket.data.campaigns.add(Number(campaignId));

      io.to(roomName(campaignId)).emit('room:members', onlineMembers(campaignId));
      cb?.({
        role: membership.role,
        isLive: Boolean(table?.is_live),
        campaignName: campaign.name,
        messages: recentMessages(campaignId, {
          includeHidden: membership.role === 'dm',
          userId: user.id,
        }),
        members: onlineMembers(campaignId),
        combat: combatStateFor(campaignId, { isDm: membership.role === 'dm', userId: user.id }),
      });
    });

    socket.on('room:leave', ({ campaignId }) => {
      socket.leave(roomName(campaignId));
      socket.data.campaigns?.delete(Number(campaignId));
      io.to(roomName(campaignId)).emit('room:members', onlineMembers(campaignId));
    });

    socket.on('chat:send', ({ campaignId, text, references }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const clean = typeof text === 'string' ? text.trim().slice(0, 2000) : '';
      if (!clean) return cb?.({ error: 'Mensaje vacío' });

      const checked = sanitizeChatReferences(clean, references, (category, index) =>
        db
          .prepare('SELECT category, idx, name_es, name_en FROM srd_entries WHERE category = ? AND idx = ?')
          .get(category, index)
      );
      if (checked.error) return cb?.({ error: checked.error });

      const message = insertMessage({
        campaignId,
        userId: user.id,
        type: 'chat',
        body: clean,
        references: checked.references,
      });
      io.to(roomName(campaignId)).emit('chat:new', message);
      cb?.({ ok: true });
    });

    // Compartir desde la página global del compendio no cambia la sala a la
    // que está unido el navegador: el servidor comprueba membresía, que la
    // sesión esté en vivo y que la clave pertenezca al SRD público.
    socket.on('srd:share', ({ campaignId, category, index }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const table = db.prepare('SELECT is_live FROM game_tables WHERE campaign_id = ?').get(campaignId);
      if (!table?.is_live) return cb?.({ error: 'La mesa ya no está en vivo' });

      const row = db
        .prepare('SELECT category, idx, name_es, name_en FROM srd_entries WHERE category = ? AND idx = ?')
        .get(category, index);
      const shared = standaloneChatReference(row);
      if (!shared) return cb?.({ error: 'Entrada del compendio no encontrada' });

      const message = insertMessage({
        campaignId,
        userId: user.id,
        type: 'chat',
        body: shared.text,
        references: shared.references,
      });
      io.to(roomName(campaignId)).emit('chat:new', message);
      cb?.({ ok: true, message });
    });

    socket.on('roll:send', ({ campaignId, roll, hidden }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const body = JSON.stringify(roll ?? {});
      if (body.length > 8000) return cb?.({ error: 'Tirada demasiado grande' });

      // Solo el DM puede ocultar tiradas
      const isHidden = Boolean(hidden) && membership.role === 'dm';
      const campaign = db.prepare('SELECT dm_user_id FROM campaigns WHERE id = ?').get(campaignId);
      const message = insertMessage({ campaignId, userId: user.id, type: 'roll', body, hidden: isHidden });
      broadcastMessage(campaignId, message, { senderId: user.id, dmUserId: campaign.dm_user_id });
      cb?.({ ok: true });
    });

    // Percepción activa: el jugador elige únicamente su personaje. Posición,
    // alcance, d20, bonificador, trampas y CD se resuelven en servidor para
    // que un cliente modificado no pueda inspeccionar ni descubrir de más.
    socket.on('percepcion:buscar', ({ campaignId, characterId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      if (!Number.isInteger(characterId)) return cb?.({ error: 'Personaje no válido' });

      const character = db
        .prepare('SELECT * FROM characters WHERE id = ? AND user_id = ? AND campaign_id = ?')
        .get(characterId, user.id, campaignId);
      if (!character) return cb?.({ error: 'Ese personaje no te pertenece' });

      const mapId = getActiveMapId(campaignId);
      if (!mapId) return cb?.({ error: 'La mesa no tiene mapa activo' });
      const viewer = db
        .prepare(
          `SELECT t.*, r.floor_id FROM map_character_tokens t
           JOIN map_rooms r ON r.id = t.room_id
           WHERE t.map_id = ? AND t.character_id = ?`
        )
        .get(mapId, character.id);
      if (!viewer) return cb?.({ error: 'Tu personaje no está en el tablero' });

      const map = db.prepare('SELECT vision_radius FROM maps WHERE id = ?').get(mapId);
      const rooms = db.prepare('SELECT * FROM map_rooms WHERE floor_id = ?').all(viewer.floor_id);
      const doors = db
        .prepare(
          `SELECT d.* FROM map_doors d
           JOIN map_rooms fr ON fr.id = d.from_room_id
           JOIN map_rooms tr ON tr.id = d.to_room_id
           WHERE d.map_id = ? AND fr.floor_id = ? AND tr.floor_id = ?`
        )
        .all(mapId, viewer.floor_id, viewer.floor_id);
      const traps = db
        .prepare(
          `SELECT t.* FROM map_tokens t
           JOIN map_rooms r ON r.id = t.room_id
           WHERE r.floor_id = ? AND t.kind = 'trampa' AND t.hidden = 1`
        )
        .all(viewer.floor_id);

      const spend = trySpendAction(campaignId, character.id);
      if (!spend.ok) return cb?.({ error: spend.error });

      const roll = buildPerceptionRoll(character);
      const visibleCells = computeFloorVision({
        rooms,
        doors,
        viewers: [{
          x: viewer.x,
          y: viewer.y,
          radius: Math.max(map?.vision_radius ?? 6, character.darkvision ?? 0),
        }],
      });
      const foundIds = discoverableTrapIds(traps, visibleCells, roll.total);
      const found = traps.filter((trap) => foundIds.includes(trap.id));

      if (foundIds.length) {
        const placeholders = foundIds.map(() => '?').join(',');
        db.transaction(() => {
          db.prepare(`UPDATE map_tokens SET hidden = 0 WHERE id IN (${placeholders})`).run(...foundIds);
          touchMap(mapId);
        })();
      }

      const campaign = db.prepare('SELECT dm_user_id FROM campaigns WHERE id = ?').get(campaignId);
      const rollMessage = insertMessage({
        campaignId,
        userId: user.id,
        type: 'roll',
        body: JSON.stringify(roll),
      });
      broadcastMessage(campaignId, rollMessage, { senderId: user.id, dmUserId: campaign.dm_user_id });

      const narration = found.length
        ? `${character.name} descubre ${found.length === 1 ? found[0].name : `${found.length} trampas`}.`
        : `${character.name} busca trampas, pero no encuentra ninguna.`;
      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body: narration });
      io.to(roomName(campaignId)).emit('chat:new', note);
      if (foundIds.length) notifyCampaignMap(campaignId);
      broadcastCombat(campaignId);
      cb?.({ ok: true, found: found.map((trap) => ({ id: trap.id, name: trap.name })), roll });
    });

    // Ping efímero sobre el tablero: no toca la base de datos, solo rebota
    // a la sala con coordenadas absolutas de planta (cada cliente lo dibuja
    // en su propio tablero compuesto)
    socket.on('mapa:ping', ({ campaignId, floorId, x, y }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(floorId)) {
        return cb?.({ error: 'Ping no válido' });
      }
      io.to(roomName(campaignId)).emit('mapa:ping', { floorId, x, y, by: user.name });
      cb?.({ ok: true });
    });

    // Ping efímero sobre el mapa de mundo: la única voz del jugador en la
    // exploración (viajar sigue siendo solo del DM). Coordenadas en % (0-100)
    // sobre la imagen de la capa (worldMapId). Se rebota a toda la sala. Si el
    // jugador señaló un pin, el nombre se resuelve EN SERVIDOR desde locationId
    // y solo si no es una ubicación oculta (no revelamos ocultas por el ping).
    socket.on('mundo:ping', ({ campaignId, worldMapId, x, y, locationId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      if (!Number.isInteger(worldMapId) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return cb?.({ error: 'Ping no válido' });
      }
      const clamp = (n) => Math.min(100, Math.max(0, n));
      let locationName = null;
      if (Number.isInteger(locationId)) {
        const loc = db
          .prepare('SELECT name, hidden FROM world_locations WHERE id = ? AND campaign_id = ?')
          .get(locationId, campaignId);
        if (loc && !loc.hidden) locationName = loc.name;
      }
      io.to(roomName(campaignId)).emit('mundo:ping', {
        worldMapId,
        x: clamp(x),
        y: clamp(y),
        locationName,
        by: user.name,
      });
      cb?.({ ok: true });
    });

    socket.on('table:set-live', ({ campaignId, isLive }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede abrir o cerrar la sesión' });
      if (isLive && countPlayers(campaignId) < 1) {
        return cb?.({ error: 'Necesitas al menos un jugador para iniciar la partida' });
      }

      db.prepare("UPDATE game_tables SET is_live = ?, updated_at = datetime('now') WHERE campaign_id = ?").run(
        isLive ? 1 : 0,
        campaignId
      );
      io.to(roomName(campaignId)).emit('table:live', { isLive: Boolean(isLive) });
      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: isLive ? 'La sesión ha comenzado' : 'La sesión ha terminado',
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      cb?.({ ok: true });
    });

    // --- Tracker de iniciativa ---------------------------------------

    socket.on('combat:add', ({ campaignId, kind, name, initiative, hpCurrent, hpMax, ac, characterId, monsterIndex }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede añadir combatientes' });

      const cleanKind = kind === 'pj' ? 'pj' : 'enemigo';
      const cleanName = typeof name === 'string' ? name.trim().slice(0, 60) : '';
      if (!cleanName) return cb?.({ error: 'El combatiente necesita un nombre' });

      let charId = null;
      if (cleanKind === 'pj' && Number.isInteger(characterId)) {
        // Una ficha del DM puede estar asignada a la campaña, pero nunca debe
        // entrar por el flujo de PJ: expondría sus PG/CA al resto del grupo.
        const char = db
          .prepare("SELECT id FROM characters WHERE id = ? AND campaign_id = ? AND kind = 'pj'")
          .get(characterId, campaignId);
        if (char) charId = char.id;
      }
      const hpC = cleanKind === 'enemigo' && Number.isInteger(hpCurrent) ? hpCurrent : null;
      const hpM = cleanKind === 'enemigo' && Number.isInteger(hpMax) ? hpMax : null;
      const acVal = cleanKind === 'enemigo' && Number.isInteger(ac) ? ac : null;

      let monsterIdx = null;
      if (cleanKind === 'enemigo' && typeof monsterIndex === 'string' && monsterIndex) {
        const monster = db.prepare('SELECT idx FROM srd_entries WHERE category = ? AND idx = ?').get('monsters', monsterIndex);
        if (monster) monsterIdx = monster.idx;
      }

      // Si el DM no fija una iniciativa concreta, se tira sola (1d20+DES)
      // Sin iniciativa explícita se tira sola (1d20 + DES) y se guarda el
      // desglose; con un número del DM, se respeta y se marca como 'manual'.
      const manual = Number.isInteger(initiative);
      const detail = manual
        ? null
        : rollInitiativeDetailed({ kind: cleanKind, character_id: charId, monster_index: monsterIdx });

      db.prepare(
        `INSERT INTO combatants (campaign_id, character_id, kind, name, initiative, hp_current,
         hp_max, ac, monster_index, initiative_source, initiative_d20, initiative_mod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        campaignId,
        charId,
        cleanKind,
        cleanName,
        manual ? initiative : detail.total,
        hpC,
        hpM,
        acVal,
        monsterIdx,
        manual ? 'manual' : 'auto',
        detail?.d20 ?? null,
        detail?.modifier ?? null
      );
      ensureTurnStarted(campaignId);
      broadcastCombat(campaignId);
      if (detail) narrateInitiativeRolls(campaignId, [{ name: cleanName, kind: cleanKind, ...detail }]);
      cb?.({ ok: true });
    });

    // Tira (o vuelve a tirar) la iniciativa de un combatiente en el servidor.
    // Sustituye a que el cliente tirase por su cuenta: mismo código para
    // todos, y la tirada se narra sola. El DM puede pedirla para cualquiera;
    // un jugador, solo para su propio personaje.
    socket.on('combat:roll-initiative', ({ campaignId, combatantId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db
        .prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?')
        .get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });

      if (membership.role !== 'dm') {
        if (row.kind !== 'pj' || !row.character_id) return cb?.({ error: 'No puedes tirar por este combatiente' });
        const char = db.prepare('SELECT user_id FROM characters WHERE id = ?').get(row.character_id);
        if (!char || char.user_id !== user.id) return cb?.({ error: 'No puedes tirar por este combatiente' });
      }

      const result = rollInitiativeFor(campaignId, combatantId);
      if (!result.ok) return cb?.(result);
      if (resource === 'reaccion') clearOpportunitiesForAttacker(row.id);
      broadcastCombat(campaignId);
      narrateInitiativeRolls(campaignId, [result]);
      cb?.({ ok: true, total: result.total });
    });

    socket.on('combat:add-party', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede añadir al grupo' });

      // «Añadir grupo» significa únicamente personajes jugadores. Los PNJ,
      // enemigos y jefes del DM se añaden por su flujo propio de combatiente.
      const characters = db
        .prepare("SELECT id, name FROM characters WHERE campaign_id = ? AND kind = 'pj'")
        .all(campaignId);
      const existingIds = new Set(
        db
          .prepare("SELECT character_id FROM combatants WHERE campaign_id = ? AND kind = 'pj'")
          .all(campaignId)
          .map((r) => r.character_id)
      );
      const insert = db.prepare(
        `INSERT INTO combatants (campaign_id, character_id, kind, name, initiative,
         initiative_source, initiative_d20, initiative_mod)
         VALUES (?, ?, 'pj', ?, ?, 'auto', ?, ?)`
      );
      const rolls = [];
      for (const c of characters) {
        if (existingIds.has(c.id)) continue;
        const detail = rollInitiativeDetailed({ kind: 'pj', character_id: c.id });
        insert.run(campaignId, c.id, c.name, detail.total, detail.d20, detail.modifier);
        rolls.push({ name: c.name, kind: 'pj', ...detail });
      }
      ensureTurnStarted(campaignId);
      broadcastCombat(campaignId);
      narrateInitiativeRolls(campaignId, rolls);
      cb?.({ ok: true });
    });

    socket.on('combat:set-initiative', ({ campaignId, combatantId, initiative }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db.prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });

      if (membership.role !== 'dm') {
        if (row.kind !== 'pj' || !row.character_id) return cb?.({ error: 'No puedes editar este combatiente' });
        const char = db.prepare('SELECT user_id FROM characters WHERE id = ?').get(row.character_id);
        if (!char || char.user_id !== user.id) return cb?.({ error: 'No puedes editar este combatiente' });
      }

      const init = Number(initiative);
      if (!Number.isInteger(init) || init < -20 || init > 60) return cb?.({ error: 'Iniciativa no válida' });
      // A mano: sin desglose que auditar, y marcada como 'manual' para que
      // "respetar las tiradas existentes" no la pise al abrir el combate.
      setManualInitiative(campaignId, row.id, init);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    socket.on('combat:update', ({ campaignId, combatantId, name, hpCurrent, hpMax, hpTemp, ac }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede editar combatientes' });

      const row = db.prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });

      if (typeof name === 'string' && name.trim()) {
        db.prepare('UPDATE combatants SET name = ? WHERE id = ?').run(name.trim().slice(0, 60), row.id);
      }

      if (row.kind === 'pj' && row.character_id) {
        const patch = {};
        if (Number.isInteger(hpCurrent)) patch.hp_current = Math.max(-99, Math.min(999, hpCurrent));
        if (Number.isInteger(hpMax)) patch.hp_max = Math.max(0, Math.min(999, hpMax));
        if (Number.isInteger(hpTemp)) patch.hp_temp = Math.max(0, Math.min(999, hpTemp));
        if (Object.keys(patch).length) {
          const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE characters SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
            ...Object.values(patch),
            row.character_id
          );
        }
      } else {
        const patch = {};
        if (Number.isInteger(hpCurrent)) patch.hp_current = Math.max(-99, Math.min(999, hpCurrent));
        if (Number.isInteger(hpMax)) patch.hp_max = Math.max(0, Math.min(999, hpMax));
        if (Number.isInteger(hpTemp)) patch.hp_temp = Math.max(0, Math.min(999, hpTemp));
        if (Number.isInteger(ac)) patch.ac = Math.max(0, Math.min(40, ac));
        if (Object.keys(patch).length) {
          const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE combatants SET ${sets} WHERE id = ?`).run(...Object.values(patch), row.id);
        }
      }
      broadcastCombat(campaignId);
      // El HP editado en el tracker también actualiza las barras del tablero
      notifyCampaignMap(campaignId);
      cb?.({ ok: true });
    });

    socket.on('combat:remove', ({ campaignId, combatantId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede quitar combatientes' });

      db.prepare('DELETE FROM combatants WHERE id = ? AND campaign_id = ?').run(combatantId, campaignId);
      const table = db.prepare('SELECT combat_turn_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      if (table?.combat_turn_id === combatantId) {
        db.prepare('UPDATE game_tables SET combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
      }
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    socket.on('combat:start', ({ campaignId, rerollAll = true }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede iniciar el combate' });

      // Arranque fresco: resetea los recursos de todos y tira iniciativa según
      // lo que haya elegido el DM (por todos, o solo por quien no tenga)
      const { rolls } = activateTurnMode(campaignId, { rerollAll: rerollAll !== false });
      // Primero el estado (para que el cartel ya tenga el orden), luego el
      // aviso: cartel a pantalla + mensaje de chat, igual que el automático
      broadcastCombat(campaignId);
      notifyCombatStarted(campaignId);
      narrateInitiativeRolls(campaignId, rolls);
      cb?.({ ok: true });
    });

    // Avanza al siguiente combatiente por iniciativa, saltando de ronda al
    // dar la vuelta, y resetea sus recursos del turno. Compartido por
    // combat:next (solo DM) y combat:end-turn (el propio jugador o el DM).
    function advanceTurn(campaignId) {
      const list = orderedCombatants(campaignId);
      if (list.length === 0) return { error: 'No hay combatientes' };

      const table = db.prepare('SELECT combat_round, combat_turn_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const idx = list.findIndex((c) => c.id === table?.combat_turn_id);
      const nextIdx = idx === -1 ? 0 : (idx + 1) % list.length;
      const wrapped = idx !== -1 && nextIdx === 0;
      const nextRound = (table?.combat_round ?? 1) + (wrapped ? 1 : 0);

      startTurnFor(campaignId, list[nextIdx].id, nextRound);
      return { ok: true };
    }

    socket.on('combat:next', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede avanzar el turno' });

      const result = advanceTurn(campaignId);
      if (result.error) return cb?.(result);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    // Termina tu propio turno: lo puede pulsar quien tiene el turno (el
    // dueño del PJ activo) o siempre el DM, por si controla el combatiente
    // activo (un enemigo) o el jugador no está disponible.
    socket.on('combat:end-turn', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      if (membership.role !== 'dm') {
        const table = db.prepare('SELECT combat_turn_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
        const active = table?.combat_turn_id
          ? db.prepare('SELECT * FROM combatants WHERE id = ?').get(table.combat_turn_id)
          : null;
        const owns =
          active?.kind === 'pj' &&
          active.character_id &&
          db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(active.character_id, user.id);
        if (!owns) return cb?.({ error: 'No es tu turno' });
      }

      const result = advanceTurn(campaignId);
      if (result.error) return cb?.(result);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    // Marca a mano un recurso del turno como gastado: la acción adicional
    // (solo en tu turno) o la reacción (una por ronda). Las oportunidades y
    // los conjuros también la consumen solos, pero el control manual se conserva.
    socket.on('combat:use-resource', ({ campaignId, combatantId, resource }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db.prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });

      if (membership.role !== 'dm') {
        const owns =
          row.kind === 'pj' &&
          row.character_id &&
          db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(row.character_id, user.id);
        if (!owns) return cb?.({ error: 'Ese combatiente no es tuyo' });
      }

      const result =
        resource === 'reaccion'
          ? tryUseReaction(campaignId, row.id)
          : resource === 'adicional'
            ? tryUseBonusAction(campaignId, row.id)
            : { ok: false, error: 'Recurso no válido' };
      if (!result.ok) return cb?.(result);

      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body:
          resource === 'reaccion'
            ? `${row.name} usa su reacción.`
            : `${row.name} usa su acción adicional.`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    // Acción especial del turno que gasta la acción: Correr (dobla el
    // movimiento), Esquivar (ya altera ataques) o Destrabarse. La puede
    // lanzar el dueño del PJ activo o el DM (controla enemigos/ausentes).
    socket.on('combat:special-action', ({ campaignId, combatantId, kind }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db.prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });
      if (membership.role !== 'dm') {
        const owns =
          row.kind === 'pj' &&
          row.character_id &&
          db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(row.character_id, user.id);
        if (!owns) return cb?.({ error: 'Ese combatiente no es tuyo' });
      }

      const result = trySpecialAction(campaignId, row.id, kind);
      if (!result.ok) return cb?.(result);

      const verb = kind === 'correr' ? 'corre' : kind === 'esquivar' ? 'se prepara para esquivar' : 'se destraba';
      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body: `${row.name} ${verb}.` });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    // Pone o quita una condición de combate a un combatiente (envenenado,
    // derribado…). Solo el DM: es su llamada narrativa. Persiste entre turnos.
    // Marca o levanta la concentración. A diferencia de las condiciones (que
    // gestiona solo el DM), quien concentra suele ser un PJ y es su jugador
    // quien sabe lo que acaba de lanzar: puede marcarlo él mismo.
    socket.on('combat:set-concentration', ({ campaignId, combatantId, spell }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db
        .prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?')
        .get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });

      if (membership.role !== 'dm') {
        if (row.kind !== 'pj' || !row.character_id) return cb?.({ error: 'No puedes concentrar por este combatiente' });
        const char = db.prepare('SELECT user_id FROM characters WHERE id = ?').get(row.character_id);
        if (!char || char.user_id !== user.id) return cb?.({ error: 'No puedes concentrar por este combatiente' });
      }

      const previous = row.concentration_spell;
      const result = setConcentration(campaignId, combatantId, spell);
      if (!result.ok) return cb?.(result);

      if (result.spell && result.spell !== previous) {
        postSystemMessage(campaignId, `${row.name} empieza a concentrarse en ${result.spell}.`);
      } else if (!result.spell && previous) {
        postSystemMessage(campaignId, `${row.name} deja de concentrarse en ${previous}.`);
      }
      broadcastCombat(campaignId);
      cb?.({ ok: true, spell: result.spell });
    });

    // Salvación de concentración: la tira el SERVIDOR (1d20 + CON, con
    // competencia si la ficha la tiene) y decide, igual que percepción o
    // caída. Quien concentra no elige su propio resultado.
    socket.on('combat:concentration-save', ({ campaignId, combatantId, dc }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db
        .prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?')
        .get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });
      if (!row.concentration_spell) return cb?.({ error: 'Ese combatiente no está concentrando' });

      if (membership.role !== 'dm') {
        if (row.kind !== 'pj' || !row.character_id) return cb?.({ error: 'No puedes tirar por este combatiente' });
        const char = db.prepare('SELECT user_id FROM characters WHERE id = ?').get(row.character_id);
        if (!char || char.user_id !== user.id) return cb?.({ error: 'No puedes tirar por este combatiente' });
      }

      const targetDc = Number.isInteger(dc) && dc >= 10 && dc <= 40 ? dc : 10;
      // El bonificador sale de la ficha si es un PJ; un PNJ del DM no tiene
      // ficha 5e completa aquí, así que tira a pelo y el DM ajusta si toca.
      const character = row.character_id
        ? db.prepare('SELECT * FROM characters WHERE id = ?').get(row.character_id)
        : null;
      const roll = buildConcentrationSaveRoll({
        actorName: row.name,
        bonus: character ? concentrationSaveBonus(character) : 0,
        spell: row.concentration_spell,
      });
      const outcome = resolveConcentrationSave({ total: roll.total, natural: roll.natural, dc: targetDc });

      const rollNote = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollNote);

      const spell = row.concentration_spell;
      if (!outcome.held) {
        db.prepare('UPDATE combatants SET concentration_spell = NULL WHERE id = ?').run(row.id);
      }
      postSystemMessage(
        campaignId,
        outcome.held
          ? `${row.name} aguanta la concentración en ${spell} (${roll.total} contra CD ${targetDc}).`
          : `${row.name} pierde la concentración en ${spell} (${roll.total} contra CD ${targetDc}).`
      );
      broadcastCombat(campaignId);
      cb?.({ ok: true, held: outcome.held, total: roll.total, dc: targetDc });
    });

    socket.on('combat:toggle-condition', ({ campaignId, combatantId, condition }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM gestiona las condiciones' });

      const result = toggleCondition(campaignId, combatantId, condition);
      if (!result.ok) return cb?.(result);
      broadcastCombat(campaignId);
      cb?.({ ok: true, conditions: result.conditions });
    });

    // Salvación de muerte de un PJ a 0 PG: el cliente tira un d20 (sin
    // modificador salvo rasgos que la mesa aplique) y el servidor decide según
    // las reglas 5e. La puede tirar el dueño del PJ o el DM.
    socket.on('combat:death-save', ({ campaignId, combatantId, roll, d20 }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const row = db
        .prepare("SELECT * FROM combatants WHERE id = ? AND campaign_id = ? AND kind = 'pj'")
        .get(combatantId, campaignId);
      if (!row) return cb?.({ error: 'Combatiente no encontrado' });
      if (membership.role !== 'dm') {
        const owns =
          row.character_id &&
          db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(row.character_id, user.id);
        if (!owns) return cb?.({ error: 'Ese personaje no es tuyo' });
      }

      const character = db.prepare('SELECT hp_current FROM characters WHERE id = ?').get(row.character_id);
      if (!character || character.hp_current > 0) {
        return cb?.({ error: 'Ese personaje no está agonizando' });
      }
      if (row.death_failures >= 3) {
        return cb?.({ error: 'Ese personaje ya ha muerto' });
      }

      const die = Number.isInteger(d20) ? d20 : Math.round(Number(roll?.total)) || 1;
      const result = recordDeathSave(campaignId, row.id, die);
      if (!result.ok) return cb?.(result);

      // Con un 20 natural el personaje recupera 1 PG (vuelve en sí)
      if (result.outcome === 'revive') {
        db.prepare("UPDATE characters SET hp_current = 1, updated_at = datetime('now') WHERE id = ?").run(row.character_id);
      }

      if (roll) {
        const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
        io.to(roomName(campaignId)).emit('chat:new', rollMessage);
      }

      const bodies = {
        revive: `${row.name} saca un 20 natural en su salvación de muerte y vuelve en sí con 1 PG.`,
        estable: `${row.name} logra su tercera salvación de muerte y se estabiliza.`,
        exito: `${row.name} supera una salvación de muerte (${result.successes}/3).`,
        fallo: `${row.name} falla una salvación de muerte (${result.failures}/3).`,
        muere: `${row.name} falla su tercera salvación de muerte y muere.`,
      };
      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body: bodies[result.outcome] });
      io.to(roomName(campaignId)).emit('chat:new', note);

      const mapId = getActiveMapId(campaignId);
      if (mapId) touchMap(mapId);
      notifyCampaignMap(campaignId);
      broadcastCombat(campaignId);
      cb?.({ ok: true, outcome: result.outcome });
    });

    // Alterna entre modo por turnos (bloquea movimiento/acción fuera de tu
    // turno) y modo libre (sin restricciones), sin vaciar el tracker.
    // `rerollAll` solo se mira al ENCENDER el modo por turnos: true tira por
    // todos, false respeta a quien ya tenga iniciativa propia. Lo elige el DM
    // en el diálogo de la mesa; el valor por defecto conserva el
    // comportamiento histórico (tirar por todos).
    socket.on('combat:toggle-mode', ({ campaignId, rerollAll = true }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede cambiar el modo de la mesa' });

      const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const turningOn = !table?.combat_active;

      let body;
      let rolls = [];
      if (turningOn) {
        ({ rolls } = activateTurnMode(campaignId, { rerollAll: rerollAll !== false }));
        body = 'Modo por turnos activado: movimiento y acciones solo en tu turno.';
      } else {
        deactivateTurnMode(campaignId);
        body = 'Modo libre: movimiento y acciones sin restricción de turno.';
      }
      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      // Cartel de aviso tras difundir el estado, para que ya tenga el orden
      if (turningOn) io.to(roomName(campaignId)).emit('combat:started');
      narrateInitiativeRolls(campaignId, rolls);
      cb?.({ ok: true, active: turningOn });
    });

    // Cuántas iniciativas conservaría "respetar las existentes": el diálogo
    // del DM lo necesita para no ofrecer una opción que no cambia nada.
    socket.on('combat:initiative-summary', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM' });
      cb?.({ ok: true, ...initiativeSummary(campaignId) });
    });

    socket.on('combat:end', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede terminar el combate' });

      db.prepare('DELETE FROM combatants WHERE campaign_id = ?').run(campaignId);
      db.prepare(
        'UPDATE game_tables SET combat_active = 0, combat_round = 1, combat_turn_id = NULL WHERE campaign_id = ?'
      ).run(campaignId);

      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body: 'El combate ha terminado' });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    // El movimiento ya ha sucedido cuando aparece esta ventana: 5e deja al
    // dueño decidir si gasta su reacción. La tirada y el daño se resuelven
    // enteramente en servidor porque la casilla que disparó la oportunidad
    // y las opciones legales quedaron auditadas al confirmar el camino.
    socket.on('combat:opportunity', ({ campaignId, opportunityId, attackId, accept = true }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const opportunity = getOpportunity(campaignId, opportunityId);
      if (!opportunity) return cb?.({ error: 'La oportunidad ya no está disponible' });
      const attacker = db
        .prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?')
        .get(opportunity.attacker_combatant_id, campaignId);
      if (!attacker) {
        dismissOpportunity(campaignId, opportunityId);
        broadcastCombat(campaignId);
        return cb?.({ error: 'El atacante ya no está en combate' });
      }
      const ownsAttacker =
        attacker.kind === 'pj' &&
        attacker.character_id &&
        Boolean(
          db.prepare('SELECT 1 FROM characters WHERE id = ? AND user_id = ?').get(attacker.character_id, user.id)
        );
      if (membership.role !== 'dm' && !ownsAttacker) {
        return cb?.({ error: 'Esa reacción no te pertenece' });
      }

      if (!accept) {
        dismissOpportunity(campaignId, opportunityId);
        broadcastCombat(campaignId);
        return cb?.({ ok: true, declined: true });
      }

      const option = opportunity.attacks.find((candidate) => candidate.id === attackId);
      if (!option) return cb?.({ error: 'Ataque de oportunidad no válido' });
      const target = {
        kind: opportunity.target_kind,
        id:
          opportunity.target_kind === 'personaje'
            ? opportunity.target_character_id
            : opportunity.target_map_token_id,
      };
      const resolved = resolveCombatDamageTarget(campaignId, target);
      if (resolved.error) {
        dismissOpportunity(campaignId, opportunityId);
        broadcastCombat(campaignId);
        return cb?.({ error: resolved.error });
      }
      if (!resolved.combatant) {
        resolved.combatant =
          resolved.kind === 'personaje'
            ? db
                .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
                .get(campaignId, resolved.character.id)
            : null;
      }
      resolved.ac =
        resolved.kind === 'personaje'
          ? resolved.character.ac ?? 10
          : resolved.combatant?.ac ?? 10;
      const mapId = getActiveMapId(campaignId);
      const attackerToken =
        attacker.kind === 'pj'
          ? db
              .prepare(
                `SELECT t.*, r.floor_id FROM map_character_tokens t
                 JOIN map_rooms r ON r.id = t.room_id
                 WHERE t.map_id = ? AND t.character_id = ?`
              )
              .get(mapId, attacker.character_id)
          : db
              .prepare(
                `SELECT t.*, r.floor_id FROM map_tokens t
                 JOIN map_rooms r ON r.id = t.room_id WHERE t.id = ?`
              )
              .get(attacker.map_token_id);
      if (!attackerToken) {
        dismissOpportunity(campaignId, opportunityId);
        broadcastCombat(campaignId);
        return cb?.({ error: 'El atacante ya no está en el tablero' });
      }

      const triggerResolved = {
        ...resolved,
        attackerToken,
        distance: option.triggerDistance,
        longRange: false,
      };
      const effects = attackEffectsFor(attacker, triggerResolved, {
        melee: true,
        manualAdvantage: 'none',
      });
      if (effects.blocked) return cb?.({ error: 'Las condiciones actuales impiden atacar' });
      const reaction = tryUseReaction(campaignId, attacker.id);
      if (!reaction.ok) {
        clearOpportunitiesForAttacker(attacker.id);
        broadcastCombat(campaignId);
        return cb?.(reaction);
      }

      const attackRoll = buildServerD20Roll({
        bonus: option.attackBonus,
        advantage: effects.advantage,
        label: `Ataque de oportunidad: ${option.name}`,
        actorName: attacker.name,
      });
      const naturalCrit = attackRoll.crit;
      const hit = naturalCrit || (!attackRoll.fumble && attackRoll.total >= resolved.ac);
      const critical = hit && (naturalCrit || effects.autoCrit);
      const sharedAttack = critical && !naturalCrit
        ? { ...attackRoll, crit: true, forcedCrit: true }
        : attackRoll;
      const attackMessage = insertMessage({
        campaignId,
        userId: user.id,
        type: 'roll',
        body: JSON.stringify(sharedAttack),
      });
      io.to(roomName(campaignId)).emit('chat:new', attackMessage);

      let damage = null;
      if (hit && option.damage.length) {
        const built = buildServerDamageRoll({
          components: option.damage,
          crit: critical,
          label: `Daño de ${option.name}`,
          actorName: attacker.name,
        });
        built.components = built.components.map((component) => ({
          ...component,
          magical: Boolean(option.magical),
          silvered: Boolean(option.silvered),
          adamantine: Boolean(option.adamantine),
        }));
        const damageMessage = insertMessage({
          campaignId,
          userId: user.id,
          type: 'roll',
          body: JSON.stringify(built.roll),
        });
        io.to(roomName(campaignId)).emit('chat:new', damageMessage);
        const applied = applyCombatDamage(campaignId, resolved, built, {
          source: 'attack',
          critical,
        });
        damage = damageDetailForViewer(applied.detail, {
          enemy: resolved.kind === 'marcador',
          isDm: membership.role === 'dm',
        });
        const damageNote = insertMessage({
          campaignId,
          userId: user.id,
          type: 'system',
          body: applied.body,
        });
        io.to(roomName(campaignId)).emit('chat:new', damageNote);
        if (mapId) touchMap(mapId);
        notifyCampaignMap(campaignId);
      }

      const resultNote = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: hit
          ? `${attacker.name} aprovecha su reacción contra ${resolved.name}: impacta${critical ? ' (crítico)' : ''}.`
          : `${attacker.name} aprovecha su reacción contra ${resolved.name}: falla.`,
      });
      io.to(roomName(campaignId)).emit('chat:new', resultNote);
      clearOpportunitiesForAttacker(attacker.id);
      broadcastCombat(campaignId);
      cb?.({ ok: true, hit, crit: critical, ac: resolved.ac, damage });
    });

    // Conjuros lanzados desde el tablero: el cliente solo elige conjuro,
    // centro/dirección y espacio. Alcance, visión, objetivos de la plantilla,
    // CA, salvaciones y daño salen de la ficha y del SRD en el servidor.
    socket.on('combate:lanzar-conjuro', ({ campaignId, characterId, spellIndex, aim, target, slotLevel }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const character = db
        .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?')
        .get(characterId, campaignId);
      if (!character) return cb?.({ error: 'Personaje no encontrado en esta campaña' });
      if (membership.role !== 'dm' && character.user_id !== user.id) {
        return cb?.({ error: 'Solo puedes lanzar con tu propio personaje' });
      }
      const spellResult = spellDataForCharacter(character, spellIndex);
      if (spellResult.error) return cb?.(spellResult);
      const data = { ...spellResult.data, name: spellResult.known.name ?? spellResult.data.name };
      const requestedSlot = Math.trunc(Number(slotLevel) || Number(data.level) || 0);
      if (requestedSlot < Number(data.level) || requestedSlot > 9) {
        return cb?.({ error: 'Nivel de espacio de conjuro no válido' });
      }

      const mapId = getActiveMapId(campaignId);
      const attackerToken = mapId
        ? db
            .prepare(
              `SELECT token.*, room.floor_id FROM map_character_tokens token
               JOIN map_rooms room ON room.id = token.room_id
               WHERE token.map_id = ? AND token.character_id = ?`
            )
            .get(mapId, character.id)
        : null;
      if (!attackerToken) return cb?.({ error: 'Tu personaje no está en el tablero' });

      const area = spellArea(data);
      let targets = [];
      let targetForAttack = null;
      let aimCell;
      if (area) {
        if (!Number.isInteger(aim?.x) || !Number.isInteger(aim?.y)) {
          return cb?.({ error: 'Elige un centro o una dirección para el conjuro' });
        }
        aimCell = { x: aim.x, y: aim.y };
        const rooms = db.prepare('SELECT * FROM map_rooms WHERE floor_id = ?').all(attackerToken.floor_id);
        const liesOnFloor = rooms.some(
          (room) =>
            aimCell.x >= room.x && aimCell.x < room.x + room.width &&
            aimCell.y >= room.y && aimCell.y < room.y + room.height
        );
        if (!liesOnFloor) return cb?.({ error: 'El centro del conjuro debe estar sobre el tablero' });
        const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ?').all(mapId);
        const sight = hasLineOfSight({
          rooms,
          doors,
          from: { x: attackerToken.x, y: attackerToken.y },
          to: aimCell,
        });
        const aimCheck = spellAimValidation(
          data,
          { x: attackerToken.x, y: attackerToken.y },
          aimCell,
          sight
        );
        if (!aimCheck.ok) return cb?.({ error: aimCheck.error });
        const cells = spellAreaCells({
          origin: { x: attackerToken.x, y: attackerToken.y },
          aim: aimCell,
          area,
          self: aimCheck.range === 0,
        });
        targets = spellAreaTargets(campaignId, attackerToken, cells, {
          isDm: membership.role === 'dm',
        });
      } else {
        targetForAttack = resolveCombatTarget(campaignId, character, target);
        if (targetForAttack.error) return cb?.({ error: targetForAttack.error });
        aimCell = { x: targetForAttack.token.x, y: targetForAttack.token.y };
        const rooms = db.prepare('SELECT * FROM map_rooms WHERE floor_id = ?').all(attackerToken.floor_id);
        const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ?').all(mapId);
        const aimCheck = spellAimValidation(
          data,
          { x: attackerToken.x, y: attackerToken.y },
          aimCell,
          hasLineOfSight({
            rooms,
            doors,
            from: { x: attackerToken.x, y: attackerToken.y },
            to: aimCell,
          })
        );
        if (!aimCheck.ok) return cb?.({ error: aimCheck.error });
        targets = [targetForAttack];
      }

      const attackerCombatant = db
        .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
        .get(campaignId, character.id);
      const profile = spellProfile(character);
      const attackType = data.attack_type === 'melee' ? 'melee' : data.attack_type ? 'ranged' : null;
      let attackEffects = null;
      if (attackType && targetForAttack) {
        attackEffects = attackEffectsFor(attackerCombatant, {
          ...targetForAttack,
          attackerToken,
          distance: Math.max(
            Math.abs(targetForAttack.token.x - attackerToken.x),
            Math.abs(targetForAttack.token.y - attackerToken.y)
          ),
          longRange: false,
        }, { melee: attackType === 'melee', manualAdvantage: 'none' });
        if (attackEffects.blocked) {
          return cb?.({ error: 'Las condiciones actuales impiden lanzar este ataque' });
        }
      }
      const combatActive = Boolean(
        db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId)?.combat_active
      );
      let resourceSpend;
      if (!combatActive) {
        resourceSpend = { ok: true };
      } else if (/bonus action|acción adicional|accion adicional/i.test(data.casting_time ?? '')) {
        resourceSpend = attackerCombatant
          ? tryUseBonusAction(campaignId, attackerCombatant.id)
          : { ok: false, error: 'El lanzador no está en el orden de combate' };
      } else if (/reaction|reacción|reaccion/i.test(data.casting_time ?? '')) {
        resourceSpend = attackerCombatant
          ? tryUseReaction(campaignId, attackerCombatant.id)
          : { ok: false, error: 'El lanzador no está en el orden de combate' };
        if (resourceSpend.ok) clearOpportunitiesForAttacker(attackerCombatant.id);
      } else {
        resourceSpend = trySpendAction(campaignId, character.id);
      }
      if (!resourceSpend.ok) return cb?.({ error: resourceSpend.error });

      const outcomes = [];
      let damageRoll = null;
      let spellAttackCritical = false;

      if (attackType && targetForAttack) {
        const attackRoll = buildServerD20Roll({
          bonus: profile.attackBonus,
          advantage: attackEffects.advantage,
          label: `${data.name} — ataque de conjuro`,
          actorName: character.name,
        });
        const naturalCrit = attackRoll.crit;
        const hit = naturalCrit || (!attackRoll.fumble && attackRoll.total >= targetForAttack.ac);
        spellAttackCritical = hit && (naturalCrit || attackEffects.autoCrit);
        const shared = spellAttackCritical && !naturalCrit
          ? { ...attackRoll, crit: true, forcedCrit: true }
          : attackRoll;
        const message = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(shared) });
        io.to(roomName(campaignId)).emit('chat:new', message);
        outcomes.push({ target: targetForAttack, hit, saved: null, critical: spellAttackCritical });
      } else {
        for (const resolved of targets) {
          const saveAbility = data.dc?.dc_type?.index ?? null;
          if (!saveAbility) {
            outcomes.push({ target: resolved, hit: true, saved: null, critical: false });
            continue;
          }
          const targetCombatant = resolved.combatant ?? (
            resolved.kind === 'personaje'
              ? db
                  .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
                  .get(campaignId, resolved.character.id)
              : null
          );
          const conditions = parseConditions(targetCombatant?.conditions);
          const automaticFailure =
            ['str', 'dex'].includes(saveAbility) &&
            conditions.some((condition) => ['paralizado', 'aturdido', 'inconsciente'].includes(condition));
          const saveRoll = buildServerD20Roll({
            bonus: savingThrowBonus({ ...resolved, combatant: targetCombatant }, saveAbility),
            advantage: savingThrowAdvantage(resolved, targetCombatant, saveAbility),
            label: `Salvación de ${saveAbility.toUpperCase()} contra ${data.name}`,
            actorName: resolved.name,
          });
          const sharedSave = { ...saveRoll, kind: 'save', crit: false, fumble: false };
          const saveMessage = insertMessage({
            campaignId,
            userId: user.id,
            type: 'roll',
            body: JSON.stringify(sharedSave),
          });
          io.to(roomName(campaignId)).emit('chat:new', saveMessage);
          outcomes.push({
            target: { ...resolved, combatant: targetCombatant },
            hit: true,
            saved: !automaticFailure && saveRoll.total >= profile.saveDc,
            critical: false,
          });
        }
      }

      const hasDamage = Boolean(spellDamageNotation(data, character.level, requestedSlot));
      if (hasDamage && (!attackType || outcomes[0]?.hit)) {
        damageRoll = spellDamageComponents(data, character, requestedSlot, spellAttackCritical);
        if (damageRoll) {
          const damageMessage = insertMessage({
            campaignId,
            userId: user.id,
            type: 'roll',
            body: JSON.stringify(damageRoll.roll),
          });
          io.to(roomName(campaignId)).emit('chat:new', damageMessage);
        }
      }

      const publicOutcomes = [];
      for (const outcome of outcomes) {
        let detail = null;
        const avoidsDamage = outcome.saved && data.dc?.dc_success !== 'half';
        if (damageRoll && outcome.hit && !avoidsDamage) {
          const components = outcome.saved
            ? halfDamage(damageRoll.components)
            : damageRoll.components.map((component) => ({ ...component }));
          const applied = applyCombatDamage(
            campaignId,
            outcome.target,
            { ...damageRoll, components },
            { source: 'spell', critical: outcome.critical }
          );
          const note = insertMessage({ campaignId, userId: user.id, type: 'system', body: applied.body });
          io.to(roomName(campaignId)).emit('chat:new', note);
          detail = damageDetailForViewer(applied.detail, {
            enemy: outcome.target.kind === 'marcador',
            isDm: membership.role === 'dm',
          });
        }
        publicOutcomes.push({
          name: outcome.target.name,
          hit: outcome.hit,
          saved: outcome.saved,
          critical: outcome.critical,
          damage: detail,
        });
      }

      if (data.concentration && attackerCombatant) {
        setConcentration(campaignId, attackerCombatant.id, data.name);
      }
      const castNote = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: `${character.name} lanza ${data.name}${requestedSlot > Number(data.level) ? ` con un espacio de nivel ${requestedSlot}` : ''}.`,
      });
      io.to(roomName(campaignId)).emit('chat:new', castNote);
      if (mapId) touchMap(mapId);
      notifyCampaignMap(campaignId);
      broadcastCombat(campaignId);
      cb?.({ ok: true, outcomes: publicOutcomes });
    });

    // --- Combate en el tablero: atacar y aplicar daño -----------------

    // El cliente tira el d20 (mismos dados que el resto de la app) y el
    // servidor decide el impacto contra la CA, que el jugador nunca ve.
    socket.on('combate:atacar', ({ campaignId, characterId, target, weaponId, thrown, manualAdvantage, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const checked = validateCombatEvent({ campaignId, characterId, roll, user, membershipRole: membership.role });
      if (checked.error) return cb?.({ error: checked.error });

      const weaponData = characterWeapon(checked.character, weaponId, { thrown: Boolean(thrown) });
      if (!weaponData) return cb?.({ error: 'El arma no está equipada o ya no existe' });
      const resolved = resolveCombatTarget(campaignId, checked.character, target, { geometry: weaponData.geometry });
      if (resolved.error) return cb?.({ error: resolved.error });
      const attackerCombatant = db
        .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
        .get(campaignId, checked.character.id);
      const effects = attackEffectsFor(attackerCombatant, resolved, {
        melee: weaponData.melee,
        manualAdvantage,
      });
      const modeCheck = validateAttackMode(roll, effects);
      if (modeCheck.error) return cb?.(modeCheck);

      // Atacar (tirada + daño) es la acción del turno: se gasta aquí, ya
      // validado el objetivo, para no penalizar un intento inválido
      const actionSpend = trySpendAction(campaignId, checked.character.id);
      if (!actionSpend.ok) return cb?.({ error: actionSpend.error });

      const naturalCrit = Boolean(roll.crit);
      const hit = naturalCrit || (!roll.fumble && Number(roll.total) >= resolved.ac);
      const crit = hit && (naturalCrit || effects.autoCrit);

      const sharedRoll = crit && !naturalCrit ? { ...roll, crit: true, forcedCrit: true } : roll;
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(sharedRoll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const weapon = ` con ${weaponData.name.slice(0, 40)}`;
      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: hit
          ? `${checked.character.name} ataca a ${resolved.name}${weapon}: ¡impacta!${crit ? ' (crítico)' : ''}`
          : `${checked.character.name} ataca a ${resolved.name}${weapon}: falla.${roll.fumble ? ' (pifia)' : ''}`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      // La CA viaja solo tras resolver el ataque: es el feedback de por qué
      // impacta o falla (en la mesa real también se acaba deduciendo)
      cb?.({ ok: true, hit, crit, ac: resolved.ac, total: Number(roll.total), effects });
    });

    // Aplica el daño al objetivo: enemigos por el tracker (y si caen,
    // desaparecen del tablero y del tracker), personajes por su ficha.
    // El mensaje de sistema nunca revela el HP restante de un enemigo.
    socket.on('combate:danio', ({ campaignId, characterId, target, weaponId, components, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const checked = validateCombatEvent({ campaignId, characterId, roll, user, membershipRole: membership.role });
      if (checked.error) return cb?.({ error: checked.error });

      // Sin exigencia de adyacencia aquí: la posición se validó al atacar
      const resolved = resolveCombatTarget(campaignId, checked.character, target);
      if (resolved.error) return cb?.({ error: resolved.error });

      const weaponData = characterWeapon(checked.character, weaponId);
      if (!weaponData) return cb?.({ error: 'El arma no está equipada o ya no existe' });
      const incoming = sanitizeDamageComponents(components, roll.total, { forcedTypes: weaponData.damageTypes });
      if (incoming.error) return cb?.({ error: incoming.error });
      // El jugador no decide si un arma ignora defensas no mágicas: las
      // propiedades mecánicas salen del objeto equipado guardado en servidor.
      incoming.components = incoming.components.map((component) => ({
        ...component,
        magical: weaponData.magical,
        silvered: weaponData.silvered,
        adamantine: weaponData.adamantine,
      }));
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const { body, detail } = applyCombatDamage(campaignId, resolved, incoming, {
        source: 'attack',
        critical: Boolean(roll.crit),
      });
      broadcastCombat(campaignId);

      // Las barras de vida del tablero se refrescan en toda la mesa
      const mapId = getActiveMapId(campaignId);
      if (mapId) touchMap(mapId);
      notifyCampaignMap(campaignId);

      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body });
      io.to(roomName(campaignId)).emit('chat:new', note);
      const visibleDetail = damageDetailForViewer(detail, {
        enemy: resolved.kind === 'marcador',
        isDm: membership.role === 'dm',
      });
      cb?.({ ok: true, ...visibleDetail });
    });

    // --- Combate en el tablero: enemigo/aliado controlado por el DM ---
    // Mismo patrón que combate:atacar/combate:danio, pero el atacante es un
    // marcador (map_tokens), no un personaje: es lo que permite que un
    // enemigo controlado por el DM ataque de verdad a un PJ (antes solo se
    // podía "tirar a chat" desde la ficha del monstruo, sin aplicar daño).
    socket.on('combate:atacar-marcador', ({
      campaignId,
      tokenId,
      target,
      actionName,
      manualMelee,
      manualNormalRange,
      manualLongRange,
      manualAdvantage,
      multiattackPlanId,
      multiattackCounts,
      roll,
    }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM controla a los enemigos' });
      if (!Number.isFinite(Number(roll?.total))) return cb?.({ error: 'Tirada no válida' });
      if (JSON.stringify(roll ?? {}).length > 8000) return cb?.({ error: 'Tirada demasiado grande' });

      const attackerCombatant = db
        .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
        .get(campaignId, tokenId);
      const attackerToken = db.prepare('SELECT * FROM map_tokens WHERE id = ?').get(tokenId);
      const data = monsterData(attackerCombatant?.monster_index ?? attackerToken?.monster_index);
      const attackRows = (data?.actions ?? []).filter(
        (action) => Number.isInteger(action.attack_bonus)
      );
      const actionData = monsterAction(data, actionName);
      if (data && attackRows.length > 0 && !actionData) return cb?.({ error: 'Ataque de monstruo no válido' });
      const attackName = actionData?.name ?? 'Ataque manual';
      const plans = buildMultiattackPlans(data);
      const storedSequence = parseMultiattackState(attackerCombatant?.multiattack_state);
      const requestedPlanId =
        storedSequence.planId ??
        (typeof multiattackPlanId === 'string' && multiattackPlanId ? multiattackPlanId : null);
      const requestedPlan = plans.find((plan) => plan.id === requestedPlanId);
      const sequenceActions = storedSequence.planId ? storedSequence.remaining ?? [] : requestedPlan?.actions ?? [];
      const sequenceType = sequenceActions.find(
        (entry) => entry.actionName?.toLowerCase() === attackName.toLowerCase()
      )?.type;
      const melee =
        sequenceType === 'melee' ? true : sequenceType === 'ranged' ? false : actionData?.melee ?? Boolean(manualMelee);
      const baseGeometry = actionData?.geometry ?? {
        ranged: !melee,
        reach: melee ? 1 : 0,
        normalRange: melee ? null : Math.max(1, Math.min(200, Math.ceil((Number(manualNormalRange) || 60) / 5))),
        longRange: melee ? null : Math.max(1, Math.min(400, Math.ceil((Number(manualLongRange) || 120) / 5))),
      };
      const geometry = {
        ...baseGeometry,
        ranged: !melee,
        reach: melee ? baseGeometry.reach || 1 : 0,
        longRange:
          !melee && baseGeometry.longRange != null
            ? Math.max(baseGeometry.normalRange ?? 1, baseGeometry.longRange)
            : baseGeometry.longRange,
      };
      const resolved = resolveCombatTargetFromMarker(campaignId, tokenId, target, { geometry });
      if (resolved.error) return cb?.({ error: resolved.error });
      const effects = attackEffectsFor(attackerCombatant, resolved, { melee, manualAdvantage });
      const modeCheck = validateAttackMode(roll, effects);
      if (modeCheck.error) return cb?.(modeCheck);

      let multiattackState = {};
      let multiattackCompleted = false;
      let multiattackResolved = null;
      if (attackerCombatant) {
        const spend = trySpendMonsterAttack(campaignId, attackerCombatant.id, {
          actionName: attackName,
          planId: requestedPlanId,
          plans,
          countOverrides: multiattackCounts,
        });
        if (!spend.ok) return cb?.(spend);
        multiattackState = spend.multiattackState;
        multiattackCompleted = Boolean(spend.multiattackCompleted);
        multiattackResolved = spend.multiattackResolved;
      }

      const naturalCrit = Boolean(roll.crit);
      const hit = naturalCrit || (!roll.fumble && Number(roll.total) >= resolved.ac);
      const crit = hit && (naturalCrit || effects.autoCrit);

      const sharedRoll = crit && !naturalCrit ? { ...roll, crit: true, forcedCrit: true } : roll;
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(sharedRoll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const attackerName = attackerToken?.name ?? 'El enemigo';
      const weapon = ` con ${attackName.slice(0, 40)}`;
      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: `${
          hit
            ? `${attackerName} ataca a ${resolved.name}${weapon}: ¡impacta!${crit ? ' (crítico)' : ''}`
            : `${attackerName} ataca a ${resolved.name}${weapon}: falla.${roll.fumble ? ' (pifia)' : ''}`
        }${
          multiattackResolved?.length
            ? ` Multiataque resuelto: ${multiattackResolved
                .map((entry) => `${entry.count}× ${entry.actionName}`)
                .join(' + ')}.`
            : ''
        }`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      cb?.({
        ok: true,
        hit,
        crit,
        ac: resolved.ac,
        total: Number(roll.total),
        effects,
        multiattackState,
        multiattackCompleted,
        multiattackResolved,
      });
    });

    socket.on('combate:danio-marcador', ({ campaignId, tokenId, target, actionName, components, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM controla a los enemigos' });
      if (!Number.isFinite(Number(roll?.total))) return cb?.({ error: 'Tirada no válida' });
      if (JSON.stringify(roll ?? {}).length > 8000) return cb?.({ error: 'Tirada demasiado grande' });

      // Sin exigencia de adyacencia aquí: la posición se validó al atacar
      const resolved = resolveCombatTargetFromMarker(campaignId, tokenId, target);
      if (resolved.error) return cb?.({ error: resolved.error });

      const attackerCombatant = db
        .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
        .get(campaignId, tokenId);
      const attackerToken = db.prepare('SELECT monster_index FROM map_tokens WHERE id = ?').get(tokenId);
      const data = monsterData(attackerCombatant?.monster_index ?? attackerToken?.monster_index);
      const actionData = monsterAction(data, actionName);
      const forcedTypes = actionData?.damageTypes?.length ? actionData.damageTypes : null;
      const incoming = sanitizeDamageComponents(components, roll.total, { forcedTypes });
      if (incoming.error) return cb?.({ error: incoming.error });
      const magical = monsterUsesMagicalAttacks(data);
      incoming.components = incoming.components.map((component) => ({
        ...component,
        magical,
        silvered: false,
        adamantine: false,
      }));
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const { body, detail } = applyCombatDamage(campaignId, resolved, incoming, {
        source: 'attack',
        critical: Boolean(roll.crit),
      });
      broadcastCombat(campaignId);

      const mapId = getActiveMapId(campaignId);
      if (mapId) touchMap(mapId);
      notifyCampaignMap(campaignId);

      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body });
      io.to(roomName(campaignId)).emit('chat:new', note);
      cb?.({ ok: true, ...detail });
    });

    // Daño ambiental manual del DM. No consume una acción: el DM decide que
    // una criatura cae, el servidor tira 1d6 por cada 10 pies y reutiliza el
    // mismo núcleo de daño que ataques y monstruos (inconsciencia, botín,
    // salvaciones de muerte y fin automático del combate incluidos).
    socket.on('combate:hacer-caer', ({ campaignId, target, feet }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede resolver una caída' });

      const dice = fallDiceForFeet(feet);
      if (!dice) return cb?.({ error: 'La altura debe ser un múltiplo de 10 entre 10 y 200 pies' });

      const resolved = resolveCombatDamageTarget(campaignId, target);
      if (resolved.error) return cb?.({ error: resolved.error });

      const roll = buildFallDamageRoll({ feet, targetName: resolved.name });
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const incoming = sanitizeDamageComponents(
        [{ amount: roll.total, type: 'bludgeoning', magical: false }],
        roll.total,
        { forcedTypes: ['bludgeoning'] }
      );
      const { body, detail } = applyCombatDamage(campaignId, resolved, incoming, { source: 'fall' });
      broadcastCombat(campaignId);

      const mapId = getActiveMapId(campaignId);
      if (mapId) touchMap(mapId);
      notifyCampaignMap(campaignId);

      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: `${resolved.name} cae ${feet} pies. ${body}`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      cb?.({ ok: true, feet, dice, roll, ...detail });
    });

    // Usar un objeto del inventario en tu turno (Fase 8.6): gasta la acción,
    // igual que atacar (no hay acción adicional para objetos por ahora). No
    // resuelve ningún efecto automático (una poción de curación no cura
    // sola): solo descuenta cantidad y lo narra, como el resto de la mesa.
    socket.on('objeto:usar', ({ campaignId, characterId, itemId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });

      const character = db
        .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?')
        .get(characterId, campaignId);
      if (!character) return cb?.({ error: 'Personaje no encontrado en esta campaña' });
      if (membership.role !== 'dm' && character.user_id !== user.id) {
        return cb?.({ error: 'Solo puedes usar objetos de tu propio personaje' });
      }

      const inventory = JSON.parse(character.inventory || '[]');
      const item = inventory.find((i) => i.id === itemId);
      if (!item) return cb?.({ error: 'Objeto no encontrado en el inventario' });
      if (!item.qty || item.qty < 1) return cb?.({ error: 'No queda ninguno' });

      const actionSpend = trySpendAction(campaignId, character.id);
      if (!actionSpend.ok) return cb?.({ error: actionSpend.error });

      const nextInventory =
        item.qty <= 1
          ? inventory.filter((i) => i.id !== itemId)
          : inventory.map((i) => (i.id === itemId ? { ...i, qty: i.qty - 1 } : i));
      db.prepare("UPDATE characters SET inventory = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(nextInventory),
        character.id
      );

      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: `${character.name} usa ${item.name}.`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      cb?.({ ok: true, remainingQty: item.qty <= 1 ? 0 : item.qty - 1 });
    });

    socket.on('disconnecting', () => {
      for (const campaignId of socket.data.campaigns ?? []) {
        // La sala aún incluye este socket; recalcular tras salir
        setImmediate(() => io.to(roomName(campaignId)).emit('room:members', onlineMembers(campaignId)));
      }
    });
  });
}
