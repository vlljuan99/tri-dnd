import { Router, raw as expressRaw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getMembership } from './campaigns.js';
import { MAP_UPLOADS_DIR } from '../config.js';
import { generateMapImage } from '../services/mapImageGeneration.js';
import { extensionForMimeType } from '../utils/uploads.js';
import {
  getActiveMapId,
  getMap,
  getFloor,
  getRoom,
  touchMap,
  serializeRoom,
  serializeDoor,
  serializeFullMap,
} from '../services/mapLibrary.js';

// Biblioteca de mapas del editor de campaña (Fase 7.5). Solo el DM pasa por
// aquí, incluso en lectura: los jugadores reciben el mapa activo ya filtrado
// (salas reveladas) por /api/campaigns/:id/mapa-activo, nunca por esta API.
export const mapsRouter = Router({ mergeParams: true });
mapsRouter.use(requireAuth);

mapsRouter.use((req, res, next) => {
  const membership = getMembership(req.params.campaignId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  if (membership.role !== 'dm') {
    return res.status(403).json({ error: 'Solo el DM puede gestionar los mapas de la campaña' });
  }
  next();
});

const ROOM_MAX_SIDE = 100;
const ROOM_COORD_LIMIT = 1000;

// Misma validación de forma que la sala única de v7: pares [col, fila]
// enteros no negativos relativos al origen de la sala.
function isValidDisabledCells(value) {
  return (
    Array.isArray(value) &&
    value.length <= 4000 &&
    value.every(
      (cell) =>
        Array.isArray(cell) &&
        cell.length === 2 &&
        cell.every((n) => Number.isInteger(n) && n >= 0)
    )
  );
}

function isValidSide(n) {
  return Number.isInteger(n) && n >= 1 && n <= ROOM_MAX_SIDE;
}

function isValidCoord(n) {
  return Number.isInteger(n) && Math.abs(n) <= ROOM_COORD_LIMIT;
}

// La casilla (x, y) del lienzo de la planta cae dentro de la sala y no está
// desactivada por su forma
function cellInsideRoom(room, x, y) {
  if (x < room.x || x >= room.x + room.width || y < room.y || y >= room.y + room.height) {
    return false;
  }
  const disabled = JSON.parse(room.disabled_cells || '[]');
  return !disabled.some(([col, row]) => col === x - room.x && row === y - room.y);
}

// ---- Mapas ----

mapsRouter.get('/', (req, res) => {
  const activeMapId = getActiveMapId(req.params.campaignId);
  const rows = db
    .prepare(
      `SELECT m.*,
         (SELECT COUNT(*) FROM map_floors f WHERE f.map_id = m.id) AS floor_count,
         (SELECT COUNT(*) FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id WHERE f.map_id = m.id) AS room_count
       FROM maps m WHERE m.campaign_id = ? ORDER BY m.created_at DESC, m.id DESC`
    )
    .all(req.params.campaignId);
  res.json({
    maps: rows.map((m) => ({
      id: m.id,
      name: m.name,
      gridSize: m.grid_size,
      isActive: m.id === activeMapId,
      floorCount: m.floor_count,
      roomCount: m.room_count,
      updatedAt: m.updated_at,
    })),
  });
});

mapsRouter.post('/', (req, res) => {
  const { name } = req.body ?? {};
  const cleanName =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Mapa sin título';
  const create = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO maps (campaign_id, name) VALUES (?, ?)')
      .run(req.params.campaignId, cleanName);
    db.prepare("INSERT INTO map_floors (map_id, name, position) VALUES (?, 'Planta 1', 0)").run(
      info.lastInsertRowid
    );
    return info.lastInsertRowid;
  });
  const map = getMap(req.params.campaignId, create());
  res.status(201).json({ map: serializeFullMap(map, req.params.campaignId) });
});

mapsRouter.get('/:mapId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });
  res.json({ map: serializeFullMap(map, req.params.campaignId) });
});

