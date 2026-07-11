import { cellKey } from './cells.js';

// Movimiento por camino real (estilo Baldur's Gate): espejo cliente del
// Dijkstra de server/src/services/pathfinding.js, operando en coordenadas
// del tablero compuesto (col/fila). El cliente lo usa para la vista previa
// (camino + coste antes de confirmar) y el área verde de alcance; la
// validación de verdad la hace el servidor con el mismo algoritmo.

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// Casillas pisables del tablero compuesto: clave "col,fila" → coste de
// entrar (1 normal, 2+ terreno difícil). Fuera quedan casillas
// desactivadas y obstáculos, igual que en el servidor.
export function buildBoardWalkable(map) {
  const walkable = new Map();
  for (const room of map.rooms ?? []) {
    const blocked = new Set(
      [...(room.disabledCells ?? []), ...(room.obstacleCells ?? [])].map(([c, r]) => cellKey(c, r))
    );
    const terrain = new Map(
      (room.terrainCells ?? []).map(([c, r, cost]) => [cellKey(c, r), Math.max(1, Math.min(10, Number(cost) || 2))])
    );
    for (let r = 0; r < room.height; r += 1) {
      for (let c = 0; c < room.width; c += 1) {
        if (blocked.has(cellKey(c, r))) continue;
        const key = cellKey(room.col + c, room.row + r);
        const cost = terrain.get(cellKey(c, r)) ?? 1;
        walkable.set(key, Math.min(walkable.get(key) ?? Infinity, cost));
      }
    }
  }
  return walkable;
}

// Camino más barato entre dos casillas. Devuelve { cost, path } (path
// incluye el destino, no el origen) o null si no hay camino dentro de maxCost.
export function findBoardPath(walkable, from, to, maxCost = 150) {
  const fromKey = cellKey(from.col, from.row);
  const toKey = cellKey(to.col, to.row);
  if (fromKey === toKey) return { cost: 0, path: [] };
  if (!walkable.has(toKey)) return null;

  const dist = new Map([[fromKey, 0]]);
  const prev = new Map();
  const buckets = [[fromKey]];
  for (let cost = 0; cost < buckets.length && cost <= maxCost; cost += 1) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const key of bucket) {
      if (dist.get(key) !== cost) continue;
      if (key === toKey) {
        const path = [];
        for (let k = toKey; k !== fromKey; k = prev.get(k)) {
          const [col, row] = k.split(',').map(Number);
          path.unshift({ col, row });
        }
        return { cost, path };
      }
      const [col, row] = key.split(',').map(Number);
      for (const [dc, dr] of NEIGHBORS) {
        const nKey = cellKey(col + dc, row + dr);
        const enterCost = walkable.get(nKey);
        if (enterCost === undefined) continue;
        const next = cost + enterCost;
        if (next > maxCost) continue;
        if (next < (dist.get(nKey) ?? Infinity)) {
          dist.set(nKey, next);
          prev.set(nKey, key);
          (buckets[next] ??= []).push(nKey);
        }
      }
    }
  }
  return null;
}

// Casillas alcanzables con un presupuesto dado (área verde del combatiente
// activo), contando el coste real de cada casilla, no la distancia en línea.
export function reachableWithin(walkable, from, budget) {
  const fromKey = cellKey(from.col, from.row);
  const dist = new Map([[fromKey, 0]]);
  const buckets = [[fromKey]];
  const cells = [];
  for (let cost = 0; cost < buckets.length && cost <= budget; cost += 1) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const key of bucket) {
      if (dist.get(key) !== cost) continue;
      if (key !== fromKey) {
        const [col, row] = key.split(',').map(Number);
        cells.push({ col, row });
      }
      const [col, row] = key.split(',').map(Number);
      for (const [dc, dr] of NEIGHBORS) {
        const nKey = cellKey(col + dc, row + dr);
        const enterCost = walkable.get(nKey);
        if (enterCost === undefined) continue;
        const next = cost + enterCost;
        if (next > budget) continue;
        if (next < (dist.get(nKey) ?? Infinity)) {
          dist.set(nKey, next);
          (buckets[next] ??= []).push(nKey);
        }
      }
    }
  }
  return cells;
}
