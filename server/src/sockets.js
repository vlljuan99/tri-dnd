// Tiempo real de la mesa de juego: chat, tiradas compartidas (incluidas las
// ocultas del DM), presencia y estado "en vivo" de la sesión.
import jwt from 'jsonwebtoken';
import { parseCookie } from 'cookie';
import { db } from './db.js';
import { JWT_SECRET, COOKIE_NAME } from './config.js';
import { getMembership } from './routes/campaigns.js';
import { bindCombatBroadcaster } from './services/liveMap.js';

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

function orderedCombatants(campaignId) {
  return db
    .prepare('SELECT * FROM combatants WHERE campaign_id = ? ORDER BY initiative DESC, id ASC')
    .all(campaignId);
}

// Vista de un combatiente según quién la recibe: el HP/CA exacto de los
// enemigos solo llega al socket del DM, nunca al de los jugadores (mismo
// patrón que las tiradas ocultas: el filtrado ocurre en el backend).
function combatantView(row, { isDm }) {
  const base = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    initiative: row.initiative,
    characterId: row.character_id,
  };
  if (row.kind === 'pj' && row.character_id) {
    const c = db.prepare('SELECT hp_current, hp_max, ac FROM characters WHERE id = ?').get(row.character_id);
    if (c) Object.assign(base, { hpCurrent: c.hp_current, hpMax: c.hp_max, ac: c.ac });
  } else if (row.kind === 'enemigo' && isDm) {
    Object.assign(base, { hpCurrent: row.hp_current, hpMax: row.hp_max, ac: row.ac, monsterIndex: row.monster_index });
  }
  return base;
}

function combatStateFor(campaignId, isDm) {
  const table = db
    .prepare('SELECT combat_active, combat_round, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  return {
    active: Boolean(table?.combat_active),
    round: table?.combat_round ?? 1,
    turnId: table?.combat_turn_id ?? null,
    combatants: orderedCombatants(campaignId).map((r) => combatantView(r, { isDm })),
  };
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
      const init = Number.isInteger(initiative) ? initiative : 0;

      let charId = null;
      if (cleanKind === 'pj' && Number.isInteger(characterId)) {
        const char = db.prepare('SELECT id FROM characters WHERE id = ? AND campaign_id = ?').get(characterId, campaignId);
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

      db.prepare(
        'INSERT INTO combatants (campaign_id, character_id, kind, name, initiative, hp_current, hp_max, ac, monster_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(campaignId, charId, cleanKind, cleanName, init, hpC, hpM, acVal, monsterIdx);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    socket.on('combat:add-party', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede añadir al grupo' });

      const characters = db.prepare('SELECT id, name FROM characters WHERE campaign_id = ?').all(campaignId);
      const existingIds = new Set(
        db
          .prepare("SELECT character_id FROM combatants WHERE campaign_id = ? AND kind = 'pj'")
          .all(campaignId)
          .map((r) => r.character_id)
      );
      const insert = db.prepare(
        "INSERT INTO combatants (campaign_id, character_id, kind, name, initiative) VALUES (?, ?, 'pj', ?, 0)"
      );
      for (const c of characters) {
        if (!existingIds.has(c.id)) insert.run(campaignId, c.id, c.name);
      }
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

      const first = orderedCombatants(campaignId)[0];
      db.prepare(
        'UPDATE game_tables SET combat_active = 1, combat_round = 1, combat_turn_id = ? WHERE campaign_id = ?'
      ).run(first?.id ?? null, campaignId);

      const note = insertMessage({ campaignId, userId: user.id, type: 'system', body: 'El combate ha comenzado' });
      io.to(roomName(campaignId)).emit('chat:new', note);
      broadcastCombat(campaignId);
      cb?.({ ok: true });
    });

    socket.on('combat:next', ({ campaignId }, cb) => {
      const membership = getMembership(campaignId, user.id);
      if (membership?.role !== 'dm') return cb?.({ error: 'Solo el DM puede avanzar el turno' });

      const list = orderedCombatants(campaignId);
      if (list.length === 0) return cb?.({ error: 'No hay combatientes' });

      const table = db.prepare('SELECT combat_round, combat_turn_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const idx = list.findIndex((c) => c.id === table?.combat_turn_id);
      const nextIdx = idx === -1 ? 0 : (idx + 1) % list.length;
      const wrapped = idx !== -1 && nextIdx === 0;
      const nextRound = (table?.combat_round ?? 1) + (wrapped ? 1 : 0);

      db.prepare('UPDATE game_tables SET combat_turn_id = ?, combat_round = ? WHERE campaign_id = ?').run(
        list[nextIdx].id,
        nextRound,
        campaignId
      );
      broadcastCombat(campaignId);
      cb?.({ ok: true });
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

    socket.on('disconnecting', () => {
      for (const campaignId of socket.data.campaigns ?? []) {
        // La sala aún incluye este socket; recalcular tras salir
        setImmediate(() => io.to(roomName(campaignId)).emit('room:members', onlineMembers(campaignId)));
      }
    });
  });
}
