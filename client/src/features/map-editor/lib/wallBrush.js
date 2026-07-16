const SIDES = new Set(['n', 'e', 's', 'o']);

// Clave absoluta de una arista. La misma pared obtiene la misma clave aunque
// se describa desde cualquiera de las dos casillas que separa.
export function canonicalWallEdge(x, y, side) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !SIDES.has(side)) return null;
  if (side === 'n') return `h:${x},${y}`;
  if (side === 's') return `h:${x},${y + 1}`;
  if (side === 'o') return `v:${x},${y}`;
  return `v:${x + 1},${y}`;
}

export function roomWallEdgeKey(room, [col, row, side]) {
  return canonicalWallEdge(room.x + col, room.y + row, side);
}

export function collectWallKeys(rooms) {
  const keys = new Set();
  for (const room of rooms) {
    for (const edge of room.wallEdges ?? []) {
      const key = roomWallEdgeKey(room, edge);
      if (key) keys.add(key);
    }
  }
  return keys;
}

// El lado más cercano dentro de una casilla, con una pequeña histéresis de
// orientación. Al pasar justo por una esquina evita que un trazo horizontal
// genere dientes verticales (y viceversa), pero permite girar deliberadamente.
export function nearestWallSide(offsetX, offsetY, preferredSide = null) {
  const distances = [
    ['o', offsetX],
    ['e', 1 - offsetX],
    ['n', offsetY],
    ['s', 1 - offsetY],
  ].sort((left, right) => left[1] - right[1]);
  if (!preferredSide) return distances[0][0];

  const preferredHorizontal = preferredSide === 'n' || preferredSide === 's';
  const preferred = distances.find(([side]) => (side === 'n' || side === 's') === preferredHorizontal);
  return preferred[1] <= distances[0][1] + 0.12 ? preferred[0] : distances[0][0];
}

// Muestras intermedias para que un movimiento rápido del puntero no deje
// huecos entre dos eventos pointermove. Incluye el destino, no el origen.
export function samplePointerSegment(from, to, maxStep) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, maxStep)));
  return Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  });
}

function sameEdges(left, right) {
  return (
    left.length === right.length &&
    left.every((edge, index) =>
      edge.length === right[index]?.length && edge.every((value, part) => value === right[index][part])
    )
  );
}

// Aplica un trazo completo sobre una copia de las paredes de las salas.
// Solo devuelve las salas que realmente cambian. Para cada arista tocada:
// - pintar conserva una única representación canónica;
// - borrar elimina todas sus representaciones equivalentes.
export function applyWallStroke(rooms, targets, operation) {
  if (operation !== 'add' && operation !== 'remove') return [];

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const targetByKey = new Map();
  for (const target of targets ?? []) {
    if (!roomById.has(target.roomId)) continue;
    const key = canonicalWallEdge(target.x, target.y, target.side);
    if (key && !targetByKey.has(key)) targetByKey.set(key, target);
  }
  if (!targetByKey.size) return [];

  const touchedKeys = new Set(targetByKey.keys());
  const retainedKeys = new Set();
  const nextByRoom = new Map();

  for (const room of rooms) {
    const next = [];
    for (const edge of room.wallEdges ?? []) {
      const key = roomWallEdgeKey(room, edge);
      if (!touchedKeys.has(key)) {
        next.push(edge);
        continue;
      }
      if (operation === 'add' && !retainedKeys.has(key)) {
        next.push(edge);
        retainedKeys.add(key);
      }
    }
    nextByRoom.set(room.id, next);
  }

  if (operation === 'add') {
    for (const [key, target] of targetByKey) {
      if (retainedKeys.has(key)) continue;
      const room = roomById.get(target.roomId);
      nextByRoom.get(room.id).push([target.x - room.x, target.y - room.y, target.side]);
      retainedKeys.add(key);
    }
  }

  return rooms.flatMap((room) => {
    const next = nextByRoom.get(room.id);
    return sameEdges(room.wallEdges ?? [], next) ? [] : [{ roomId: room.id, wallEdges: next }];
  });
}
