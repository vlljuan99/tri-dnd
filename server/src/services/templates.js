import { db } from '../db.js';

// Biblioteca de plantillas del DM (migración v35): snapshot de salas, mapas
// enteros, ciudades del mundo (paquete completo: imagen + pins + tableros
// enlazados + submapas anidados) y enemigos configurados, e instanciación en
// cualquier campaña. Las imágenes se referencian por URL de /uploads/maps:
// borrar mapas solo borra filas, nunca archivos, así que el snapshot no
// necesita copiarlas. Las salas siempre se instancian sin revelar.

export const TEMPLATE_KINDS = new Set(['sala', 'mapa', 'ciudad', 'enemigo']);

// ---- Snapshot ----

function snapshotTokenFields(row) {
  return {
    kind: row.kind,
    name: row.name,
    monsterIndex: row.monster_index ?? null,
    characterId: row.character_id ?? null,
    hidden: Boolean(row.hidden),
    dc: row.dc ?? null,
    skill: row.skill ?? null,
    overrides: JSON.parse(row.overrides || '{}'),
    loot: JSON.parse(row.loot || '[]'),
  };
}

// Enemigo configurado: el marcador sin su posición (se coloca al instanciar)
export function snapshotToken(row) {
  return snapshotTokenFields(row);
}

// Sala con todas sus capas y sus marcadores en coordenadas relativas al
// origen de la sala (la posición absoluta la decide quien la estampa)
export function snapshotRoom(row) {
  const tokens = db.prepare('SELECT * FROM map_tokens WHERE room_id = ? ORDER BY id').all(row.id);
  return {
    name: row.name,
    width: row.width,
    height: row.height,
    backgroundUrl: row.background_url ?? null,
    disabledCells: JSON.parse(row.disabled_cells || '[]'),
    obstacleCells: JSON.parse(row.obstacle_cells || '[]'),
    spawnCells: JSON.parse(row.spawn_cells || '[]'),
    terrainCells: JSON.parse(row.terrain_cells || '[]'),
    wallEdges: JSON.parse(row.wall_edges || '[]'),
    elevationCells: JSON.parse(row.elevation_cells || '[]'),
    lightCells: JSON.parse(row.light_cells || '[]'),
    notes: row.notes ?? '',
    tokens: tokens.map((t) => ({
      ...snapshotTokenFields(t),
      x: t.x - row.x,
      y: t.y - row.y,
    })),
  };
}

// Mapa entero: ajustes + plantas + salas (x/y absolutos del lienzo) +
// puertas con la sala referenciada por índice [planta, sala]
export function snapshotMap(map) {
  const floors = db
    .prepare('SELECT * FROM map_floors WHERE map_id = ? ORDER BY position, id')
    .all(map.id);
  const roomsByFloor = floors.map((f) =>
    db.prepare('SELECT * FROM map_rooms WHERE floor_id = ? ORDER BY id').all(f.id)
  );
  // id de sala → [índice de planta, índice de sala] para las puertas
  const roomRef = new Map();
  roomsByFloor.forEach((rooms, fi) => rooms.forEach((r, ri) => roomRef.set(r.id, [fi, ri])));

  const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ? ORDER BY id').all(map.id);
  return {
    name: map.name,
    gridSize: map.grid_size,
    visionMode: map.vision_mode,
    visionRadius: map.vision_radius,
    wallColor: map.wall_color,
    wallLightEvery: map.wall_light_every,
    floors: floors.map((f, fi) => ({
      name: f.name,
      position: f.position,
      rooms: roomsByFloor[fi].map((r) => ({ ...snapshotRoom(r), x: r.x, y: r.y })),
    })),
    doors: doors
      .filter((d) => roomRef.has(d.from_room_id) && roomRef.has(d.to_room_id))
      .map((d) => ({
        from: roomRef.get(d.from_room_id),
        to: roomRef.get(d.to_room_id),
        fromX: d.from_x,
        fromY: d.from_y,
        toX: d.to_x,
        toY: d.to_y,
        kind: d.kind,
        control: d.control,
        isOpen: Boolean(d.is_open),
        dc: d.dc ?? null,
        skill: d.skill ?? null,
      })),
  };
}

