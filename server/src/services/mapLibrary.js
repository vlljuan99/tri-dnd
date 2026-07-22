import { db } from '../db.js';
import { computeFloorVision } from './vision.js';
import { rollInitiativeDetailed, ensureTurnStarted, activateTurnMode } from './turnEconomy.js';

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
    obstacleCells: JSON.parse(row.obstacle_cells || '[]'),
    spawnCells: JSON.parse(row.spawn_cells || '[]'),
    // Terreno difícil ([col, fila, coste]): visible también para el jugador,
    // el coste de moverse no es información oculta
    terrainCells: JSON.parse(row.terrain_cells || '[]'),
    // Paredes por arista ([col, fila, lado]): geometría visible del mapa,
    // el jugador las ve igual que ve los obstáculos
    wallEdges: JSON.parse(row.wall_edges || '[]'),
    // Elevación por casilla ([col, fila, nivel]): geometría visible; subir de
    // nivel cuesta movimiento extra (no es información oculta)
    elevationCells: JSON.parse(row.elevation_cells || '[]'),
    // Fuentes de luz manuales ([col, fila]): braseros/velas del DM, visibles
    // para todos (son decorado; la niebla por luz llegará en la fase 12)
    lightCells: JSON.parse(row.light_cells || '[]'),
    notes: forPlayer ? '' : row.notes,
    // Para el jugador, toda sala que recibe es visible (aunque el DM la
    // tenga sin revelar y solo la vea él por tener ahí su personaje)
    revealed: forPlayer ? true : Boolean(row.revealed),
  };
}

// dc (dificultad de la tirada para forzarla) es secreto para el jugador,
// igual que la CA de un enemigo: solo se revela al resolver el intento.
// skill (qué habilidad tira) sí es público, para que sepa qué le espera.
export function serializeDoor(row, { forPlayer = false } = {}) {
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
    skill: row.skill ?? null,
    dc: forPlayer ? undefined : row.dc ?? null,
  };
}

export function serializeToken(row, { forPlayer = false } = {}) {
  const loot = JSON.parse(row.loot || '[]');
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    name: row.name,
    // El índice permite consultar la ficha SRD completa, así que solo viaja
    // al DM. El jugador recibe nombre, avatar y barra, pero no los stats base.
    monsterIndex: forPlayer ? undefined : row.monster_index,
    x: row.x,
    y: row.y,
    hidden: Boolean(row.hidden),
    // HP del tracker si el marcador está enlazado a un combatiente. Solo
    // viaja para marcadores visibles: un enemigo a la vista muestra su barra
    // de vida (decisión de producto), uno oculto o sin revelar ni se envía.
    hp: Number.isInteger(row.combatant_hp) ? row.combatant_hp : null,
    hpMax: Number.isInteger(row.combatant_hp_max) ? row.combatant_hp_max : null,
    // Jefe (personaje kind='boss') enlazado, si lo hay: se pinta con su
    // avatar en vez del marcador genérico. Sin jefe, un monstruo del
    // compendio usa la imagen personalizada que el DM le puso en el bestiario
    characterId: forPlayer ? undefined : row.character_id ?? null,
    avatarUrl: row.boss_avatar_path ?? row.monster_avatar_path ?? null,
    // Igual que en la puerta: skill público (sabes qué tiras), dc secreto
    // hasta resolver el intento de interactuar (trampa/objeto).
    skill: row.skill ?? null,
    dc: forPlayer ? undefined : row.dc ?? null,
    // Las dos ramas son notas privadas de preparación del DM. La ruta de
    // interacción devuelve al jugador solo la consecuencia ya resuelta.
    successConsequence: forPlayer ? undefined : row.success_consequence ?? '',
    failureConsequence: forPlayer ? undefined : row.failure_consequence ?? '',
    consequenceScope: forPlayer ? undefined : row.consequence_scope ?? 'player',
    // La CD de detección y el alcance de criaturas son herramientas del DM.
    // Una trampa oculta ni siquiera llega al jugador; al descubrirse tampoco
    // se filtra su CD, para no revelar más información de la necesaria.
    perceptionDc: forPlayer ? undefined : row.perception_dc ?? null,
    visionRadius: forPlayer ? undefined : row.vision_radius ?? 6,
    // Variantes por instancia y botín (Fases 17/20): información de DM. El
    // jugador nunca ve los stats retocados de un enemigo ni su botín antes de
    // saquearlo; `hasLoot` sí viaja para poder pintar un marcador saqueable.
    overrides: forPlayer ? undefined : JSON.parse(row.overrides || '{}'),
    loot: forPlayer ? undefined : loot,
    hasLoot: loot.length > 0,
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
    speed: row.speed,
    hp: row.hp_current,
    hpMax: row.hp_max,
    x: row.x,
    y: row.y,
  };
}

