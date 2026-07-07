import { db } from '../db.js';

// Consultas y serialización de la biblioteca de mapas (Fase 7.5),
// compartidas entre el editor del DM (routes/maps.js) y la vista de la mesa
// (routes/campaigns.js). La regla de seguridad vive aquí: lo que un jugador
// no debe ver (salas sin revelar, notas del DM, puertas secretas cerradas)
// se filtra en el servidor, nunca en el cliente.

export function serializeRoom(row, { forPlayer = false } = {}) {
  return {
    id: row.id,
    floorId: row.floor_id,
    name: row.name,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    backgroundUrl: row.background_url,
    disabledCells: JSON.parse(row.disabled_cells || '[]'),
    notes: forPlayer ? '' : row.notes,
    revealed: Boolean(row.revealed),
  };
}

export function serializeDoor(row) {
  return {
    id: row.id,
    fromRoomId: row.from_room_id,
    toRoomId: row.to_room_id,
    fromX: row.from_x,
    fromY: row.from_y,
    toX: row.to_x,
    toY: row.to_y,
    kind: row.kind,
    control: row.control,
    isOpen: Boolean(row.is_open),
  };
}

export function serializeToken(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    name: row.name,
    monsterIndex: row.monster_index,
    x: row.x,
    y: row.y,
    hidden: Boolean(row.hidden),
  };
}

export function getActiveMapId(campaignId) {
  return db.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId)
    ?.active_map_id;
}

export function getMap(campaignId, mapId) {
  return db.prepare('SELECT * FROM maps WHERE id = ? AND campaign_id = ?').get(mapId, campaignId);
}

export function getFloor(mapId, floorId) {
  return db.prepare('SELECT * FROM map_floors WHERE id = ? AND map_id = ?').get(floorId, mapId);
}

// Sala solo si pertenece al mapa indicado (a través de su planta)
export function getRoom(mapId, roomId) {
  return db
    .prepare(
      `SELECT r.* FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id
       WHERE r.id = ? AND f.map_id = ?`
    )
    .get(roomId, mapId);
}

// Marcador solo si pertenece al mapa indicado (sala → planta → mapa)
export function getToken(mapId, tokenId) {
  return db
    .prepare(
      `SELECT t.* FROM map_tokens t
       JOIN map_rooms r ON r.id = t.room_id
       JOIN map_floors f ON f.id = r.floor_id
       WHERE t.id = ? AND f.map_id = ?`
    )
    .get(tokenId, mapId);
}

export function touchMap(mapId) {
  db.prepare("UPDATE maps SET updated_at = datetime('now') WHERE id = ?").run(mapId);
}

export function serializeCharacterToken(row) {
  return {
    id: row.id,
    characterId: row.character_id,
    roomId: row.room_id,
    name: row.character_name,
    ownerUserId: row.user_id,
    avatarUrl: row.avatar_path,
    x: row.x,
    y: row.y,
  };
}

function loadCharacterTokens(mapId) {
  return db
    .prepare(
      `SELECT t.*, c.name AS character_name, c.user_id, c.avatar_path
       FROM map_character_tokens t JOIN characters c ON c.id = t.character_id
       WHERE t.map_id = ? ORDER BY t.id`
    )
    .all(mapId);
}

