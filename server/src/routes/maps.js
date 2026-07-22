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
  getToken,
  touchMap,
  serializeRoom,
  serializeDoor,
  serializeToken,
  serializeFullMap,
  spawnRoomEnemies,
} from '../services/mapLibrary.js';
import { notifyCampaignMap, notifyIfActive, notifyCombat, notifyCombatStarted } from '../services/liveMap.js';
import { trySpendEnemyMovement } from '../services/turnEconomy.js';
import { buildWalkableGrid, findPath, buildElevationMap } from '../services/pathfinding.js';
import { queueOpportunityAttacks } from '../services/opportunityAttacks.js';
import { buildWallSet, isValidWallEdges } from '../services/walls.js';
import { fireRevealEvents } from '../services/events.js';
import {
  snapshotMap,
  snapshotRoom,
  snapshotToken,
  instantiateMap,
  instantiateRoom,
  instantiateToken,
  saveTemplate,
  getTemplateData,
  serializeTemplate,
} from '../services/templates.js';

// Marca el mapa como modificado y, si es el que está en la mesa, avisa a los
// sockets de la campaña para que recarguen su vista (ya filtrada por rol)
function touchAndNotify(map) {
  touchMap(map.id);
  notifyIfActive(map.campaign_id, map.id);
}

// Puertas cuyos extremos tocan alguna de estas salas (filas de map_rooms):
// las de arista modifican el muro (abren/cierran) en el pathfinding.
function doorsForRooms(mapId, rooms) {
  const ids = rooms.map((r) => r.id);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM map_doors WHERE map_id = ? AND (from_room_id IN (${marks}) OR to_room_id IN (${marks}))`
    )
    .all(mapId, ...ids, ...ids);
}

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

// La casilla (x, y) del lienzo de la planta cae dentro de la sala, no está
// desactivada por su forma ni ocupada por un obstáculo
function cellInsideRoom(room, x, y) {
  if (x < room.x || x >= room.x + room.width || y < room.y || y >= room.y + room.height) {
    return false;
  }
  const blocked = [
    ...JSON.parse(room.disabled_cells || '[]'),
    ...JSON.parse(room.obstacle_cells || '[]'),
  ];
  return !blocked.some(([col, row]) => col === x - room.x && row === y - room.y);
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

// Mapa nuevo instanciado desde una plantilla de la biblioteca del DM (v35):
// se recrean plantas, salas (sin revelar), puertas y marcadores
mapsRouter.post('/desde-plantilla', (req, res) => {
  const template = getTemplateData(req.user.id, req.body?.templateId, 'mapa');
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });

  const mapId = db.transaction(() =>
    instantiateMap(req.params.campaignId, req.user.id, template.data, req.body?.name)
  )();
  const map = getMap(req.params.campaignId, mapId);
  res.status(201).json({ map: serializeFullMap(map, req.params.campaignId) });
});

mapsRouter.get('/:mapId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });
  res.json({ map: serializeFullMap(map, req.params.campaignId) });
});

// Guardar el mapa entero en la biblioteca de plantillas del DM
mapsRouter.post('/:mapId/guardar-plantilla', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });
  const template = saveTemplate(req.user.id, 'mapa', req.body?.name ?? map.name, snapshotMap(map));
  res.status(201).json({ template: serializeTemplate(template) });
});

mapsRouter.patch('/:mapId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  const { name, gridSize, visionMode, visionRadius, wallColor, wallLightEvery } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'El mapa necesita un nombre' });
  }
  if (gridSize !== undefined && (!Number.isFinite(gridSize) || gridSize <= 0 || gridSize > 10)) {
    return res.status(400).json({ error: 'Tamaño de casilla no válido' });
  }
  if (visionMode !== undefined && !['sala', 'compartida', 'individual'].includes(visionMode)) {
    return res.status(400).json({ error: 'Modo de visión no válido' });
  }
  if (visionRadius !== undefined && (!Number.isInteger(visionRadius) || visionRadius < 1 || visionRadius > 30)) {
    return res.status(400).json({ error: 'El radio de visión debe ser un entero entre 1 y 30 casillas' });
  }
  // Color hex #rgb o #rrggbb (lo que emite <input type="color">)
  if (wallColor !== undefined && !(typeof wallColor === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(wallColor))) {
    return res.status(400).json({ error: 'Color de pared no válido' });
  }
  // Antorchas automáticas de pared: cada N casillas (0 = desactivadas)
  if (wallLightEvery !== undefined && !(Number.isInteger(wallLightEvery) && wallLightEvery >= 0 && wallLightEvery <= 20)) {
    return res.status(400).json({ error: 'Frecuencia de luces de pared no válida' });
  }

  db.prepare(
    `UPDATE maps SET name = COALESCE(?, name), grid_size = COALESCE(?, grid_size),
       vision_mode = COALESCE(?, vision_mode), vision_radius = COALESCE(?, vision_radius),
       wall_color = COALESCE(?, wall_color), wall_light_every = COALESCE(?, wall_light_every),
       updated_at = datetime('now') WHERE id = ?`
  ).run(
    name !== undefined ? name.trim().slice(0, 80) : null,
    gridSize ?? null,
    visionMode ?? null,
    visionRadius ?? null,
    wallColor ?? null,
    wallLightEvery ?? null,
    map.id
  );
  notifyIfActive(map.campaign_id, map.id);

  res.json({ map: serializeFullMap(getMap(req.params.campaignId, map.id), req.params.campaignId) });
});

// Borrar un mapa; si era el activo, la mesa se queda sin mapa hasta activar otro
mapsRouter.delete('/:mapId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  const wasActive = getActiveMapId(req.params.campaignId) === map.id;
  db.transaction(() => {
    db.prepare(
      "UPDATE game_tables SET active_map_id = NULL, updated_at = datetime('now') WHERE campaign_id = ? AND active_map_id = ?"
    ).run(req.params.campaignId, map.id);
    db.prepare('DELETE FROM maps WHERE id = ?').run(map.id);
  })();
  if (wasActive) notifyCampaignMap(map.campaign_id);
  res.json({ ok: true });
});

// Activa este mapa como el de la mesa en vivo de la campaña
mapsRouter.post('/:mapId/activar', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });
  db.prepare(
    "UPDATE game_tables SET active_map_id = ?, updated_at = datetime('now') WHERE campaign_id = ?"
  ).run(map.id, req.params.campaignId);
  notifyCampaignMap(map.campaign_id);
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
  touchAndNotify(map);
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
  touchAndNotify(map);
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
  touchAndNotify(map);
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
  touchAndNotify(map);

  const room = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ room: serializeRoom(room) });
});

// Estampar una sala de plantilla en (x, y) de esta planta, con sus marcadores
mapsRouter.post('/:mapId/plantas/:floorId/salas/desde-plantilla', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const floor = map && getFloor(map.id, req.params.floorId);
  if (!floor) return res.status(404).json({ error: 'Planta no encontrada' });

  const { templateId, x = 0, y = 0 } = req.body ?? {};
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'Posición de la sala no válida' });
  }
  const template = getTemplateData(req.user.id, templateId, 'sala');
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });

  const roomId = db.transaction(() => instantiateRoom(req.user.id, floor.id, x, y, template.data))();
  touchAndNotify(map);
  const room = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(roomId);
  res.status(201).json({ room: serializeRoom(room) });
});

// Guardar una sala (con sus marcadores) en la biblioteca de plantillas
mapsRouter.post('/:mapId/salas/:roomId/guardar-plantilla', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const template = saveTemplate(req.user.id, 'sala', req.body?.name ?? room.name, snapshotRoom(room));
  res.status(201).json({ template: serializeTemplate(template) });
});

// Guarda un trazo completo del pincel de paredes en una única transacción.
// Un arrastre puede atravesar varias salas; si una de ellas no es válida no
// se modifica ninguna, evitando paredes guardadas a medias.
mapsRouter.patch('/:mapId/paredes', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  if (!map) return res.status(404).json({ error: 'Mapa no encontrado' });

  const updates = req.body?.rooms;
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 100) {
    return res.status(400).json({ error: 'El trazo de paredes no es válido' });
  }

  const seenRoomIds = new Set();
  const prepared = [];
  for (const update of updates) {
    const roomId = update?.roomId;
    if (!Number.isInteger(roomId) || seenRoomIds.has(roomId) || !isValidWallEdges(update?.wallEdges)) {
      return res.status(400).json({ error: 'El trazo de paredes no es válido' });
    }
    const room = getRoom(map.id, roomId);
    if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
    if (update.wallEdges.some(([col, row]) => col >= room.width || row >= room.height)) {
      return res.status(400).json({ error: 'Hay paredes fuera de los límites de la sala' });
    }
    seenRoomIds.add(roomId);
    prepared.push({ room, wallEdges: update.wallEdges });
  }

  const updateWalls = db.prepare('UPDATE map_rooms SET wall_edges = ? WHERE id = ?');
  db.transaction(() => {
    for (const { room, wallEdges } of prepared) {
      updateWalls.run(JSON.stringify(wallEdges), room.id);
    }
  })();
  touchAndNotify(map);

  res.json({
    rooms: prepared.map(({ room }) => serializeRoom(getRoom(map.id, room.id))),
  });
});

mapsRouter.patch('/:mapId/salas/:roomId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const { name, x, y, width, height, disabledCells, obstacleCells, spawnCells, terrainCells, wallEdges, elevationCells, lightCells, notes, revealed } = req.body ?? {};
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
  if (obstacleCells !== undefined && !isValidDisabledCells(obstacleCells)) {
    return res.status(400).json({ error: 'Lista de obstáculos no válida' });
  }
  if (spawnCells !== undefined && !isValidDisabledCells(spawnCells)) {
    return res.status(400).json({ error: 'Lista de puntos de aparición no válida' });
  }
  // Terreno difícil: [col, fila, coste] con coste 2..10 (1 sería suelo normal)
  if (
    terrainCells !== undefined &&
    !(
      Array.isArray(terrainCells) &&
      terrainCells.length <= 2500 &&
      terrainCells.every(
        ([c, r, cost]) =>
          Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 &&
          Number.isInteger(cost) && cost >= 2 && cost <= 10
      )
    )
  ) {
    return res.status(400).json({ error: 'Lista de terreno no válida' });
  }
  if (wallEdges !== undefined && !isValidWallEdges(wallEdges)) {
    return res.status(400).json({ error: 'Lista de paredes no válida' });
  }
  // Elevación: [col, fila, nivel] con nivel entero no nulo entre -10 y 10
  if (
    elevationCells !== undefined &&
    !(
      Array.isArray(elevationCells) &&
      elevationCells.length <= 2500 &&
      elevationCells.every(
        ([c, r, level]) =>
          Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 &&
          Number.isInteger(level) && level !== 0 && level >= -10 && level <= 10
      )
    )
  ) {
    return res.status(400).json({ error: 'Lista de elevación no válida' });
  }
  // Fuentes de luz manuales: pares [col, fila] como el resto de capas
  if (lightCells !== undefined && !isValidDisabledCells(lightCells)) {
    return res.status(400).json({ error: 'Lista de luces no válida' });
  }
  if (notes !== undefined && typeof notes !== 'string') {
    return res.status(400).json({ error: 'Las notas deben ser texto' });
  }

  const nextWidth = width ?? room.width;
  const nextHeight = height ?? room.height;
  // Al encoger la sala, las casillas desactivadas, obstáculos, puntos de
  // aparición o paredes fuera de los nuevos límites se descartan
  const insideRoom = ([col, row]) => col < nextWidth && row < nextHeight;
  const nextDisabled = (disabledCells ?? JSON.parse(room.disabled_cells || '[]')).filter(insideRoom);
  const nextObstacles = (obstacleCells ?? JSON.parse(room.obstacle_cells || '[]')).filter(insideRoom);
  const nextSpawns = (spawnCells ?? JSON.parse(room.spawn_cells || '[]')).filter(insideRoom);
  const nextTerrain = (terrainCells ?? JSON.parse(room.terrain_cells || '[]')).filter(insideRoom);
  const nextWalls = (wallEdges ?? JSON.parse(room.wall_edges || '[]')).filter(insideRoom);
  const nextElevation = (elevationCells ?? JSON.parse(room.elevation_cells || '[]')).filter(insideRoom);
  const nextLights = (lightCells ?? JSON.parse(room.light_cells || '[]')).filter(insideRoom);
  const nextX = x ?? room.x;
  const nextY = y ?? room.y;
  const deltaX = nextX - room.x;
  const deltaY = nextY - room.y;

  // Los marcadores, fichas de personaje y extremos de puertas usan
  // coordenadas absolutas del lienzo. Al arrastrar una sala deben conservar
  // su posición relativa dentro de ella, así que todo el conjunto se desplaza
  // en la misma transacción que la sala.
  db.transaction(() => {
    db.prepare(
      `UPDATE map_rooms SET name = ?, x = ?, y = ?, width = ?, height = ?,
         disabled_cells = ?, obstacle_cells = ?, spawn_cells = ?, terrain_cells = ?, wall_edges = ?, elevation_cells = ?, light_cells = ?, notes = ?, revealed = ? WHERE id = ?`
    ).run(
      name !== undefined ? name.trim().slice(0, 80) : room.name,
      nextX,
      nextY,
      nextWidth,
      nextHeight,
      JSON.stringify(nextDisabled),
      JSON.stringify(nextObstacles),
      JSON.stringify(nextSpawns),
      JSON.stringify(nextTerrain),
      JSON.stringify(nextWalls),
      JSON.stringify(nextElevation),
      JSON.stringify(nextLights),
      notes ?? room.notes,
      revealed !== undefined ? Number(Boolean(revealed)) : room.revealed,
      room.id
    );

    if (deltaX !== 0 || deltaY !== 0) {
      db.prepare('UPDATE map_tokens SET x = x + ?, y = y + ? WHERE room_id = ?')
        .run(deltaX, deltaY, room.id);
      db.prepare('UPDATE map_character_tokens SET x = x + ?, y = y + ? WHERE room_id = ?')
        .run(deltaX, deltaY, room.id);
      db.prepare('UPDATE map_doors SET from_x = from_x + ?, from_y = from_y + ? WHERE from_room_id = ?')
        .run(deltaX, deltaY, room.id);
      db.prepare('UPDATE map_doors SET to_x = to_x + ?, to_y = to_y + ? WHERE to_room_id = ?')
        .run(deltaX, deltaY, room.id);
    }
  })();
  touchAndNotify(map);

  // Al revelarse por primera vez en la mesa, sus enemigos entran al tracker
  // y saltan sus eventos de revelado (Fase 19)
  const becameRevealed = revealed !== undefined && Boolean(revealed) && !room.revealed;
  if (becameRevealed && getActiveMapId(req.params.campaignId) === map.id) {
    const spawned = spawnRoomEnemies(map.campaign_id, [room.id]);
    if (spawned.added > 0) notifyCombat(map.campaign_id);
    if (spawned.startedCombat) notifyCombatStarted(map.campaign_id);
    fireRevealEvents(map.campaign_id, [room.id]);
  }

  const updated = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(room.id);
  res.json({ room: serializeRoom(updated) });
});

mapsRouter.delete('/:mapId/salas/:roomId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  // Las puertas que tocaban esta sala caen en cascada (FK)
  db.prepare('DELETE FROM map_rooms WHERE id = ?').run(room.id);
  touchAndNotify(map);
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
  touchAndNotify(map);
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

// En qué lados de la sala hay puertas/aberturas, en términos de imagen
// (norte = borde superior). Las que caen en el interior (escaleras,
// trampillas) no marcan lado.
function roomOpenings(mapId, room) {
  const doors = db
    .prepare('SELECT * FROM map_doors WHERE map_id = ? AND (from_room_id = ? OR to_room_id = ?)')
    .all(mapId, room.id, room.id);
  const sides = new Set();
  for (const door of doors) {
    const isFrom = door.from_room_id === room.id;
    const x = isFrom ? door.from_x : door.to_x;
    const y = isFrom ? door.from_y : door.to_y;
    if (x === room.x) sides.add('oeste');
    if (x === room.x + room.width - 1) sides.add('este');
    if (y === room.y) sides.add('norte');
    if (y === room.y + room.height - 1) sides.add('sur');
  }
  return [...sides];
}

mapsRouter.post('/:mapId/salas/:roomId/imagen/generar', async (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const { prompt, provider } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 600) : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Describe la sala que quieres generar' });

  try {
    // La forma de la sala y sus aberturas guían la imagen: un pasillo 8×2
    // sale apaisado y las puertas quedan en el borde correcto
    const generated = await generateMapImage(provider, cleanPrompt, {
      width: room.width,
      height: room.height,
      openings: roomOpenings(map.id, room),
    });
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
  touchAndNotify(map);
  const updated = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(room.id);
  res.json({ room: serializeRoom(updated) });
});

// ---- Marcadores (enemigos, aliados, objetos, trampas) ----

const TOKEN_KINDS = ['enemigo', 'aliado', 'objeto', 'trampa'];

// Colocar un marcador en una casilla activa de una sala. Las trampas nacen
// ocultas salvo que se indique lo contrario.
mapsRouter.post('/:mapId/salas/:roomId/fichas', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const {
    kind = 'enemigo', name, x, y, monsterIndex, characterId, hidden, dc, skill,
    perceptionDc, visionRadius, successConsequence, failureConsequence,
    consequenceScope = 'player', loot,
  } = req.body ?? {};
  if (!TOKEN_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Tipo de marcador no válido' });
  }
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : '';
  if (!cleanName) return res.status(400).json({ error: 'El marcador necesita un nombre' });
  if (!isValidCoord(x) || !isValidCoord(y) || !cellInsideRoom(room, x, y)) {
    return res.status(400).json({ error: 'El marcador debe estar en una casilla activa de la sala' });
  }
  if (dc !== undefined && dc !== null && !(Number.isInteger(dc) && dc >= 1 && dc <= 30)) {
    return res.status(400).json({ error: 'Dificultad no válida' });
  }
  if (skill !== undefined && skill !== null && !(typeof skill === 'string' && skill.length <= 30)) {
    return res.status(400).json({ error: 'Habilidad no válida' });
  }
  if (successConsequence !== undefined && !(typeof successConsequence === 'string' && successConsequence.length <= 2000)) {
    return res.status(400).json({ error: 'Consecuencia de éxito no válida' });
  }
  if (failureConsequence !== undefined && !(typeof failureConsequence === 'string' && failureConsequence.length <= 2000)) {
    return res.status(400).json({ error: 'Consecuencia de fallo no válida' });
  }
  if (consequenceScope !== 'player' && consequenceScope !== 'party') {
    return res.status(400).json({ error: 'Audiencia de consecuencia no válida' });
  }
  if (
    perceptionDc !== undefined && perceptionDc !== null &&
    !(Number.isInteger(perceptionDc) && perceptionDc >= 1 && perceptionDc <= 30)
  ) {
    return res.status(400).json({ error: 'CD de percepción no válida' });
  }
  if (
    visionRadius !== undefined &&
    !(Number.isInteger(visionRadius) && visionRadius >= 1 && visionRadius <= 30)
  ) {
    return res.status(400).json({ error: 'Alcance de visión no válido' });
  }
  let lootJson = '[]';
  if (loot !== undefined) {
    if (!Array.isArray(loot) || loot.length > 40) {
      return res.status(400).json({ error: 'Botín no válido' });
    }
    lootJson = JSON.stringify(loot);
    if (lootJson.length > 12000) {
      return res.status(400).json({ error: 'Botín demasiado largo' });
    }
  }

  let monsterIdx = null;
  if ((kind === 'enemigo' || kind === 'aliado') && typeof monsterIndex === 'string' && monsterIndex) {
    const monster = db
      .prepare("SELECT idx FROM srd_entries WHERE category = 'monsters' AND idx = ?")
      .get(monsterIndex);
    if (monster) monsterIdx = monster.idx;
  }
  // Un enemigo puede enlazarse a un "jefe" (ficha completa del DM) y un
  // aliado a un PNJ (misma ficha kind='boss', pero amistoso): en ambos casos
  // el marcador toma su avatar y sus stats. Solo personajes del propio DM.
  let bossId = null;
  if ((kind === 'enemigo' || kind === 'aliado') && characterId != null) {
    const boss = db
      .prepare("SELECT id FROM characters WHERE id = ? AND user_id = ? AND kind = 'boss'")
      .get(characterId, req.user.id);
    if (!boss) return res.status(400).json({ error: 'Personaje no válido' });
    bossId = boss.id;
  }
  const isHidden = hidden !== undefined ? Number(Boolean(hidden)) : kind === 'trampa' ? 1 : 0;

  const info = db
    .prepare(
      `INSERT INTO map_tokens
       (room_id, kind, name, monster_index, character_id, x, y, hidden, dc, skill,
        success_consequence, failure_consequence, consequence_scope, perception_dc, vision_radius, loot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      room.id, kind, cleanName, monsterIdx, bossId, x, y, isHidden, dc ?? null, skill ?? null,
      successConsequence ?? '', failureConsequence ?? '',
      consequenceScope,
      perceptionDc ?? (kind === 'trampa' ? 10 : null), visionRadius ?? 6, lootJson
    );
  touchAndNotify(map);

  const token = db.prepare('SELECT * FROM map_tokens WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: serializeToken(token) });
});