mapsRouter.patch('/:mapId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  const { name, gridSize } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'El mapa necesita un nombre' });
  }
  if (gridSize !== undefined && (!Number.isFinite(gridSize) || gridSize <= 0 || gridSize > 10)) {
    return res.status(400).json({ error: 'Tamaño de casilla no válido' });
  }

  db.prepare(
    "UPDATE maps SET name = COALESCE(?, name), grid_size = COALESCE(?, grid_size), updated_at = datetime('now') WHERE id = ?"
  ).run(name !== undefined ? name.trim().slice(0, 80) : null, gridSize ?? null, map.id);

  res.json({ map: serializeFullMap(getMap(req.params.campaignId, map.id), req.params.campaignId) });
});

// Borrar un mapa; si era el activo, la mesa se queda sin mapa hasta activar otro
mapsRouter.delete('/:mapId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  db.transaction(() => {
    db.prepare(
      "UPDATE game_tables SET active_map_id = NULL, updated_at = datetime('now') WHERE campaign_id = ? AND active_map_id = ?"
    ).run(req.params.campaignId, map.id);
    db.prepare('DELETE FROM maps WHERE id = ?').run(map.id);
  })();
  res.json({ ok: true });
});

// Activa este mapa como el de la mesa en vivo de la campaña
mapsRouter.post('/:mapId/activar', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });
  db.prepare(
    "UPDATE game_tables SET active_map_id = ?, updated_at = datetime('now') WHERE campaign_id = ?"
  ).run(map.id, req.params.campaignId);
  res.json({ map: serializeFullMap(map, req.params.campaignId) });
});

// ---- Plantas ----

mapsRouter.post('/:mapId/plantas', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  const { name } = req.body ?? {};
  const position =
    (db.prepare('SELECT MAX(position) AS p FROM map_floors WHERE map_id = ?').get(map.id).p ?? -1) + 1;
  const cleanName =
    typeof name === 'string' && name.trim()
      ? name.trim().slice(0, 80)
      : `Planta ${position + 1}`;

  db.prepare('INSERT INTO map_floors (map_id, name, position) VALUES (?, ?, ?)').run(
    map.id,
    cleanName,
    position
  );
  touchMap(map.id);
  res.status(201).json({ map: serializeFullMap(map, req.params.campaignId) });
});

mapsRouter.patch('/:mapId/plantas/:floorId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const floor = map && getFloor(map.id, req.params.floorId);
  if (!floor) return res.status(404).json({ error: 'Planta no encontrada' });

  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'La planta necesita un nombre' });
  }
  db.prepare('UPDATE map_floors SET name = ? WHERE id = ?').run(name.trim().slice(0, 80), floor.id);
  touchMap(map.id);
  res.json({ map: serializeFullMap(map, req.params.campaignId) });
});

mapsRouter.delete('/:mapId/plantas/:floorId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const floor = map && getFloor(map.id, req.params.floorId);
  if (!floor) return res.status(404).json({ error: 'Planta no encontrada' });

  const count = db.prepare('SELECT COUNT(*) AS n FROM map_floors WHERE map_id = ?').get(map.id).n;
  if (count <= 1) {
    return res.status(409).json({ error: 'El mapa necesita al menos una planta' });
  }
  // Borra en cascada sus salas y las puertas que tocaban esas salas
  db.prepare('DELETE FROM map_floors WHERE id = ?').run(floor.id);
  touchMap(map.id);
  res.json({ map: serializeFullMap(map, req.params.campaignId) });
});

// ---- Salas ----

// Crear una sala NxM en una planta. x/y es el origen en casillas del lienzo
// de la planta; width/height el tamaño en casillas.
mapsRouter.post('/:mapId/plantas/:floorId/salas', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const floor = map && getFloor(map.id, req.params.floorId);
  if (!floor) return res.status(404).json({ error: 'Planta no encontrada' });

  const { name, x = 0, y = 0, width, height } = req.body ?? {};
  if (!isValidSide(width) || !isValidSide(height)) {
    return res
      .status(400)
      .json({ error: `La sala necesita ancho y alto enteros entre 1 y ${ROOM_MAX_SIDE} casillas` });
  }
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'Posición de la sala no válida' });
  }
  const cleanName =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Sala sin nombre';

  const info = db
    .prepare('INSERT INTO map_rooms (floor_id, name, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?)')
    .run(floor.id, cleanName, x, y, width, height);
  touchMap(map.id);

  const room = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ room: serializeRoom(room) });
});

