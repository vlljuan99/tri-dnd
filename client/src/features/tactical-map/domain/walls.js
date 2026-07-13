// Paredes por arista de casilla: espejo cliente de
// server/src/services/walls.js, operando sobre el tablero compuesto
// (salas con col/row y wallEdges en camelCase). El cliente lo usa para la
// vista previa de movimiento y el área de alcance; la validación de verdad
// la hace el servidor con la misma geometría.

// Claves canónicas sobre las líneas de la cuadrícula: 'h:x,y' es el borde
// horizontal entre (x, y-1) y (x, y); 'v:x,y' el vertical entre (x-1, y) y (x, y).
export function buildBoardWalls(map) {
  const walls = new Set();
  for (const room of map.rooms ?? []) {
    for (const [c, r, side] of room.wallEdges ?? []) {
      const x = room.col + c;
      const y = room.row + r;
      if (side === 'n') walls.add(`h:${x},${y}`);
      else if (side === 's') walls.add(`h:${x},${y + 1}`);
      else if (side === 'o') walls.add(`v:${x},${y}`);
      else if (side === 'e') walls.add(`v:${x + 1},${y}`);
    }
  }
  return walls;
}

// ¿Bloquea alguna pared el paso directo entre dos casillas adyacentes?
// En diagonal basta con que una de las cuatro aristas que tocan la esquina
// cruzada tenga pared (no se recortan esquinas de muro) — la misma regla
// que aplica el servidor a movimiento y línea de visión.
export function wallBlocksStep(walls, x0, y0, x1, y1) {
  if (!walls || walls.size === 0) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx !== 0 && dy === 0) return walls.has(`v:${Math.max(x0, x1)},${y0}`);
  if (dx === 0 && dy !== 0) return walls.has(`h:${x0},${Math.max(y0, y1)}`);
  const cx = Math.max(x0, x1);
  const cy = Math.max(y0, y1);
  return (
    walls.has(`v:${cx},${cy - 1}`) ||
    walls.has(`v:${cx},${cy}`) ||
    walls.has(`h:${cx - 1},${cy}`) ||
    walls.has(`h:${cx},${cy}`)
  );
}
