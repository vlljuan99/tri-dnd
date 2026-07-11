// Movimiento por camino real (estilo Baldur's Gate): Dijkstra sobre las
// casillas pisables de una planta, con coste por casilla (terreno difícil).
// Entrar en una casilla normal cuesta 1; en una de terreno difícil, su
// coste. Diagonales al mismo coste que ortogonales (regla simplificada de
// 5e, la misma Chebyshev que ya usaba el tablero). El cliente replica este
// algoritmo para la vista previa; la validación de verdad es esta.

// Construye el mapa de casillas pisables de un conjunto de salas (filas
// crudas de map_rooms): clave "x,y" absoluta → coste de entrar. Quedan
// fuera las casillas desactivadas y los obstáculos; si dos salas se
// solapan en una casilla, gana el coste más barato.
export function buildWalkableGrid(rooms) {
  const walkable = new Map();
  for (const room of rooms) {
    const disabled = new Set(
      [...JSON.parse(room.disabled_cells || '[]'), ...JSON.parse(room.obstacle_cells || '[]')].map(
        ([c, r]) => `${c},${r}`
      )
    );
    const terrain = new Map(
      JSON.parse(room.terrain_cells || '[]').map(([c, r, cost]) => [
        `${c},${r}`,
        Math.max(1, Math.min(10, Number(cost) || 2)),
      ])
    );
    for (let r = 0; r < room.height; r += 1) {
      for (let c = 0; c < room.width; c += 1) {
        if (disabled.has(`${c},${r}`)) continue;
        const key = `${room.x + c},${room.y + r}`;
        const cost = terrain.get(`${c},${r}`) ?? 1;
        walkable.set(key, Math.min(walkable.get(key) ?? Infinity, cost));
      }
    }
  }
  return walkable;
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// Coste del camino más barato entre dos casillas absolutas sobre el grid
// pisable. Devuelve un entero o null si no hay camino (o excede maxCost).
// Dijkstra con cola de cubos por coste entero: los costes son pequeños
// (1..10) y los tableros modestos, sobra rendimiento.
export function findPathCost(walkable, from, to, maxCost = 100) {
  const fromKey = `${from.x},${from.y}`;
  const toKey = `${to.x},${to.y}`;
  if (fromKey === toKey) return 0;
  if (!walkable.has(toKey)) return null;
  // El origen puede no estar en el grid (p. ej. el token quedó sobre una
  // casilla luego editada): se permite salir de él igualmente.

  const dist = new Map([[fromKey, 0]]);
  const buckets = [[fromKey]];
  for (let cost = 0; cost < buckets.length && cost <= maxCost; cost += 1) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const key of bucket) {
      if (dist.get(key) !== cost) continue; // entrada obsoleta
      if (key === toKey) return cost;
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of NEIGHBORS) {
        const nKey = `${x + dx},${y + dy}`;
        const enterCost = walkable.get(nKey);
        if (enterCost === undefined) continue;
        const next = cost + enterCost;
        if (next > maxCost) continue;
        if (next < (dist.get(nKey) ?? Infinity)) {
          dist.set(nKey, next);
          (buckets[next] ??= []).push(nKey);
        }
      }
    }
  }
  return null;
}