// Colocar un marcador desde una plantilla de enemigo configurado (variante,
// botín, dificultad…) en una casilla activa de la sala
mapsRouter.post('/:mapId/salas/:roomId/fichas/desde-plantilla', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const room = map && getRoom(map.id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const { templateId, x, y } = req.body ?? {};
  if (!isValidCoord(x) || !isValidCoord(y) || !cellInsideRoom(room, x, y)) {
    return res.status(400).json({ error: 'El marcador debe estar en una casilla activa de la sala' });
  }
  const template = getTemplateData(req.user.id, templateId, 'enemigo');
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });

  const tokenId = db.transaction(() => instantiateToken(req.user.id, room.id, x, y, template.data))();
  touchAndNotify(map);
  const token = db.prepare('SELECT * FROM map_tokens WHERE id = ?').get(tokenId);
  res.status(201).json({ token: serializeToken(token) });
});

// Guardar un marcador configurado (enemigo con variante/botín) como plantilla
mapsRouter.post('/:mapId/fichas/:tokenId/guardar-plantilla', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const token = map && getToken(map.id, req.params.tokenId);
  if (!token) return res.status(404).json({ error: 'Marcador no encontrado' });
  const template = saveTemplate(req.user.id, 'enemigo', req.body?.name ?? token.name, snapshotToken(token));
  res.status(201).json({ template: serializeTemplate(template) });
});

