// Tiempo real de la mesa de juego: chat, tiradas compartidas (incluidas las
// ocultas del DM), presencia y estado "en vivo" de la sesión.
import jwt from 'jsonwebtoken';
import { parseCookie } from 'cookie';
import { db } from './db.js';
import { JWT_SECRET, COOKIE_NAME } from './config.js';
import { getMembership, countPlayers } from './routes/campaigns.js';
import { bindCombatBroadcaster, bindChatPoster, notifyCampaignMap, notifyCombatStarted } from './services/liveMap.js';
import { getActiveMapId, touchMap } from './services/mapLibrary.js';
import { rollLoot, dropLootMarker } from './services/loot.js';
import { buildFallDamageRoll, fallDiceForFeet } from './services/fallDamage.js';
import { buildPerceptionRoll, discoverableTrapIds } from './services/perception.js';
import { computeFloorVision } from './services/vision.js';
import {
  orderedCombatants,
  rollInitiativeValue,
  monsterSpeedFeet,
  startTurnFor,
  ensureTurnStarted,
  activateTurnMode,
  deactivateTurnMode,
  trySpendAction,
  trySpendActionForCombatant,
  tryUseBonusAction,
  tryUseReaction,
  trySpecialAction,
  toggleCondition,
  startDeathSaves,
  recordDeathSave,
  endCombatIfNoEnemiesLeft,
} from './services/turnEconomy.js';

const roomName = (campaignId) => `campaign:${campaignId}`;

function serializeMessage(row) {
  return {
    id: row.id,
    type: row.type,
    author: row.user_id ? { id: row.user_id, name: row.author_name ?? '—' } : null,
    body: row.type === 'roll' ? JSON.parse(row.body) : row.body,
    hidden: Boolean(row.hidden),
    createdAt: row.created_at,
  };
}

function insertMessage({ campaignId, userId, type, body, hidden = false }) {
  const info = db
    .prepare('INSERT INTO chat_messages (campaign_id, user_id, type, body, hidden) VALUES (?, ?, ?, ?, ?)')
    .run(campaignId, userId, type, body, hidden ? 1 : 0);
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
    characterId: row.character_id,
    movedSquares: row.moved_squares,
    actionUsed: Boolean(row.action_used),
    bonusUsed: Boolean(row.bonus_used),
    reactionAvailable: row.reaction_used_round !== round,
    dashed: Boolean(row.dashed),
    stance: row.stance ?? null,
    conditions,
  };
  if (row.kind === 'pj' && row.character_id) {
    const c = db.prepare('SELECT hp_current, hp_max, ac, speed FROM characters WHERE id = ?').get(row.character_id);
    if (c) {
      const downed = Number.isInteger(c.hp_current) && c.hp_current <= 0;
      Object.assign(base, {
        hpCurrent: c.hp_current,
        hpMax: c.hp_max,
        ac: c.ac,
        speed: c.speed,
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
      ac: row.ac,
      monsterIndex: row.monster_index,
      speed: Number.isInteger(overrides.speed) ? overrides.speed : monsterSpeedFeet(row.monster_index),
      // Variante por instancia (miniboss): el bloque de estadísticas del DM
      // aplica estos deltas a los ataques y muestra los rasgos añadidos.
      overrides,
    });
  }
  return base;
}

function combatStateFor(campaignId, isDm) {
  const table = db
    .prepare('SELECT combat_active, combat_round, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  const round = table?.combat_round ?? 1;
  return {
    active: Boolean(table?.combat_active),
    round,
    turnId: table?.combat_turn_id ?? null,
    combatants: orderedCombatants(campaignId).map((r) => combatantView(r, { isDm, round })),
  };
}

// --- Combate en el tablero -------------------------------------------------

// Localiza y valida el objetivo de un ataque en el mapa activo. La CA nunca
// viaja al cliente: el impacto se decide aquí. Devuelve { error } o
// { ac, name, kind, token, combatant?, character? }.
function resolveCombatTarget(campaignId, attackerCharacter, target, { melee }) {
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
    resolved = { ac: character.ac ?? 10, name: character.name, kind: 'personaje', token: row, character };
  } else {
    return { error: 'Objetivo no válido' };
  }

  if (resolved.token.floor_id !== attacker.floor_id) {
    return { error: 'El objetivo está en otra planta' };
  }
  const distance = Math.max(
    Math.abs(resolved.token.x - attacker.x),
    Math.abs(resolved.token.y - attacker.y)
  );
  if (melee && distance > 1) return { error: 'Demasiado lejos para atacar cuerpo a cuerpo' };
  return resolved;
}