mapsRouter.patch('/:mapId/salas/:roomId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const { name, x, y, width, height, disabledCells, notes, revealed } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'La sala necesita un nombre' });
  }
  if ((width !== undefined && !isValidSide(width)) || (height !== undefined && !isValidSide(height))) {
    return res
      .status(400)
      .json({ error: `El ancho y el alto deben ser enteros entre 1 y ${ROOM_MAX_SIDE} casillas` });
  }
  if ((x !== undefined && !isValidCoord(x)) || (y !== undefined && !isValidCoord(y))) {
    return res.status(400).json({ error: 'Posición de la sala no válida' });
  }
  if (disabledCells !== undefined && !isValidDisabledCells(disabledCells)) {
    return res.status(400).json({ error: 'Lista de casillas no válida' });
  }
  if (notes !== undefined && typeof notes !== 'string') {
    return res.status(400).json({ error: 'Las notas deben ser texto' });
  }

  const nextWidth = width ?? room.width;
  const nextHeight = height ?? room.height;
  // Al encoger la sala, las casillas desactivadas que quedan fuera se descartan
  const nextDisabled = (disabledCells ?? JSON.parse(room.disabled_cells || '[]')).filter(
    ([col, row]) => col < nextWidth && row < nextHeight
  );

  db.prepare(
    `UPDATE map_rooms SET name = ?, x = ?, y = ?, width = ?, height = ?,
       disabled_cells = ?, notes = ?, revealed = ? WHERE id = ?`
  ).run(
    name !== undefined ? name.trim().slice(0, 80) : room.name,
    x ?? room.x,
    y ?? room.y,
    nextWidth,
    nextHeight,
    JSON.stringify(nextDisabled),
    notes ?? room.notes,
    revealed !== undefined ? Number(Boolean(revealed)) : room.revealed,
    room.id
  );
  touchMap(map.id);

  const updated = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(room.id);
  res.json({ room: serializeRoom(updated) });
});

mapsRouter.delete('/:mapId/salas/:roomId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  // Las puertas que tocaban esta sala caen en cascada (FK)
  db.prepare('DELETE FROM map_rooms WHERE id = ?').run(room.id);
  touchMap(map.id);
  res.json({ ok: true });
});

// ---- Imagen de fondo por sala ----

