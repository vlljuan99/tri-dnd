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

// Conjunto de aristas con pared en coordenadas absolutas de la planta, a
// partir de filas crudas de map_rooms. Claves canónicas sobre las líneas de
// la cuadrícula: 'h:x,y' es el borde horizontal entre (x, y-1) y (x, y);
// 'v:x,y' el borde vertical entre (x-1, y) y (x, y). Así la misma pared se
// encuentra igual desde cualquiera de las dos casillas que separa.
export function buildWallSet(rooms) {
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
