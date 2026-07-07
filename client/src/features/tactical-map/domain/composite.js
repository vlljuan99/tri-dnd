import { cellKey } from './cells.js';

// Convierte una planta del mapa multi-sala (Fase 7.5) en el tablero único
// que espera el renderizador 3D: un rectángulo que envuelve las salas
// visibles, con las casillas que no pertenecen a ninguna sala desactivadas.
// El servidor ya filtró lo que este usuario puede ver: aquí solo se compone.
export function composeBoardFromMap(map) {
  if (!map) return null;
  const floor = map.floors.find((f) => f.rooms.length > 0);
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

  return {
    doors,
    name: map.name,
    floorName: floor.name,
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
    })),
    // Origen de la planta que ocupa la casilla (0,0) del tablero compuesto,
    // por si hace falta volver a coordenadas absolutas del editor
    origin: { x: minX, y: minY },
  };
}