function saveRoomBackground(map, room, buffer, extension, res) {
  const filename = `map-${map.id}-room-${room.id}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(MAP_UPLOADS_DIR, filename), buffer);
  db.prepare('UPDATE map_rooms SET background_url = ? WHERE id = ?').run(
    `/uploads/maps/${filename}`,
    room.id
  );
  touchMap(map.id);
  const updated = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(room.id);
  res.json({ room: serializeRoom(updated) });
}

// Subida de una imagen propia como suelo de la sala (binario crudo, como la
// subida de mapa de la fase 7)
mapsRouter.patch(
  '/:mapId/salas/:roomId/imagen',
  expressRaw({ type: () => true, limit: '15mb' }),
  (req, res) => {
    const map = getMap(req.params.campaignId, req.params.mapId);
    const room = map && getRoom(map.id, req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'El archivo debe ser una imagen' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }
    saveRoomBackground(map, room, req.body, extensionForMimeType(contentType), res);
  }
);

mapsRouter.post('/:mapId/salas/:roomId/imagen/generar', async (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const { prompt, provider } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 600) : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Describe la sala que quieres generar' });

  try {
    const generated = await generateMapImage(provider, cleanPrompt);
    saveRoomBackground(map, room, generated.buffer, '.png', res);
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo generar la imagen' });
  }
});

mapsRouter.delete('/:mapId/salas/:roomId/imagen', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  db.prepare('UPDATE map_rooms SET background_url = NULL WHERE id = ?').run(room.id);
  touchMap(map.id);
  const updated = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(room.id);
  res.json({ room: serializeRoom(updated) });
});

// ---- Puertas ----

mapsRouter.post('/:mapId/puertas', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  const {
    fromRoomId,
    toRoomId,
    fromX,
    fromY,
    toX,
    toY,
    kind = 'puerta',
    control = 'jugador',
  } = req.body ?? {};

  if (!['puerta', 'escalera', 'portal'].includes(kind)) {
    return res.status(400).json({ error: 'Tipo de puerta no válido' });
  }
  if (!['jugador', 'dm'].includes(control)) {
    return res.status(400).json({ error: 'Control de puerta no válido' });
  }
  if (fromRoomId === toRoomId) {
    return res.status(400).json({ error: 'Una puerta debe conectar dos salas distintas' });
  }
  const fromRoom = getRoom(map.id, fromRoomId);
  const toRoom = getRoom(map.id, toRoomId);
  if (!fromRoom || !toRoom) {
    return res.status(404).json({ error: 'Alguna de las salas no existe en este mapa' });
  }
  if (![fromX, fromY, toX, toY].every(isValidCoord)) {
    return res.status(400).json({ error: 'Posición de la puerta no válida' });
  }
  if (!cellInsideRoom(fromRoom, fromX, fromY) || !cellInsideRoom(toRoom, toX, toY)) {
    return res.status(400).json({ error: 'La puerta debe estar en una casilla activa de cada sala' });
  }
  if (fromRoom.floor_id !== toRoom.floor_id && kind === 'puerta') {
    return res
      .status(400)
      .json({ error: 'Una puerta normal no puede conectar plantas distintas; usa escalera o portal' });
  }

  const info = db
    .prepare(
      `INSERT INTO map_doors (map_id, from_room_id, to_room_id, from_x, from_y, to_x, to_y, kind, control)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(map.id, fromRoom.id, toRoom.id, fromX, fromY, toX, toY, kind, control);
  touchMap(map.id);

  const door = db.prepare('SELECT * FROM map_doors WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ door: serializeDoor(door) });
});

mapsRouter.patch('/:mapId/puertas/:doorId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const door =
    map && db.prepare('SELECT * FROM map_doors WHERE id = ? AND map_id = ?').get(req.params.doorId, map.id);
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });

  const { kind, control, isOpen } = req.body ?? {};
  if (kind !== undefined && !['puerta', 'escalera', 'portal'].includes(kind)) {
    return res.status(400).json({ error: 'Tipo de puerta no válido' });
  }
  if (control !== undefined && !['jugador', 'dm'].includes(control)) {
    return res.status(400).json({ error: 'Control de puerta no válido' });
  }
  if (kind === 'puerta') {
    const fromRoom = getRoom(map.id, door.from_room_id);
    const toRoom = getRoom(map.id, door.to_room_id);
    if (fromRoom.floor_id !== toRoom.floor_id) {
      return res
        .status(400)
        .json({ error: 'Una puerta normal no puede conectar plantas distintas; usa escalera o portal' });
    }
  }

  db.prepare('UPDATE map_doors SET kind = ?, control = ?, is_open = ? WHERE id = ?').run(
    kind ?? door.kind,
    control ?? door.control,
    isOpen !== undefined ? Number(Boolean(isOpen)) : door.is_open,
    door.id
  );
  touchMap(map.id);

  const updated = db.prepare('SELECT * FROM map_doors WHERE id = ?').get(door.id);
  res.json({ door: serializeDoor(updated) });
});

mapsRouter.delete('/:mapId/puertas/:doorId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const door =
    map && db.prepare('SELECT * FROM map_doors WHERE id = ? AND map_id = ?').get(req.params.doorId, map.id);
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });

  db.prepare('DELETE FROM map_doors WHERE id = ?').run(door.id);
  touchMap(map.id);
  res.json({ ok: true });
});