mapsRouter.patch('/:mapId/fichas/:tokenId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const token = map && getToken(map.id, req.params.tokenId);
  if (!token) return res.status(404).json({ error: 'Marcador no encontrado' });

  const {
    name, x, y, hidden, kind, dc, skill, perceptionDc, visionRadius, successConsequence,
    failureConsequence, consequenceScope, overrides, loot,
  } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'El marcador necesita un nombre' });
  }
  if (kind !== undefined && !TOKEN_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Tipo de marcador no válido' });
  }
  if (dc !== undefined && dc !== null && !(Number.isInteger(dc) && dc >= 1 && dc <= 30)) {
    return res.status(400).json({ error: 'Dificultad no válida' });
  }
  if (skill !== undefined && skill !== null && !(typeof skill === 'string' && skill.length <= 30)) {
    return res.status(400).json({ error: 'Habilidad no válida' });
  }
  if (successConsequence !== undefined && !(typeof successConsequence === 'string' && successConsequence.length <= 2000)) {
    return res.status(400).json({ error: 'Consecuencia de éxito no válida' });
  }
  if (failureConsequence !== undefined && !(typeof failureConsequence === 'string' && failureConsequence.length <= 2000)) {
    return res.status(400).json({ error: 'Consecuencia de fallo no válida' });
  }
  if (consequenceScope !== undefined && consequenceScope !== 'player' && consequenceScope !== 'party') {
    return res.status(400).json({ error: 'Audiencia de consecuencia no válida' });
  }
  if (
    perceptionDc !== undefined && perceptionDc !== null &&
    !(Number.isInteger(perceptionDc) && perceptionDc >= 1 && perceptionDc <= 30)
  ) {
    return res.status(400).json({ error: 'CD de percepción no válida' });
  }
  if (
    visionRadius !== undefined &&
    !(Number.isInteger(visionRadius) && visionRadius >= 1 && visionRadius <= 30)
  ) {
    return res.status(400).json({ error: 'Alcance de visión no válido' });
  }
  // Variante por instancia (Fase 17) y botín (Fase 20): JSON del propio DM,
  // validado por encima y acotado en tamaño.
  let overridesJson;
  if (overrides !== undefined) {
    if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return res.status(400).json({ error: 'Variantes no válidas' });
    }
    overridesJson = JSON.stringify(overrides);
    if (overridesJson.length > 8000) return res.status(400).json({ error: 'Variantes demasiado largas' });
  }
  let lootJson;
  if (loot !== undefined) {
    if (!Array.isArray(loot) || loot.length > 40) {
      return res.status(400).json({ error: 'Botín no válido' });
    }
    lootJson = JSON.stringify(loot);
    if (lootJson.length > 12000) return res.status(400).json({ error: 'Botín demasiado largo' });
  }

  // Al moverlo puede cambiar de sala: se busca la sala de la misma planta
  // que contiene la casilla de destino
  let roomId = token.room_id;
  let movementPath = null;
  let movementFloorId = null;
  let movementVisibleToPlayers = false;
  if (x !== undefined || y !== undefined) {
    const nextX = x ?? token.x;
    const nextY = y ?? token.y;
    if (!isValidCoord(nextX) || !isValidCoord(nextY)) {
      return res.status(400).json({ error: 'Posición del marcador no válida' });
    }
    const currentRoom = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(token.room_id);
    movementFloorId = currentRoom.floor_id;
    const targetRoom = db
      .prepare(
        `SELECT r.* FROM map_rooms r WHERE r.floor_id = ?
           AND ? >= r.x AND ? < r.x + r.width AND ? >= r.y AND ? < r.y + r.height`
      )
      .all(currentRoom.floor_id, nextX, nextX, nextY, nextY)
      .find((r) => cellInsideRoom(r, nextX, nextY));
    if (!targetRoom) {
      return res.status(400).json({ error: 'El marcador debe quedar en una casilla activa de una sala' });
    }
    movementVisibleToPlayers = Boolean(currentRoom.revealed || targetRoom.revealed);
    roomId = targetRoom.id;

    // Con el modo por turnos activo, arrastrar un enemigo también gasta su
    // movimiento y se bloquea fuera de su turno o al agotarlo — misma
    // economía que un jugador, ahora con el coste del camino real (terreno
    // difícil incluido). Si no hay camino se cae a la distancia en línea:
    // el DM conserva la libertad de recolocar la escena.
    const floorRooms = db
      .prepare('SELECT * FROM map_rooms WHERE floor_id = ?')
      .all(currentRoom.floor_id);
    const pathResult = findPath(
      buildWalkableGrid(floorRooms),
      { x: token.x, y: token.y },
      { x: nextX, y: nextY },
      150,
      buildWallSet(floorRooms, doorsForRooms(map.id, floorRooms)),
      buildElevationMap(floorRooms)
    );
    const distance = pathResult?.cost ?? Math.max(Math.abs(nextX - token.x), Math.abs(nextY - token.y));
    movementPath = pathResult
      ? [{ x: token.x, y: token.y }, ...pathResult.path]
      : [{ x: token.x, y: token.y }, { x: nextX, y: nextY }];
    const spend = trySpendEnemyMovement(req.params.campaignId, token.id, distance);
    if (!spend.ok) return res.status(400).json({ error: spend.error });
  }

  db.prepare(
    `UPDATE map_tokens SET room_id = ?, name = ?, x = ?, y = ?, hidden = ?, kind = ?, dc = ?, skill = ?,
       success_consequence = ?, failure_consequence = ?, consequence_scope = ?, perception_dc = ?, vision_radius = ?, overrides = ?, loot = ?
       WHERE id = ?`
  ).run(
    roomId,
    name !== undefined ? name.trim().slice(0, 60) : token.name,
    x ?? token.x,
    y ?? token.y,
    hidden !== undefined ? Number(Boolean(hidden)) : token.hidden,
    kind ?? token.kind,
    dc !== undefined ? dc : token.dc,
    skill !== undefined ? skill : token.skill,
    successConsequence !== undefined ? successConsequence : token.success_consequence,
    failureConsequence !== undefined ? failureConsequence : token.failure_consequence,
    consequenceScope !== undefined ? consequenceScope : token.consequence_scope,
    perceptionDc !== undefined ? perceptionDc : token.perception_dc,
    visionRadius !== undefined ? visionRadius : token.vision_radius,
    overridesJson !== undefined ? overridesJson : token.overrides,
    lootJson !== undefined ? lootJson : token.loot,
    token.id
  );
  touchAndNotify(map);
  // El movimiento gastado se refleja en vivo en el tracker/HUD del DM
  if (x !== undefined || y !== undefined) {
    const visibleMover = !(hidden !== undefined ? Boolean(hidden) : Boolean(token.hidden));
    if (
      token.kind === 'enemigo' &&
      visibleMover &&
      movementPath &&
      movementVisibleToPlayers
    ) {
      const moverCombatant = db
        .prepare('SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ?')
        .get(map.campaign_id, token.id);
      queueOpportunityAttacks({
        campaignId: map.campaign_id,
        moverKind: 'marcador',
        moverMapTokenId: token.id,
        moverName: name !== undefined ? name.trim().slice(0, 60) : token.name,
        moverCombatant,
        floorId: movementFloorId,
        path: movementPath,
      });
    }
    notifyCombat(map.campaign_id);
  }

  const updated = db.prepare('SELECT * FROM map_tokens WHERE id = ?').get(token.id);
  res.json({ token: serializeToken(updated) });
});

