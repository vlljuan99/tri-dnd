import { cellKey } from './cells.js';

// Convierte una planta del mapa multi-sala (Fase 7.5) en el tablero único
// que espera el renderizador 3D: un rectángulo que envuelve las salas
// visibles, con las casillas que no pertenecen a ninguna sala desactivadas.
// El servidor ya filtró lo que este usuario puede ver: aquí solo se compone.
export function composeBoardFromMap(map, preferredFloorId) {
  if (!map) return null;
  const floorsWithRooms = map.floors.filter((f) => f.rooms.length > 0);
  const floor =
    floorsWithRooms.find((f) => f.id === preferredFloorId) ?? floorsWithRooms[0] ?? null;
  if (!floor) return null;

  const rooms = floor.rooms;
  const minX = Math.min(...rooms.map((r) => r.x));
  const minY = Math.min(...rooms.map((r) => r.y));
  const maxX = Math.max(...rooms.map((r) => r.x + r.width));
  const maxY = Math.max(...rooms.map((r) => r.y + r.height));
  const cols = maxX - minX;
  const rows = maxY - minY;

  const enabled = new Set();
  for (const room of rooms) {
    const disabled = new Set(room.disabledCells.map(([c, r]) => cellKey(c, r)));
    for (let r = 0; r < room.height; r += 1) {
      for (let c = 0; c < room.width; c += 1) {
        if (disabled.has(cellKey(c, r))) continue;
        enabled.add(cellKey(room.x + c - minX, room.y + r - minY));
      }
    }
  }

  const disabledCells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!enabled.has(cellKey(col, row))) disabledCells.push([col, row]);
    }
  }

  // Puertas con al menos un extremo en una sala visible de esta planta: un
  // marcador por extremo visible, en coordenadas del tablero compuesto.
  // (El servidor ya decidió qué puertas puede ver este usuario.)
  const roomIds = new Set(rooms.map((r) => r.id));
  const doors = [];
  for (const door of map.doors ?? []) {
    const sides = [];
    if (roomIds.has(door.fromRoomId)) sides.push({ x: door.fromX, y: door.fromY });
    if (roomIds.has(door.toRoomId)) sides.push({ x: door.toX, y: door.toY });
    for (const side of sides) {
      doors.push({
        id: door.id,
        kind: door.kind,
        control: door.control,
        isOpen: door.isOpen,
        col: side.x - minX,
        row: side.y - minY,
      });
    }
  }

  // Marcadores preparados (el servidor ya filtró ocultos y salas sin
  // revelar según el rol), convertidos a tokens del tablero
  const TOKEN_TYPES = { enemigo: 'enemy', aliado: 'ally', objeto: 'npc', trampa: 'npc' };
  const TOKEN_COLORS = { enemigo: '#8c2f2f', aliado: '#4a8bd6', objeto: '#b9862f', trampa: '#7a4b9c' };
  const serverTokens = (map.tokens ?? [])
    .filter((t) => roomIds.has(t.roomId))
    .map((t) => ({
      id: `srv-${t.id}`,
      serverId: t.id,
      name: t.hidden ? `${t.name} (oculto)` : t.name,
      color: TOKEN_COLORS[t.kind] ?? TOKEN_COLORS.enemigo,
      position: {
        x: (t.x - minX + 0.5) * map.gridSize,
        y: 0,
        z: (t.y - minY + 0.5) * map.gridSize,
      },
      size: 1,
      type: TOKEN_TYPES[t.kind] ?? 'enemy',
      hp: Number.isInteger(t.hp) ? t.hp : null,
      hpMax: Number.isInteger(t.hpMax) ? t.hpMax : null,
      visible: true,
    }));

  // Tokens de personaje persistidos (el servidor ya ocultó al jugador los
  // que están en salas sin revelar)
  const characterTokens = (map.characterTokens ?? [])
    .filter((t) => roomIds.has(t.roomId))
    .map((t) => ({
      id: `pj-${t.characterId}`,
      characterId: t.characterId,
      name: t.name,
      speed: t.speed,
      hp: Number.isInteger(t.hp) ? t.hp : null,
      hpMax: Number.isInteger(t.hpMax) ? t.hpMax : null,
      color: '#4a8bd6',
      imageUrl: t.avatarUrl || undefined,
      position: {
        x: (t.x - minX + 0.5) * map.gridSize,
        y: 0,
        z: (t.y - minY + 0.5) * map.gridSize,
      },
      size: 1,
      type: 'player',
      ownerUserId: t.ownerUserId,
      visible: true,
    }));

  return {
    doors,
    serverTokens,
    characterTokens,
    name: map.name,
    floorId: floor.id,
    floorName: floor.name,
    // Plantas con algo visible para este usuario: pestañas del tablero
    floors: floorsWithRooms.map((f) => ({ id: f.id, name: f.name })),
    width: cols * map.gridSize,
    height: rows * map.gridSize,
    gridSize: map.gridSize,
    disabledCells,
    // Salas en coordenadas del tablero compuesto, cada una con su propio
    // suelo (imagen o color); el renderizador pinta una a una
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      col: r.x - minX,
      row: r.y - minY,
      width: r.width,
      height: r.height,
      backgroundUrl: r.backgroundUrl || null,
      disabledCells: r.disabledCells,
      obstacleCells: r.obstacleCells ?? [],
      // Solo el DM recibe salas sin revelar: se pintan atenuadas
      revealed: r.revealed !== false,
    })),
    // Origen de la planta que ocupa la casilla (0,0) del tablero compuesto,
    // por si hace falta volver a coordenadas absolutas del editor
    origin: { x: minX, y: minY },
  };
}
