// Movimiento por camino real (estilo Baldur's Gate): Dijkstra sobre las
// casillas pisables de una planta, con coste por casilla (terreno difícil).
// Entrar en una casilla normal cuesta 1; en una de terreno difícil, su
// coste. Diagonales al mismo coste que ortogonales (regla simplificada de
// 5e, la misma Chebyshev que ya usaba el tablero). Subir de nivel (elevación)
// añade coste extra por paso. El cliente replica este algoritmo para la vista
// previa; la validación de verdad es esta.

import { wallBlocksStep } from './walls.js';

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

// Nivel de elevación por casilla absoluta (clave "x,y" → nivel entero). Las
// casillas sin elevar quedan fuera (se tratan como nivel 0). Si dos salas
// solapan, gana la más alta (borde de plataforma).
export function buildElevationMap(rooms) {
  const elevation = new Map();
  for (const room of rooms) {
    for (const [c, r, level] of JSON.parse(room.elevation_cells || '[]')) {
      const key = `${room.x + c},${room.y + r}`;
      const lvl = Math.trunc(Number(level) || 0);
      elevation.set(key, Math.max(elevation.get(key) ?? -Infinity, lvl));
    }
  }
  return elevation;
}

// Coste extra de un paso por subir de nivel: cada nivel que se sube (5 pies)
// cuesta 1 casilla más de movimiento (escalar); bajar no cuesta extra.
function climbCost(elevation, fromKey, toKey) {
  if (!elevation || elevation.size === 0) return 0;
  const from = elevation.get(fromKey) ?? 0;
  const to = elevation.get(toKey) ?? 0;
  return Math.max(0, to - from);
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// Coste del camino más barato entre dos casillas absolutas sobre el grid
// pisable. Devuelve un entero o null si no hay camino (o excede maxCost).
// Dijkstra con cola de cubos por coste entero: los costes son pequeños
// (1..10) y los tableros modestos, sobra rendimiento. `walls` (opcional) es
// el Set de buildWallSet: las aristas con pared cortan el paso entre
// casillas vecinas aunque ambas sean pisables. `elevation` (opcional) es el
// Map de buildElevationMap: subir de nivel añade coste al paso.
export function findPath(walkable, from, to, maxCost = 100, walls = null, elevation = null) {
  const fromKey = `${from.x},${from.y}`;
  const toKey = `${to.x},${to.y}`;
  if (fromKey === toKey) return { cost: 0, path: [] };
  if (!walkable.has(toKey)) return null;
  // El origen puede no estar en el grid (p. ej. el token quedó sobre una
  // casilla luego editada): se permite salir de él igualmente.

  const dist = new Map([[fromKey, 0]]);
  const previous = new Map();
  const buckets = [[fromKey]];
  for (let cost = 0; cost < buckets.length && cost <= maxCost; cost += 1) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const key of bucket) {
      if (dist.get(key) !== cost) continue; // entrada obsoleta
      if (key === toKey) {
        const path = [];
        let cursor = toKey;
        while (cursor !== fromKey) {
          const [x, y] = cursor.split(',').map(Number);
          path.unshift({ x, y });
          cursor = previous.get(cursor);
          if (!cursor) return null;
        }
        return { cost, path };
      }
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of NEIGHBORS) {
        const nKey = `${x + dx},${y + dy}`;
        const enterCost = walkable.get(nKey);
        if (enterCost === undefined) continue;
        if (wallBlocksStep(walls, x, y, x + dx, y + dy)) continue;
        const next = cost + enterCost + climbCost(elevation, key, nKey);
        if (next > maxCost) continue;
        if (next < (dist.get(nKey) ?? Infinity)) {
          dist.set(nKey, next);
          previous.set(nKey, key);
          (buckets[next] ??= []).push(nKey);
        }
      }
    }
  }
  return null;
}

export function findPathCost(walkable, from, to, maxCost = 100, walls = null, elevation = null) {
  return findPath(walkable, from, to, maxCost, walls, elevation)?.cost ?? null;
}
