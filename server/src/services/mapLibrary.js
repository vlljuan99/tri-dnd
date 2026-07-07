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
  };
}
