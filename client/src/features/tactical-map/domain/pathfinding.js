import { cellKey } from './cells.js';
import { wallBlocksStep } from './walls.js';

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

// Nivel de elevación por casilla del tablero (clave "col,fila" → nivel). Las
// no elevadas quedan fuera (nivel 0); si dos salas solapan, gana la más alta.
export function buildBoardElevation(map) {
  const elevation = new Map();
  for (const room of map.rooms ?? []) {
    for (const [c, r, level] of room.elevationCells ?? []) {
      const key = cellKey(room.col + c, room.row + r);
      const lvl = Math.trunc(Number(level) || 0);
      elevation.set(key, Math.max(elevation.get(key) ?? -Infinity, lvl));
    }
  }
  return elevation;
}

// Coste extra de un paso por subir de nivel: 1 casilla más por cada nivel que
// se sube (bajar no cuesta extra). Espejo de climbCost del servidor.
function climbCost(elevation, fromKey, toKey) {
  if (!elevation || elevation.size === 0) return 0;
  const from = elevation.get(fromKey) ?? 0;
  const to = elevation.get(toKey) ?? 0;
  return Math.max(0, to - from);
}

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
// incluye el destino, no el origen) o null si no hay camino dentro de
// maxCost. `walls` (opcional): Set de buildBoardWalls, las aristas con
// pared cortan el paso entre casillas vecinas.
//
// Dijkstra por coste (cubos de coste entero) con un desempate secundario:
// entre caminos del MISMO coste se prefiere el que da menos giros, para que
// la ruta salga lo más recta posible en vez de en escalera. Como las
// diagonales cuestan lo mismo que las ortogonales, hay muchísimos caminos
// óptimos y sin este desempate se elegía uno cualquiera (de ahí los zigzags).
// Solo cambia la FORMA del camino, no su coste: el servidor valida el mismo
// coste sin reconstruir la ruta. `elevation` (opcional): subir de nivel
// añade coste al paso, como en el servidor.
export function findBoardPath(walkable, from, to, maxCost = 150, walls = null, elevation = null) {
  const fromKey = cellKey(from.col, from.row);
  const toKey = cellKey(to.col, to.row);
  if (fromKey === toKey) return { cost: 0, path: [] };
  if (!walkable.has(toKey)) return null;

  const dist = new Map([[fromKey, 0]]);
  const turns = new Map([[fromKey, 0]]);
  const dir = new Map(); // key → [dc, dr] del paso con que se llegó (origen: sin dir)
  const prev = new Map();
  const buckets = [[fromKey]];
  let targetCost = null;

  for (let cost = 0; cost < buckets.length && cost <= maxCost; cost += 1) {
    // Los giros de un camino al destino solo llegan de casillas de coste
    // ≤ targetCost; una vez agotado ese cubo, la ruta ya es la más recta
    if (targetCost !== null && cost > targetCost) break;
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const key of bucket) {
      if (dist.get(key) !== cost) continue; // entrada de un coste ya superado
      const [col, row] = key.split(',').map(Number);
      const fromDir = dir.get(key);
      const baseTurns = turns.get(key);
      for (const [dc, dr] of NEIGHBORS) {
        const nKey = cellKey(col + dc, row + dr);
        const enterCost = walkable.get(nKey);
        if (enterCost === undefined) continue;
        if (wallBlocksStep(walls, col, row, col + dc, row + dr)) continue;
        const next = cost + enterCost + climbCost(elevation, key, nKey);
        if (next > maxCost) continue;
        const turned = fromDir && (fromDir[0] !== dc || fromDir[1] !== dr) ? 1 : 0;
        const nextTurns = baseTurns + turned;
        const known = dist.get(nKey);
        const cheaper = known === undefined || next < known;
        const straighter = next === known && nextTurns < turns.get(nKey);
        if (cheaper || straighter) {
          dist.set(nKey, next);
          turns.set(nKey, nextTurns);
          dir.set(nKey, [dc, dr]);
          prev.set(nKey, key);
          if (nKey === toKey && targetCost === null) targetCost = next;
          (buckets[next] ??= []).push(nKey);
        }
      }
    }
  }

  if (!dist.has(toKey)) return null;
  const path = [];
  for (let k = toKey; k !== fromKey; k = prev.get(k)) {
    const [col, row] = k.split(',').map(Number);
    path.unshift({ col, row });
  }
  return { cost: dist.get(toKey), path };
}

// Casillas alcanzables con un presupuesto dado (área verde del combatiente
// activo), contando el coste real de cada casilla, no la distancia en línea.
export function reachableWithin(walkable, from, budget, walls = null, elevation = null) {
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
        if (wallBlocksStep(walls, col, row, col + dc, row + dr)) continue;
        const next = cost + enterCost + climbCost(elevation, key, nKey);
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