// Ciudad completa (recursiva): imagen + pins, y por pin el tablero enlazado
// (snapshot de mapa) o el submapa anidado (recursión). seen evita ciclos.
export function snapshotWorldMap(campaignId, worldMapId, seen = new Set()) {
  const worldMap = db
    .prepare('SELECT * FROM world_maps WHERE id = ? AND campaign_id = ?')
    .get(worldMapId, campaignId);
  if (!worldMap || seen.has(worldMap.id)) return null;
  seen.add(worldMap.id);

  const locations = db
    .prepare('SELECT * FROM world_locations WHERE world_map_id = ? ORDER BY position, id')
    .all(worldMap.id);
  return {
    name: worldMap.name,
    imageUrl: worldMap.image_url ?? null,
    locations: locations.map((l) => {
      const linkedMap = l.map_id
        ? db.prepare('SELECT * FROM maps WHERE id = ? AND campaign_id = ?').get(l.map_id, campaignId)
        : null;
      return {
        name: l.name,
        x: l.x,
        y: l.y,
        lore: l.lore,
        kind: l.kind,
        hidden: Boolean(l.hidden),
        map: linkedMap ? snapshotMap(linkedMap) : null,
        submap: l.target_world_map_id
          ? snapshotWorldMap(campaignId, l.target_world_map_id, seen)
          : null,
      };
    }),
  };
}

// ---- Instanciación ----

// El enlace a un jefe/PNJ solo se conserva si el personaje sigue existiendo
// y es de este DM; si no, queda el monster_index/nombre del marcador
function validCharacterId(userId, characterId) {
  if (characterId == null) return null;
  const boss = db
    .prepare("SELECT id FROM characters WHERE id = ? AND user_id = ? AND kind = 'boss'")
    .get(characterId, userId);
  return boss ? boss.id : null;
}