// Crea el token de los personajes de la campaña que aún no lo tienen en
// este mapa, en la primera casilla libre de la primera sala revelada.
// Se llama al servir el mapa activo: si no hay salas reveladas, el
// personaje espera fuera del tablero sin token.
export function ensureCharacterTokens(map, campaignId) {
  const characters = db
    .prepare('SELECT id FROM characters WHERE campaign_id = ?')
    .all(campaignId);
  if (!characters.length) return;

  const existing = new Set(
    db.prepare('SELECT character_id FROM map_character_tokens WHERE map_id = ?').all(map.id).map((r) => r.character_id)
  );
  const missing = characters.filter((c) => !existing.has(c.id));
  if (!missing.length) return;

  const spawnRooms = db
    .prepare(
      `SELECT r.* FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id
       WHERE f.map_id = ? AND r.revealed = 1 ORDER BY f.position, r.id`
    )
    .all(map.id);
  if (!spawnRooms.length) return;

  const occupied = new Set(
    [
      ...db.prepare('SELECT x, y FROM map_character_tokens WHERE map_id = ?').all(map.id),
      ...db
        .prepare(
          `SELECT t.x, t.y FROM map_tokens t JOIN map_rooms r ON r.id = t.room_id
           JOIN map_floors f ON f.id = r.floor_id WHERE f.map_id = ?`
        )
        .all(map.id),
    ].map((p) => `${p.x},${p.y}`)
  );

  const insert = db.prepare(
    'INSERT INTO map_character_tokens (map_id, character_id, room_id, x, y) VALUES (?, ?, ?, ?, ?)'
  );
  for (const character of missing) {
    let placed = false;
    for (const room of spawnRooms) {
      const disabled = new Set(JSON.parse(room.disabled_cells || '[]').map(([c, r]) => `${c},${r}`));
      for (let r = 0; r < room.height && !placed; r += 1) {
        for (let c = 0; c < room.width && !placed; c += 1) {
          if (disabled.has(`${c},${r}`)) continue;
          const key = `${room.x + c},${room.y + r}`;
          if (occupied.has(key)) continue;
          insert.run(map.id, character.id, room.id, room.x + c, room.y + r);
          occupied.add(key);
          placed = true;
        }
      }
      if (placed) break;
    }
  }
}

function loadMapContents(mapId) {
  const floors = db
    .prepare('SELECT * FROM map_floors WHERE map_id = ? ORDER BY position, id')
    .all(mapId);
  const rooms = db
    .prepare(
      `SELECT r.* FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id
       WHERE f.map_id = ? ORDER BY r.id`
    )
    .all(mapId);
  const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ? ORDER BY id').all(mapId);
  const tokens = db
    .prepare(
      `SELECT t.* FROM map_tokens t
       JOIN map_rooms r ON r.id = t.room_id
       JOIN map_floors f ON f.id = r.floor_id
       WHERE f.map_id = ? ORDER BY t.id`
    )
    .all(mapId);
  return { floors, rooms, doors, tokens };
}

// Vista completa del DM: todas las salas, notas, puertas y marcadores
export function serializeFullMap(map, campaignId) {
  const { floors, rooms, doors, tokens } = loadMapContents(map.id);
  return {
    id: map.id,
    name: map.name,
    gridSize: map.grid_size,
    isActive: getActiveMapId(campaignId) === map.id,
    floors: floors.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      rooms: rooms.filter((r) => r.floor_id === f.id).map((r) => serializeRoom(r)),
    })),
    doors: doors.map(serializeDoor),
    tokens: tokens.map(serializeToken),
    characterTokens: loadCharacterTokens(map.id).map(serializeCharacterToken),
  };
}

// Vista del jugador: solo salas reveladas (sin notas del DM) y las puertas
// que tocan una sala revelada, siempre que no sean de control del DM aún
// cerradas (una puerta secreta cerrada no existe para el jugador).
export function serializeMapForPlayer(map) {
  const { floors, rooms, doors, tokens } = loadMapContents(map.id);
  const revealed = new Set(rooms.filter((r) => r.revealed).map((r) => r.id));
  return {
    id: map.id,
    name: map.name,
    gridSize: map.grid_size,
    floors: floors.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      rooms: rooms
        .filter((r) => r.floor_id === f.id && revealed.has(r.id))
        .map((r) => serializeRoom(r, { forPlayer: true })),
    })),
    doors: doors
      .filter(
        (d) =>
          (revealed.has(d.from_room_id) || revealed.has(d.to_room_id)) &&
          (d.control === 'jugador' || d.is_open)
      )
      .map(serializeDoor),
    // Un marcador oculto (trampa, tesoro) no existe para el jugador aunque
    // la sala esté revelada
    tokens: tokens.filter((t) => revealed.has(t.room_id) && !t.hidden).map(serializeToken),
    characterTokens: loadCharacterTokens(map.id)
      .filter((t) => revealed.has(t.room_id))
      .map(serializeCharacterToken),
  };
}