// Igual que resolveCombatTarget, pero el ATACANTE es un marcador del DM
// (enemigo/aliado), no un personaje: se usa cuando el DM ataca a un PJ (o a
// otro marcador) con un enemigo. Comparte la resolución del objetivo con
// resolveCombatTarget salvo la posición del atacante, que aquí sale de
// map_tokens en vez de map_character_tokens.
function resolveCombatTargetFromMarker(campaignId, attackerTokenId, target, { melee }) {
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
    resolved = { ac: character.ac ?? 10, name: character.name, kind: 'personaje', token: row, character };
  } else {
    return { error: 'Objetivo no válido' };
  }

  if (resolved.token.floor_id !== attacker.floor_id) return { error: 'El objetivo está en otra planta' };
  const distance = Math.max(Math.abs(resolved.token.x - attacker.x), Math.abs(resolved.token.y - attacker.y));
  if (melee && distance > 1) return { error: 'Demasiado lejos para atacar cuerpo a cuerpo' };
  return resolved;
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

// Aplica daño ya resuelto a un objetivo (personaje o marcador), sea cual sea
// quien ataca (un PJ o un enemigo controlado por el DM): la resolución del
// objetivo puede venir de cualquiera de los dos caminos de arriba, pero
// aplicar el daño es exactamente lo mismo. Devuelve el mensaje de sistema a
// narrar y el detalle para quien preguntó (remainingHp, maxHp, defeated).
function applyCombatDamage(campaignId, resolved, damage) {
  let body;
  const detail = { damage, remainingHp: null, maxHp: null, defeated: false };

  if (resolved.kind === 'marcador') {
    const combatant = resolved.combatant;
    if (combatant && Number.isInteger(combatant.hp_current)) {
      const newHp = combatant.hp_current - damage;
      detail.maxHp = combatant.hp_max ?? null;
      if (newHp <= 0) {
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
        body = `${resolved.name} recibe ${damage} puntos de daño y cae derrotado.`;
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
        db.prepare('UPDATE combatants SET hp_current = ? WHERE id = ?').run(newHp, combatant.id);
        detail.remainingHp = newHp;
        body = `${resolved.name} recibe ${damage} puntos de daño.`;
      }
    } else {
      // Sin ficha en el tracker (p. ej. un aliado): solo se narra
      body = `${resolved.name} recibe ${damage} puntos de daño.`;
    }
  } else {
    const prevHp = resolved.character.hp_current ?? 0;
    const newHp = Math.max(-99, prevHp - damage);
    db.prepare("UPDATE characters SET hp_current = ?, updated_at = datetime('now') WHERE id = ?").run(
      newHp,
      resolved.character.id
    );
    detail.remainingHp = newHp;
    detail.maxHp = resolved.character.hp_max ?? null;
    detail.defeated = newHp <= 0;

    // Salvaciones de muerte: al caer por primera vez, empieza a agonizar
    // (0/0). Si ya estaba a 0 y recibe más daño, cuenta como un fallo de
    // salvación (dos y muere directamente serían un crítico; no se modela).
    const pjCombatant = db
      .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(campaignId, resolved.character.id);
    if (newHp <= 0) {
      if (prevHp > 0) {
        if (pjCombatant) startDeathSaves(pjCombatant.id);
        body = `${resolved.name} recibe ${damage} puntos de daño y cae inconsciente.`;
      } else if (pjCombatant) {
        const failures = Math.min(3, pjCombatant.death_failures + 1);
        db.prepare('UPDATE combatants SET death_failures = ? WHERE id = ?').run(failures, pjCombatant.id);
        body =
          failures >= 3
            ? `${resolved.name} recibe daño estando inconsciente y muere.`
            : `${resolved.name} recibe daño estando inconsciente: falla una salvación de muerte (${failures}/3).`;
      } else {
        body = `${resolved.name} recibe ${damage} puntos de daño y cae inconsciente.`;
      }
    } else {
      body = `${resolved.name} recibe ${damage} puntos de daño.`;
    }
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
      s.emit('combat:state', combatStateFor(campaignId, membership.role === 'dm'));
    }
  }
  // Las rutas HTTP del mapa también meten enemigos en el tracker al
  // revelarse una sala
  bindCombatBroadcaster(broadcastCombat);

  // Los eventos con disparador (Fase 19) publican mensajes de sistema desde
  // los servicios: firmados por el DM de la campaña y, si el evento es
  // oculto, filtrados igual que una tirada oculta (solo DM/autor los reciben)
  bindChatPoster((campaignId, { body, hidden, userId }) => {
    const dmUserId =
      userId ?? db.prepare('SELECT dm_user_id FROM campaigns WHERE id = ?').get(campaignId)?.dm_user_id;
    if (!dmUserId) return;
    const message = insertMessage({ campaignId, userId: dmUserId, type: 'system', body, hidden });
    broadcastMessage(campaignId, message, { senderId: dmUserId, dmUserId });
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
        combat: combatStateFor(campaignId, membership.role === 'dm'),
      });
    });

    socket.on('room:leave', ({ campaignId }) => {
      socket.leave(roomName(campaignId));
      socket.data.campaigns?.delete(Number(campaignId));
      io.to(roomName(campaignId)).emit('room:members', onlineMembers(campaignId));
    });

    socket.on('chat:send', ({ campaignId, text }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const clean = typeof text === 'string' ? text.trim().slice(0, 2000) : '';
      if (!clean) return cb?.({ error: 'Mensaje vacío' });

      const message = insertMessage({ campaignId, userId: user.id, type: 'chat', body: clean });
      io.to(roomName(campaignId)).emit('chat:new', message);
      cb?.({ ok: true });
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
      const init = Number.isInteger(initiative)
        ? initiative
        : rollInitiativeValue({ kind: cleanKind, character_id: charId, monster_index: monsterIdx });

      db.prepare(
        'INSERT INTO combatants (campaign_id, character_id, kind, name, initiative, hp_current, hp_max, ac, monster_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(campaignId, charId, cleanKind, cleanName, init, hpC, hpM, acVal, monsterIdx);
      ensureTurnStarted(campaignId);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
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
        "INSERT INTO combatants (campaign_id, character_id, kind, name, initiative) VALUES (?, ?, 'pj', ?, ?)"
      );
      for (const c of characters) {
        if (!existingIds.has(c.id)) {
          insert.run(campaignId, c.id, c.name, rollInitiativeValue({ kind: 'pj', character_id: c.id }));
        }
      }
      ensureTurnStarted(campaignId);
      broadcastCombat(campaignId);
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
      db.prepare('UPDATE combatants SET initiative = ? WHERE id = ?').run(init, row.id);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    socket.on('combat:update', ({ campaignId, combatantId, name, hpCurrent, hpMax, ac }, cb) => {
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

    socket.on('combat:start', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede iniciar el combate' });

      // Arranque fresco: tira iniciativa para todos los presentes y resetea
      // sus recursos, aunque ya llevaran un rato en el tracker
      activateTurnMode(campaignId);
      // Primero el estado (para que el cartel ya tenga el orden), luego el
      // aviso: cartel a pantalla + mensaje de chat, igual que el automático
      broadcastCombat(campaignId);
      notifyCombatStarted(campaignId);
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
    // (solo en tu turno) o la reacción (una por ronda, utilizable fuera de
    // tu turno cuando el DM narra que corresponde — sin detección automática).
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
    // movimiento), Esquivar o Destrabarse (posturas informativas). La puede
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
    socket.on('combat:toggle-mode', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede cambiar el modo de la mesa' });

      const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const turningOn = !table?.combat_active;

      let body;
      if (turningOn) {
        activateTurnMode(campaignId);
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
      cb?.({ ok: true, active: turningOn });
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

    // --- Combate en el tablero: atacar y aplicar daño -----------------

    // El cliente tira el d20 (mismos dados que el resto de la app) y el
    // servidor decide el impacto contra la CA, que el jugador nunca ve.
    socket.on('combate:atacar', ({ campaignId, characterId, target, weaponName, melee, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const checked = validateCombatEvent({ campaignId, characterId, roll, user, membershipRole: membership.role });
      if (checked.error) return cb?.({ error: checked.error });

      const resolved = resolveCombatTarget(campaignId, checked.character, target, { melee: Boolean(melee) });
      if (resolved.error) return cb?.({ error: resolved.error });

      // Atacar (tirada + daño) es la acción del turno: se gasta aquí, ya
      // validado el objetivo, para no penalizar un intento inválido
      const actionSpend = trySpendAction(campaignId, checked.character.id);
      if (!actionSpend.ok) return cb?.({ error: actionSpend.error });

      const crit = Boolean(roll.crit);
      const hit = crit || (!roll.fumble && Number(roll.total) >= resolved.ac);

      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const weapon =
        typeof weaponName === 'string' && weaponName.trim() ? ` con ${weaponName.trim().slice(0, 40)}` : '';
      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: hit
          ? `${checked.character.name} ataca a ${resolved.name}${weapon}: ¡impacta!${crit ? ' (crítico)' : ''}`
          : `${checked.character.name} ataca a ${resolved.name}${weapon}: falla.${roll.fumble ? ' (pifia)' : ''}`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      // La CA viaja solo tras resolver el ataque: es el feedback de por qué
      // impacta o falla (en la mesa real también se acaba deduciendo)
      cb?.({ ok: true, hit, crit, ac: resolved.ac, total: Number(roll.total) });
    });

    // Aplica el daño al objetivo: enemigos por el tracker (y si caen,
    // desaparecen del tablero y del tracker), personajes por su ficha.
    // El mensaje de sistema nunca revela el HP restante de un enemigo.
    socket.on('combate:danio', ({ campaignId, characterId, target, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (!membership) return cb?.({ error: 'No perteneces a esta campaña' });
      const checked = validateCombatEvent({ campaignId, characterId, roll, user, membershipRole: membership.role });
      if (checked.error) return cb?.({ error: checked.error });

      // Sin exigencia de adyacencia aquí: la posición se validó al atacar
      const resolved = resolveCombatTarget(campaignId, checked.character, target, { melee: false });
      if (resolved.error) return cb?.({ error: resolved.error });

      const damage = Math.max(0, Math.min(999, Math.round(Number(roll.total)) || 0));
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const { body, detail } = applyCombatDamage(campaignId, resolved, damage);
      broadcastCombat(campaignId);

      // Las barras de vida del tablero se refrescan en toda la mesa
      const mapId = getActiveMapId(campaignId);
      if (mapId) touchMap(mapId);
      notifyCampaignMap(campaignId);

      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body });
      io.to(roomName(campaignId)).emit('chat:new', note);
      cb?.({ ok: true, ...detail });
    });

    // --- Combate en el tablero: enemigo/aliado controlado por el DM ---
    // Mismo patrón que combate:atacar/combate:danio, pero el atacante es un
    // marcador (map_tokens), no un personaje: es lo que permite que un
    // enemigo controlado por el DM ataque de verdad a un PJ (antes solo se
    // podía "tirar a chat" desde la ficha del monstruo, sin aplicar daño).
    socket.on('combate:atacar-marcador', ({ campaignId, tokenId, target, weaponName, melee, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM controla a los enemigos' });
      if (!Number.isFinite(Number(roll?.total))) return cb?.({ error: 'Tirada no válida' });
      if (JSON.stringify(roll ?? {}).length > 8000) return cb?.({ error: 'Tirada demasiado grande' });

      const resolved = resolveCombatTargetFromMarker(campaignId, tokenId, target, { melee: Boolean(melee) });
      if (resolved.error) return cb?.({ error: resolved.error });

      // Atacar (tirada + daño) es la acción del turno del combatiente, si
      // está en el tracker y el modo por turnos está activo (igual que un PJ)
      const attackerCombatant = db
        .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
        .get(campaignId, tokenId);
      if (attackerCombatant) {
        const spend = trySpendActionForCombatant(campaignId, attackerCombatant.id);
        if (!spend.ok) return cb?.(spend);
      }

      const crit = Boolean(roll.crit);
      const hit = crit || (!roll.fumble && Number(roll.total) >= resolved.ac);

      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const attackerToken = db.prepare('SELECT name FROM map_tokens WHERE id = ?').get(tokenId);
      const attackerName = attackerToken?.name ?? 'El enemigo';
      const weapon =
        typeof weaponName === 'string' && weaponName.trim() ? ` con ${weaponName.trim().slice(0, 40)}` : '';
      const note = insertMessage({
        campaignId,
        userId: user.id,
        type: 'system',
        body: hit
          ? `${attackerName} ataca a ${resolved.name}${weapon}: ¡impacta!${crit ? ' (crítico)' : ''}`
          : `${attackerName} ataca a ${resolved.name}${weapon}: falla.${roll.fumble ? ' (pifia)' : ''}`,
      });
      io.to(roomName(campaignId)).emit('chat:new', note);
      cb?.({ ok: true, hit, crit, ac: resolved.ac, total: Number(roll.total) });
    });

    socket.on('combate:danio-marcador', ({ campaignId, tokenId, target, roll }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM controla a los enemigos' });
      if (!Number.isFinite(Number(roll?.total))) return cb?.({ error: 'Tirada no válida' });
      if (JSON.stringify(roll ?? {}).length > 8000) return cb?.({ error: 'Tirada demasiado grande' });

      // Sin exigencia de adyacencia aquí: la posición se validó al atacar
      const resolved = resolveCombatTargetFromMarker(campaignId, tokenId, target, { melee: false });
      if (resolved.error) return cb?.({ error: resolved.error });

      const damage = Math.max(0, Math.min(999, Math.round(Number(roll.total)) || 0));
      const rollMessage = insertMessage({ campaignId, userId: user.id, type: 'roll', body: JSON.stringify(roll) });
      io.to(roomName(campaignId)).emit('chat:new', rollMessage);

      const { body, detail } = applyCombatDamage(campaignId, resolved, damage);
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

      const { body, detail } = applyCombatDamage(campaignId, resolved, roll.total);
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