function loadCharacterTokens(mapId) {
  return db
    .prepare(
      `SELECT t.*, c.name AS character_name, c.user_id, c.avatar_path, c.speed,
              c.hp_current, c.hp_max, c.darkvision
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
  // Solo PJ: un jefe (kind='boss') asignado por error a una campaña no debe
  // aparecer solo en el tablero como si fuera un personaje jugador — los
  // jefes se colocan a mano en el editor, enlazados a un marcador 'enemigo'.
  const characters = db
    .prepare("SELECT id FROM characters WHERE campaign_id = ? AND kind = 'pj'")
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
    // Pase 1: casillas de aparición marcadas por el DM (Fase 8.8), si las hay
    for (const room of spawnRooms) {
      const spawnCells = JSON.parse(room.spawn_cells || '[]');
      for (const [c, r] of spawnCells) {
        if (placed) break;
        const key = `${room.x + c},${room.y + r}`;
        if (occupied.has(key)) continue;
        insert.run(map.id, character.id, room.id, room.x + c, room.y + r);
        occupied.add(key);
        placed = true;
      }
      if (placed) break;
    }
    if (placed) continue;
    // Pase 2 (respaldo): primera casilla libre de la primera sala revelada
    for (const room of spawnRooms) {
      const disabled = new Set(
        [
          ...JSON.parse(room.disabled_cells || '[]'),
          ...JSON.parse(room.obstacle_cells || '[]'),
        ].map(([c, r]) => `${c},${r}`)
      );
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

// Al revelarse salas del mapa activo, sus enemigos visibles entran al
// tracker de iniciativa (una sola vez por marcador, enlazados por
// map_token_id). HP y CA salen del compendio SRD si el marcador tiene
// monster_index. Devuelve cuántos combatientes se añadieron.
export function spawnRoomEnemies(campaignId, roomIds) {
  if (!roomIds.length) return 0;
  const placeholders = roomIds.map(() => '?').join(', ');
  const enemies = db
    .prepare(
      `SELECT * FROM map_tokens WHERE room_id IN (${placeholders})
       AND kind = 'enemigo' AND hidden = 0`
    )
    .all(...roomIds);
  if (!enemies.length) return 0;

  const already = new Set(
    db
      .prepare('SELECT map_token_id FROM combatants WHERE campaign_id = ? AND map_token_id IS NOT NULL')
      .all(campaignId)
      .map((r) => r.map_token_id)
  );
  const insert = db.prepare(
    `INSERT INTO combatants (campaign_id, kind, name, initiative, hp_current, hp_max, ac,
     monster_index, map_token_id, overrides, initiative_source, initiative_d20, initiative_mod)
     VALUES (?, 'enemigo', ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?)`
  );

  let added = 0;
  for (const enemy of enemies) {
    if (already.has(enemy.id)) continue;
    let hp = null;
    let ac = null;
    if (enemy.character_id) {
      // Jefe (ficha completa del DM): sus stats mandan sobre el compendio.
      // Entra a plena vida (hp_max), como cualquier monstruo del SRD.
      const boss = db.prepare('SELECT hp_max, ac FROM characters WHERE id = ?').get(enemy.character_id);
      if (boss) {
        hp = boss.hp_max;
        ac = boss.ac;
      }
    }
    if (hp == null && enemy.monster_index) {
      const entry = db
        .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
        .get(enemy.monster_index);
      if (entry) {
        try {
          const data = JSON.parse(entry.data);
          hp = Number.isInteger(data.hit_points) ? data.hit_points : null;
          ac = Array.isArray(data.armor_class)
            ? data.armor_class[0]?.value ?? null
            : Number.isInteger(data.armor_class)
              ? data.armor_class
              : null;
        } catch {
          // sin estadísticas: el DM las pone a mano
        }
      }
    }
    // Variante por instancia (miniboss, Fase 17): los stats de ESTE marcador
    // mandan sobre el jefe/SRD. Se copian al combatiente para que el bloque
    // de estadísticas del DM aplique también los deltas de ataque/daño.
    const overrides = JSON.parse(enemy.overrides || '{}');
    if (Number.isInteger(overrides.hp)) hp = overrides.hp;
    if (Number.isInteger(overrides.ac)) ac = overrides.ac;

    // Iniciativa tirada sola (1d20+DES del monstruo), como cualquier otro
    // combatiente que se une con el modo por turnos activo. Se guarda el
    // desglose y el origen 'auto': sin ellos el tracker mostraría a estos
    // enemigos como «sin tirar» pese a tener iniciativa, y «respetar las
    // existentes» al abrir el combate volvería a tirar por ellos.
    const roll = rollInitiativeDetailed({ kind: 'enemigo', monster_index: enemy.monster_index });
    insert.run(
      campaignId,
      enemy.name,
      roll.total,
      hp,
      hp,
      ac,
      enemy.monster_index,
      enemy.id,
      enemy.overrides || '{}',
      roll.d20,
      roll.modifier
    );
    added += 1;
  }
  let startedCombat = false;
  if (added > 0) {
    // Encuentro nuevo: si la mesa había vuelto a modo libre (p. ej. tras
    // caer el último enemigo), un enemigo nuevo reactiva los turnos con
    // iniciativas frescas; si ya estaba en turnos, solo arranca si no había orden
    const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
    if (!table?.combat_active) {
      activateTurnMode(campaignId);
      startedCombat = true;
    } else {
      ensureTurnStarted(campaignId);
    }
  }
  // startedCombat: el combate estaba en modo libre y estos enemigos lo
  // reactivaron → quien llama lanza el aviso (cartel + chat).
  return { added, startedCombat };
}

function loadMapContents(map) {
  const floors = db
    .prepare('SELECT * FROM map_floors WHERE map_id = ? ORDER BY position, id')
    .all(map.id);
  const rooms = db
    .prepare(
      `SELECT r.* FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id
       WHERE f.map_id = ? ORDER BY r.id`
    )
    .all(map.id);
  const doors = db.prepare('SELECT * FROM map_doors WHERE map_id = ? ORDER BY id').all(map.id);
  // El HP de los enemigos llega del combatiente enlazado del tracker; si el
  // marcador está enlazado a un jefe (personaje kind='boss'), se trae su
  // avatar, y si es un monstruo del compendio, la imagen personalizada que
  // el DM de la campaña le haya puesto en el bestiario
  const tokens = db
    .prepare(
      `SELECT t.*, cb.hp_current AS combatant_hp, cb.hp_max AS combatant_hp_max,
              boss.avatar_path AS boss_avatar_path,
              mi.avatar_path AS monster_avatar_path
       FROM map_tokens t
       JOIN map_rooms r ON r.id = t.room_id
       JOIN map_floors f ON f.id = r.floor_id
       LEFT JOIN combatants cb ON cb.map_token_id = t.id AND cb.campaign_id = ?
       LEFT JOIN characters boss ON boss.id = t.character_id
       LEFT JOIN campaigns cp ON cp.id = ?
       LEFT JOIN monster_images mi ON mi.user_id = cp.dm_user_id AND mi.monster_idx = t.monster_index
       WHERE f.map_id = ? ORDER BY t.id`
    )
    .all(map.campaign_id, map.campaign_id, map.id);
  return { floors, rooms, doors, tokens };
}

// Vista completa del DM: todas las salas, notas, puertas y marcadores
export function serializeFullMap(map, campaignId) {
  const { floors, rooms, doors, tokens } = loadMapContents(map);
  return {
    id: map.id,
    name: map.name,
    gridSize: map.grid_size,
    visionMode: map.vision_mode,
    visionRadius: map.vision_radius,
    wallColor: map.wall_color,
    wallLightEvery: map.wall_light_every,
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
// que tocan una sala visible, siempre que no sean de control del DM aún
// cerradas (una puerta secreta cerrada no existe para el jugador). La sala
// donde está un personaje del propio usuario siempre es visible para él,
// aunque el DM la tenga sin revelar: nunca pierdes de vista a tu personaje.
export function serializeMapForPlayer(map, userId) {
  const { floors, rooms, doors, tokens } = loadMapContents(map);
  const characterTokens = loadCharacterTokens(map.id);
  const visible = new Set(rooms.filter((r) => r.revealed).map((r) => r.id));
  for (const t of characterTokens) {
    if (t.user_id === userId) visible.add(t.room_id);
  }
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  // Niebla fina: con visión 'compartida' o 'individual', dentro de las
  // salas visibles solo se ve lo que alcanzan los tokens (la del grupo o
  // solo los del propio usuario). La visión nunca añade salas: solo recorta.
  // Sin tokens propios (espectador), se ve a nivel de sala.
  // userId null = vista previa del DM ("ver como jugador"): visión del
  // grupo entero, sin sala propia añadida
  const viewers =
    map.vision_mode === 'compartida' || (map.vision_mode === 'individual' && userId == null)
      ? characterTokens
      : map.vision_mode === 'individual'
        ? characterTokens.filter((t) => t.user_id === userId)
        : [];
  const useFog = (map.vision_mode === 'compartida' || map.vision_mode === 'individual') && viewers.length > 0;

  let visionByFloor = null;
  if (useFog) {
    visionByFloor = new Map();
    for (const floor of floors) {
      const floorRooms = rooms.filter((r) => r.floor_id === floor.id && visible.has(r.id));
      const floorViewers = viewers.filter(
        (t) => roomById.get(t.room_id)?.floor_id === floor.id
      );
      if (!floorRooms.length || !floorViewers.length) {
        visionByFloor.set(floor.id, new Set());
        continue;
      }
      // Puertas cuyos extremos tocan alguna sala visible de esta planta: sus
      // aristas abren o cierran el muro para el cálculo de la línea de visión.
      const floorRoomIds = new Set(floorRooms.map((r) => r.id));
      const floorDoors = doors.filter(
        (d) => floorRoomIds.has(d.from_room_id) || floorRoomIds.has(d.to_room_id)
      );
      visionByFloor.set(
        floor.id,
        computeFloorVision({
          rooms: floorRooms,
          doors: floorDoors,
          viewers: floorViewers.map((t) => ({
            x: t.x,
            y: t.y,
            radius: Math.max(map.vision_radius, t.darkvision || 0),
          })),
        })
      );
    }
  }

  const cellVisible = (roomId, x, y) => {
    if (!useFog) return true;
    const room = roomById.get(roomId);
    return visionByFloor.get(room.floor_id)?.has(`${x},${y}`) ?? false;
  };

  // Con niebla, las casillas de la sala fuera de visión viajan como
  // desactivadas (el cliente las pinta como vacío); una sala sin ninguna
  // casilla visible no se envía.
  const serializeFoggedRoom = (room) => {
    const base = serializeRoom(room, { forPlayer: true });
    if (!useFog) return base;
    const vision = visionByFloor.get(room.floor_id) ?? new Set();
    const disabled = new Set(base.disabledCells.map(([c, r]) => `${c},${r}`));
    let anyVisible = false;
    for (let r = 0; r < room.height; r += 1) {
      for (let c = 0; c < room.width; c += 1) {
        if (disabled.has(`${c},${r}`)) continue;
        if (vision.has(`${room.x + c},${room.y + r}`)) anyVisible = true;
        else disabled.add(`${c},${r}`);
      }
    }
    if (!anyVisible) return null;
    return {
      ...base,
      disabledCells: [...disabled].map((entry) => entry.split(',').map(Number)),
    };
  };

  return {
    id: map.id,
    name: map.name,
    gridSize: map.grid_size,
    wallColor: map.wall_color,
    wallLightEvery: map.wall_light_every,
    floors: floors.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      rooms: rooms
        .filter((r) => r.floor_id === f.id && visible.has(r.id))
        .map(serializeFoggedRoom)
        .filter(Boolean),
    })),
    doors: doors
      .filter(
        (d) =>
          (visible.has(d.from_room_id) || visible.has(d.to_room_id)) &&
          (d.control === 'jugador' || d.is_open) &&
          (cellVisible(d.from_room_id, d.from_x, d.from_y) ||
            cellVisible(d.to_room_id, d.to_x, d.to_y))
      )
      .map((d) => serializeDoor(d, { forPlayer: true })),
    // Un marcador oculto (trampa, tesoro) no existe para el jugador aunque
    // la sala esté visible; con niebla, tampoco los que quedan fuera de visión
    tokens: tokens
      .filter((t) => visible.has(t.room_id) && !t.hidden && cellVisible(t.room_id, t.x, t.y))
      .map((t) => serializeToken(t, { forPlayer: true })),
    characterTokens: characterTokens
      .filter(
        (t) =>
          visible.has(t.room_id) &&
          (t.user_id === userId || cellVisible(t.room_id, t.x, t.y))
      )
      .map(serializeCharacterToken),
  };
}
