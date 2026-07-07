import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  getActiveMapId,
  getMap,
  serializeFullMap,
  serializeMapForPlayer,
  ensureCharacterTokens,
  spawnRoomEnemies,
  touchMap,
} from '../services/mapLibrary.js';
import { notifyCampaignMap, notifyCombat } from '../services/liveMap.js';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

// Código de invitación legible, sin caracteres ambiguos (0/O, 1/I/L)
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!db.prepare('SELECT 1 FROM campaigns WHERE invite_code = ?').get(code)) return code;
  }
}

export function getMembership(campaignId, userId) {
  return db
    .prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .get(campaignId, userId);
}

function serializeCampaign(row, role) {
  const table = db.prepare('SELECT is_live FROM game_tables WHERE campaign_id = ?').get(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scene: row.scene,
    inviteCode: row.invite_code,
    dmUserId: row.dm_user_id,
    role,
    isLive: Boolean(table?.is_live),
  };
}

campaignsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, m.role FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id
       WHERE m.user_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.user.id);
  res.json({ campaigns: rows.map((r) => serializeCampaign(r, r.role)) });
});

campaignsRouter.post('/', (req, res) => {
  const { name, description } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'La campaña necesita un nombre' });
  }
  const create = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO campaigns (name, description, dm_user_id, invite_code) VALUES (?, ?, ?, ?)')
      .run(
        name.trim().slice(0, 80),
        typeof description === 'string' ? description.slice(0, 2000) : '',
        req.user.id,
        generateInviteCode()
      );
    const id = info.lastInsertRowid;
    db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'dm')").run(id, req.user.id);
    // combat_active nace en 1: el modo por turnos está activo por defecto
    // en toda mesa nueva (Fase 8.5); el DM lo alterna a modo libre cuando quiera.
    db.prepare('INSERT INTO game_tables (campaign_id, combat_active) VALUES (?, 1)').run(id);
    return id;
  });
  const id = create();
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  res.status(201).json({ campaign: serializeCampaign(row, 'dm') });
});

campaignsRouter.post('/join', (req, res) => {
  const { code } = req.body ?? {};
  const row =
    typeof code === 'string'
      ? db.prepare('SELECT * FROM campaigns WHERE invite_code = ?').get(code.trim().toUpperCase())
      : undefined;
  if (!row) return res.status(404).json({ error: 'Código de invitación no válido' });

  const existing = getMembership(row.id, req.user.id);
  if (existing) return res.json({ campaign: serializeCampaign(row, existing.role) });

  db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'jugador')").run(
    row.id,
    req.user.id
  );
  res.status(201).json({ campaign: serializeCampaign(row, 'jugador') });
});

campaignsRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  const membership = getMembership(row.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });

  const members = db
    .prepare(
      `SELECT u.id, u.display_name AS displayName, m.role FROM campaign_members m
       JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ? ORDER BY m.joined_at`
    )
    .all(row.id);
  const characters = db
    .prepare(
      `SELECT id, user_id, name, class_index, race_index, level, hp_current, hp_max, ac, avatar_path AS avatarUrl
       FROM characters WHERE campaign_id = ?`
    )
    .all(row.id);

  res.json({ campaign: serializeCampaign(row, membership.role), members, characters });
});

// Borrar una campaña entera (solo su DM). Las fichas de personaje no se
// pierden: characters.campaign_id pasa a NULL; el resto (mesa, chat,
// combatientes, mapas) cae en cascada.
campaignsRouter.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el DM puede borrar la campaña' });
  }

  db.transaction(() => {
    // active_map_id no tiene ON DELETE: se limpia antes de que caigan los mapas
    db.prepare('UPDATE game_tables SET active_map_id = NULL WHERE campaign_id = ?').run(row.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(row.id);
  })();
  res.json({ ok: true });
});

// Mapa activo de la mesa, filtrado según el rol: el DM lo ve entero; el
// jugador solo las salas reveladas y las puertas visibles (filtrado en el
// servidor, como las tiradas ocultas).
campaignsRouter.get('/:id/mapa-activo', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });

  const activeMapId = getActiveMapId(req.params.id);
  const map = activeMapId ? getMap(req.params.id, activeMapId) : null;
  if (!map) return res.json({ map: null });

  // Los personajes sin token aparecen en la primera sala revelada libre
  ensureCharacterTokens(map, req.params.id);

  // El DM puede pedir la vista de los jugadores (?vista=jugador) para
  // comprobar qué está viendo el grupo realmente
  const asPlayer = membership.role === 'dm' && req.query.vista === 'jugador';
  res.json({
    map:
      membership.role === 'dm' && !asPlayer
        ? serializeFullMap(map, req.params.id)
        : serializeMapForPlayer(map, asPlayer ? null : req.user.id),
  });
});