export function instantiateToken(userId, roomId, x, y, data) {
  const info = db
    .prepare(
      `INSERT INTO map_tokens (room_id, kind, name, monster_index, character_id, x, y, hidden, dc, skill, overrides, loot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      roomId,
      data.kind ?? 'enemigo',
      String(data.name ?? 'Marcador').slice(0, 60),
      data.monsterIndex ?? null,
      validCharacterId(userId, data.characterId),
      x,
      y,
      data.hidden ? 1 : 0,
      data.dc ?? null,
      data.skill ?? null,
      JSON.stringify(data.overrides ?? {}),
      JSON.stringify(data.loot ?? [])
    );
  return info.lastInsertRowid;
}

// Estampa una sala de plantilla en (x, y) de una planta, con sus marcadores
export function instantiateRoom(userId, floorId, x, y, data) {
  const info = db
    .prepare(
      `INSERT INTO map_rooms (floor_id, name, x, y, width, height, background_url,
         disabled_cells, obstacle_cells, spawn_cells, terrain_cells, wall_edges, elevation_cells, light_cells, notes, revealed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(
      floorId,
      String(data.name ?? 'Sala sin nombre').slice(0, 80),
      x,
      y,
      data.width,
      data.height,
      data.backgroundUrl ?? null,
      JSON.stringify(data.disabledCells ?? []),
      JSON.stringify(data.obstacleCells ?? []),
      JSON.stringify(data.spawnCells ?? []),
      JSON.stringify(data.terrainCells ?? []),
      JSON.stringify(data.wallEdges ?? []),
      JSON.stringify(data.elevationCells ?? []),
      JSON.stringify(data.lightCells ?? []),
      data.notes ?? '',
    );
  const roomId = info.lastInsertRowid;
  for (const token of data.tokens ?? []) {
    instantiateToken(userId, roomId, x + token.x, y + token.y, token);
  }
  return roomId;
}

// Mapa entero nuevo en la biblioteca de la campaña. Devuelve su id.
export function instantiateMap(campaignId, userId, data, nameOverride) {
  const name = String(nameOverride ?? data.name ?? 'Mapa de plantilla').slice(0, 80);
  const info = db
    .prepare(
      `INSERT INTO maps (campaign_id, name, grid_size, vision_mode, vision_radius, wall_color, wall_light_every)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      campaignId,
      name,
      data.gridSize ?? 1,
      data.visionMode ?? 'sala',
      data.visionRadius ?? 6,
      data.wallColor ?? '#9b8555',
      data.wallLightEvery ?? 4
    );
  const mapId = info.lastInsertRowid;

  // Ids reales de sala por [planta, sala] para recrear las puertas
  const roomIds = [];
  (data.floors ?? []).forEach((floor, fi) => {
    const floorInfo = db
      .prepare('INSERT INTO map_floors (map_id, name, position) VALUES (?, ?, ?)')
      .run(mapId, String(floor.name ?? `Planta ${fi + 1}`).slice(0, 80), floor.position ?? fi);
    roomIds.push(
      (floor.rooms ?? []).map((room) =>
        instantiateRoom(userId, floorInfo.lastInsertRowid, room.x ?? 0, room.y ?? 0, room)
      )
    );
  });

  const insertDoor = db.prepare(
    `INSERT INTO map_doors (map_id, from_room_id, to_room_id, from_x, from_y, to_x, to_y, kind, control, is_open, dc, skill)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const door of data.doors ?? []) {
    const fromId = roomIds[door.from?.[0]]?.[door.from?.[1]];
    const toId = roomIds[door.to?.[0]]?.[door.to?.[1]];
    if (!fromId || !toId) continue;
    insertDoor.run(
      mapId,
      fromId,
      toId,
      door.fromX,
      door.fromY,
      door.toX,
      door.toY,
      door.kind ?? 'puerta',
      door.control ?? 'jugador',
      door.isOpen ? 1 : 0,
      door.dc ?? null,
      door.skill ?? null
    );
  }
  return mapId;
}

// Ciudad completa: crea el world_map con sus pins y, por pin, el tablero
// enlazado (mapa nuevo en la biblioteca) o el submapa anidado (recursión).
export function instantiateWorldMap(campaignId, userId, data) {
  const info = db
    .prepare('INSERT INTO world_maps (campaign_id, name, image_url) VALUES (?, ?, ?)')
    .run(campaignId, String(data.name ?? 'Submapa de plantilla').slice(0, 120), data.imageUrl ?? null);
  const worldMapId = info.lastInsertRowid;

  let position =
    (db.prepare('SELECT MAX(position) AS p FROM world_locations WHERE campaign_id = ?').get(campaignId).p ?? -1) + 1;
  const insertLocation = db.prepare(
    `INSERT INTO world_locations (campaign_id, world_map_id, name, x, y, lore, kind, hidden, map_id, target_world_map_id, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const loc of data.locations ?? []) {
    const mapId = loc.map ? instantiateMap(campaignId, userId, loc.map) : null;
    const targetId = loc.submap ? instantiateWorldMap(campaignId, userId, loc.submap) : null;
    insertLocation.run(
      campaignId,
      worldMapId,
      String(loc.name ?? 'Ubicación sin nombre').slice(0, 120),
      loc.x ?? 50,
      loc.y ?? 50,
      loc.lore ?? '',
      loc.kind ?? 'dungeon',
      loc.hidden ? 1 : 0,
      mapId,
      targetId,
      position
    );
    position += 1;
  }
  return worldMapId;
}

// ---- Guardado y serialización ----

// Resumen precalculado para los listados (sin parsear data cada vez)
function buildMeta(kind, data) {
  if (kind === 'sala') {
    return { width: data.width, height: data.height, tokens: (data.tokens ?? []).length };
  }
  if (kind === 'mapa') {
    const rooms = (data.floors ?? []).reduce((n, f) => n + (f.rooms ?? []).length, 0);
    const tokens = (data.floors ?? []).reduce(
      (n, f) => n + (f.rooms ?? []).reduce((m, r) => m + (r.tokens ?? []).length, 0),
      0
    );
    return { floors: (data.floors ?? []).length, rooms, tokens };
  }
  if (kind === 'ciudad') {
    let pins = 0;
    let boards = 0;
    let submaps = 0;
    const walk = (city) => {
      for (const loc of city.locations ?? []) {
        pins += 1;
        if (loc.map) boards += 1;
        if (loc.submap) {
          submaps += 1;
          walk(loc.submap);
        }
      }
    };
    walk(data);
    return { pins, boards, submaps };
  }
  // enemigo
  return {
    monsterIndex: data.monsterIndex ?? null,
    hasOverrides: Object.keys(data.overrides ?? {}).length > 0,
    lootEntries: (data.loot ?? []).length,
  };
}

function previewFor(kind, data) {
  if (kind === 'sala') return data.backgroundUrl ?? null;
  if (kind === 'mapa') {
    for (const floor of data.floors ?? []) {
      for (const room of floor.rooms ?? []) {
        if (room.backgroundUrl) return room.backgroundUrl;
      }
    }
    return null;
  }
  if (kind === 'ciudad') return data.imageUrl ?? null;
  return null;
}

export function saveTemplate(userId, kind, name, data) {
  const cleanName = String(name ?? '').trim().slice(0, 120) || 'Plantilla sin nombre';
  const info = db
    .prepare('INSERT INTO dm_templates (user_id, kind, name, data, preview_url, meta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, kind, cleanName, JSON.stringify(data), previewFor(kind, data), JSON.stringify(buildMeta(kind, data)));
  return getTemplate(userId, info.lastInsertRowid);
}

export function getTemplate(userId, templateId) {
  return db.prepare('SELECT * FROM dm_templates WHERE id = ? AND user_id = ?').get(templateId, userId);
}

// La plantilla del usuario, ya parseada, solo si es del tipo esperado
export function getTemplateData(userId, templateId, kind) {
  const row = getTemplate(userId, templateId);
  if (!row || row.kind !== kind) return null;
  return { row, data: JSON.parse(row.data) };
}

export function serializeTemplate(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    previewUrl: row.preview_url ?? null,
    meta: JSON.parse(row.meta || '{}'),
    createdAt: row.created_at,
  };
}
