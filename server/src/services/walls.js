// Paredes por arista de casilla (v29): una pared fina sobre un borde de una
// casilla bloquea el paso y la línea de visión sin quitar la casilla. Este
// módulo comparte la geometría entre pathfinding.js y vision.js; el cliente
// la replica en features/tactical-map/domain/walls.js para la vista previa.

const SIDES = new Set(['n', 'e', 's', 'o']);

export function isValidWallEdges(value) {
  return (
    Array.isArray(value) &&
    value.length <= 4000 &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 3 &&
        Number.isInteger(entry[0]) &&
        Number.isInteger(entry[1]) &&
        entry[0] >= 0 &&
        entry[1] >= 0 &&
        SIDES.has(entry[2])
    )
  );
}

// Arista (clave canónica 'h:x,y' / 'v:x,y') sobre la que se apoya una puerta,
// a partir de una fila cruda de map_doors. Una puerta normal ('puerta') se
// coloca en el borde entre dos casillas ortogonalmente contiguas; de ahí se
// deriva la arista. Escaleras y portales conectan casillas lejanas o de otra
// planta: no son de arista y devuelven null (no tocan el muro).
export function doorEdgeKey(door) {
  if (door.kind !== 'puerta') return null;
  const dx = door.to_x - door.from_x;
  const dy = door.to_y - door.from_y;
  if (dx === 0 && Math.abs(dy) === 1) return `h:${door.from_x},${Math.max(door.from_y, door.to_y)}`;
  if (dy === 0 && Math.abs(dx) === 1) return `v:${Math.max(door.from_x, door.to_x)},${door.from_y}`;
  return null;
}

// Conjunto de aristas que bloquean (paso y visión) en coordenadas absolutas
// de la planta, a partir de filas crudas de map_rooms y (opcional) map_doors.
// Claves canónicas sobre las líneas de la cuadrícula: 'h:x,y' es el borde
// horizontal entre (x, y-1) y (x, y); 'v:x,y' el borde vertical entre
// (x-1, y) y (x, y). Así la misma pared se encuentra igual desde cualquiera
// de las dos casillas que separa. Las puertas de arista modifican el muro:
// una cerrada bloquea por sí sola (aunque no haya pared pintada detrás), una
// abierta abre un hueco (quita la arista aunque hubiera pared).
export function buildWallSet(rooms, doors = []) {
  const walls = new Set();
  for (const room of rooms) {
    for (const [c, r, side] of JSON.parse(room.wall_edges || '[]')) {
      const x = room.x + c;
      const y = room.y + r;
      if (side === 'n') walls.add(`h:${x},${y}`);
      else if (side === 's') walls.add(`h:${x},${y + 1}`);
      else if (side === 'o') walls.add(`v:${x},${y}`);
      else if (side === 'e') walls.add(`v:${x + 1},${y}`);
    }
  }
  for (const door of doors) {
    const edge = doorEdgeKey(door);
    if (!edge) continue;
    if (door.is_open) walls.delete(edge);
    else walls.add(edge);
  }
  return walls;
}

// ¿Bloquea alguna pared el paso directo entre dos casillas adyacentes
// (ortogonal o diagonal)? En diagonal se cruza una esquina: basta con que
// una de las cuatro aristas que tocan esa esquina tenga pared para cortar
// el paso — no se recortan esquinas de muro. La misma regla vale para el
// movimiento y para la línea de visión, así ambos son coherentes.
export function wallBlocksStep(walls, x0, y0, x1, y1) {
  if (!walls || walls.size === 0) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx !== 0 && dy === 0) return walls.has(`v:${Math.max(x0, x1)},${y0}`);
  if (dx === 0 && dy !== 0) return walls.has(`h:${x0},${Math.max(y0, y1)}`);
  // Diagonal: esquina compartida en el punto de cuadrícula (cx, cy)
  const cx = Math.max(x0, x1);
  const cy = Math.max(y0, y1);
  return (
    walls.has(`v:${cx},${cy - 1}`) ||
    walls.has(`v:${cx},${cy}`) ||
    walls.has(`h:${cx - 1},${cy}`) ||
    walls.has(`h:${cx},${cy}`)
  );
}