// Mover el token de un personaje en el mapa activo: el dueño del personaje
// o el DM. La casilla de destino debe ser una casilla activa de una sala de
// la misma planta; el jugador además solo puede pisar salas reveladas.
campaignsRouter.post('/:id/mapa-activo/personajes/:characterId/mover', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  const isDm = membership.role === 'dm';

  const character = db
    .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?')
    .get(req.params.characterId, req.params.id);
  if (!character) return res.status(404).json({ error: 'Personaje no encontrado en esta campaña' });
  if (!isDm && character.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo puedes mover tu propio personaje' });
  }

  const activeMapId = getActiveMapId(req.params.id);
  const token = activeMapId
    ? db
        .prepare('SELECT * FROM map_character_tokens WHERE map_id = ? AND character_id = ?')
        .get(activeMapId, character.id)
    : undefined;
  if (!token) return res.status(404).json({ error: 'El personaje aún no está en el tablero' });

  const { x, y } = req.body ?? {};
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: 'Casilla de destino no válida' });
  }

  const currentRoom = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(token.room_id);
  const targetRoom = db
    .prepare(
      `SELECT r.* FROM map_rooms r WHERE r.floor_id = ?
         AND ? >= r.x AND ? < r.x + r.width AND ? >= r.y AND ? < r.y + r.height`
    )
    .all(currentRoom.floor_id, x, x, y, y)
    .find(
      (r) =>
        ![
          ...JSON.parse(r.disabled_cells || '[]'),
          ...JSON.parse(r.obstacle_cells || '[]'),
        ].some(([c, w]) => c === x - r.x && w === y - r.y)
    );
  if (!targetRoom) {
    return res.status(400).json({ error: 'Ahí no hay suelo que pisar' });
  }
  // El jugador solo pisa salas reveladas, salvo la que ya ocupa su token
  // (p. ej. si el DM lo colocó en una sala aún sin revelar)
  if (!isDm && !targetRoom.revealed && targetRoom.id !== token.room_id) {
    return res.status(400).json({ error: 'No puedes entrar en una zona sin descubrir' });
  }

  // ¿La casilla de destino es el umbral de una puerta? Pisarla la cruza:
  // si está cerrada y puede abrirse (control jugador, o cualquier puerta si
  // eres DM), se abre revelando ambos lados, y el token aparece en el otro
  // extremo — también entre plantas con escaleras y portales.
  const door = db
    .prepare(
      `SELECT * FROM map_doors WHERE map_id = ? AND (
         (from_room_id = ? AND from_x = ? AND from_y = ?) OR
         (to_room_id = ? AND to_x = ? AND to_y = ?))`
    )
    .get(activeMapId, targetRoom.id, x, y, targetRoom.id, x, y);

  let finalRoomId = targetRoom.id;
  let finalX = x;
  let finalY = y;
  let newlyRevealed = [];
  if (door && (door.is_open || isDm || door.control === 'jugador')) {
    if (!door.is_open) {
      newlyRevealed = db
        .prepare('SELECT id FROM map_rooms WHERE id IN (?, ?) AND revealed = 0')
        .all(door.from_room_id, door.to_room_id)
        .map((r) => r.id);
      db.prepare('UPDATE map_doors SET is_open = 1 WHERE id = ?').run(door.id);
      db.prepare('UPDATE map_rooms SET revealed = 1 WHERE id IN (?, ?)').run(
        door.from_room_id,
        door.to_room_id
      );
    }
    const isFromSide =
      door.from_room_id === targetRoom.id && door.from_x === x && door.from_y === y;
    finalRoomId = isFromSide ? door.to_room_id : door.from_room_id;
    finalX = isFromSide ? door.to_x : door.from_x;
    finalY = isFromSide ? door.to_y : door.from_y;
  }

  db.prepare('UPDATE map_character_tokens SET room_id = ?, x = ?, y = ? WHERE id = ?').run(
    finalRoomId,
    finalX,
    finalY,
    token.id
  );
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  if (newlyRevealed.length && spawnRoomEnemies(req.params.id, newlyRevealed) > 0) {
    notifyCombat(req.params.id);
  }
  res.json({ ok: true });
});

// Abrir (o cerrar, solo el DM) una puerta del mapa activo desde la mesa.
// Abrirla revela las salas de ambos lados: así se descubre el tablero de
// detrás al entrar por una puerta. El jugador solo puede abrir puertas de
// control 'jugador' que tocan una sala ya revelada; las del DM (llave,
// secretas) ni siquiera le llegan al socket mientras estén cerradas.
campaignsRouter.post('/:id/puertas/:doorId/abrir', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  const isDm = membership.role === 'dm';
  const open = req.body?.open !== false;

  const activeMapId = getActiveMapId(req.params.id);
  const door = activeMapId
    ? db.prepare('SELECT * FROM map_doors WHERE id = ? AND map_id = ?').get(req.params.doorId, activeMapId)
    : undefined;
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada en el mapa activo' });

  if (!isDm) {
    if (!open) return res.status(403).json({ error: 'Solo el DM puede cerrar puertas' });
    if (door.control !== 'jugador') {
      return res.status(403).json({ error: 'La puerta no cede: está cerrada con llave o atrancada' });
    }
    const revealedSides = db
      .prepare('SELECT COUNT(*) AS n FROM map_rooms WHERE id IN (?, ?) AND revealed = 1')
      .get(door.from_room_id, door.to_room_id).n;
    if (revealedSides === 0) return res.status(403).json({ error: 'No ves ninguna puerta ahí' });
  }

  // Salas que se van a revelar ahora: sus enemigos entrarán al tracker
  const newlyRevealed = open
    ? db
        .prepare('SELECT id FROM map_rooms WHERE id IN (?, ?) AND revealed = 0')
        .all(door.from_room_id, door.to_room_id)
        .map((r) => r.id)
    : [];

  db.transaction(() => {
    db.prepare('UPDATE map_doors SET is_open = ? WHERE id = ?').run(open ? 1 : 0, door.id);
    if (open) {
      db.prepare('UPDATE map_rooms SET revealed = 1 WHERE id IN (?, ?)').run(
        door.from_room_id,
        door.to_room_id
      );
    }
  })();
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  if (newlyRevealed.length && spawnRoomEnemies(req.params.id, newlyRevealed) > 0) {
    notifyCombat(req.params.id);
  }

  const map = getMap(req.params.id, activeMapId);
  res.json({
    map: isDm ? serializeFullMap(map, req.params.id) : serializeMapForPlayer(map, req.user.id),
  });
});