mapsRouter.delete('/:mapId/fichas/:tokenId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const token = map && getToken(map.id, req.params.tokenId);
  if (!token) return res.status(404).json({ error: 'Marcador no encontrado' });

  db.prepare('DELETE FROM map_tokens WHERE id = ?').run(token.id);
  touchAndNotify(map);
  res.json({ ok: true });
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
  // Una puerta normal se apoya en una arista: sus dos casillas han de ser
  // ortogonalmente contiguas (misma sala o dos salas que se tocan). Escaleras
  // y portales, en cambio, enlazan salas distintas (posiblemente de otra
  // planta) y no tienen esa restricción.
  if (kind === 'puerta') {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const adjacent = (Math.abs(dx) === 1 && dy === 0) || (Math.abs(dy) === 1 && dx === 0);
    if (!adjacent) {
      return res.status(400).json({
        error: 'Una puerta debe ir entre dos casillas contiguas; para conectar salas lejanas o plantas usa escalera o portal',
      });
    }
  } else if (fromRoomId === toRoomId) {
    return res.status(400).json({ error: 'Una escalera o portal debe conectar dos salas distintas' });
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
  touchAndNotify(map);

  const door = db.prepare('SELECT * FROM map_doors WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ door: serializeDoor(door) });
});

mapsRouter.patch('/:mapId/puertas/:doorId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const door =
    map && db.prepare('SELECT * FROM map_doors WHERE id = ? AND map_id = ?').get(req.params.doorId, map.id);
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });

  const { kind, control, isOpen, dc, skill } = req.body ?? {};
  if (kind !== undefined && !['puerta', 'escalera', 'portal'].includes(kind)) {
    return res.status(400).json({ error: 'Tipo de puerta no válido' });
  }
  if (control !== undefined && !['jugador', 'dm'].includes(control)) {
    return res.status(400).json({ error: 'Control de puerta no válido' });
  }
  if (dc !== undefined && dc !== null && !(Number.isInteger(dc) && dc >= 1 && dc <= 30)) {
    return res.status(400).json({ error: 'Dificultad no válida' });
  }
  if (skill !== undefined && skill !== null && !(typeof skill === 'string' && skill.length <= 30)) {
    return res.status(400).json({ error: 'Habilidad no válida' });
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

  db.prepare('UPDATE map_doors SET kind = ?, control = ?, is_open = ?, dc = ?, skill = ? WHERE id = ?').run(
    kind ?? door.kind,
    control ?? door.control,
    isOpen !== undefined ? Number(Boolean(isOpen)) : door.is_open,
    dc !== undefined ? dc : door.dc,
    skill !== undefined ? skill : door.skill,
    door.id
  );
  touchAndNotify(map);

  const updated = db.prepare('SELECT * FROM map_doors WHERE id = ?').get(door.id);
  res.json({ door: serializeDoor(updated) });
});

mapsRouter.delete('/:mapId/puertas/:doorId', (req, res) => {
  const map = getMap(req.params.campaignId, req.params.mapId);
  const door =
    map && db.prepare('SELECT * FROM map_doors WHERE id = ? AND map_id = ?').get(req.params.doorId, map.id);
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });

  db.prepare('DELETE FROM map_doors WHERE id = ?').run(door.id);
  touchAndNotify(map);
  res.json({ ok: true });
});
