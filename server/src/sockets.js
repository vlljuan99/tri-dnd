// Tiempo real de la mesa de juego: chat, tiradas compartidas (incluidas las
// ocultas del DM), presencia y estado "en vivo" de la sesión.
import jwt from 'jsonwebtoken';
import { parseCookie } from 'cookie';
import { db } from './db.js';
import { JWT_SECRET, COOKIE_NAME } from './config.js';
import { getMembership } from './routes/campaigns.js';

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

    socket.on('disconnecting', () => {
      for (const campaignId of socket.data.campaigns ?? []) {
        // La sala aún incluye este socket; recalcular tras salir
        setImmediate(() => io.to(roomName(campaignId)).emit('room:members', onlineMembers(campaignId)));
      }
    });
  });
}
