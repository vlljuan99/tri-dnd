import { buildBoardWalls, wallBlocksStep } from './walls.js';
import { fluidTypeAtBoardCell, normalizeFluidEffects } from './fluids.js';

const key = (x, y) => `${x},${y}`;

function lineBlocked(x0, y0, x1, y1, blocksSight, walls) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  while (!(x === x1 && y === y1)) {
    const px = x;
    const py = y;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (wallBlocksStep(walls, px, py, x, y)) return true;
    if (!(x === x1 && y === y1) && blocksSight(x, y)) return true;
  }
  return false;
}

function boardSightContext(map) {
  const cols = Math.floor(map.width / map.gridSize);
  const rows = Math.floor(map.height / map.gridSize);
  const disabled = new Set((map.disabledCells ?? []).map(([x, y]) => key(x, y)));
  const existing = new Set();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) if (!disabled.has(key(x, y))) existing.add(key(x, y));
  }
  const obstacles = new Set();
  for (const room of map.rooms ?? []) {
    for (const [x, y] of room.obstacleCells ?? []) obstacles.add(key(room.col + x, room.row + y));
  }
  return {
    existing,
    blocksSight: (x, y) => obstacles.has(key(x, y)) || !existing.has(key(x, y)),
    walls: buildBoardWalls(map),
  };
}

export function hasBoardLineOfSight(map, from, to) {
  if (!map || !from || !to) return false;
  const context = boardSightContext(map);
  if (!context.existing.has(key(from.col, from.row)) || !context.existing.has(key(to.col, to.row))) return false;
  return !lineBlocked(from.col, from.row, to.col, to.row, context.blocksSight, context.walls);
}

/**
 * Casillas a las que se llega en línea recta desde `origin` dentro de `radius`,
 * ya recortadas por muros, columnas y huecos: detrás de un obstáculo queda su
 * sombra. Es la base tanto de la previsualización de visión como del alcance
 * de un arma a distancia, que es la misma pregunta ("¿qué alcanzo desde aquí?")
 * hecha con otro radio.
 *
 * Se devuelven casillas {col,row}: es lo que consumen los overlays del tablero.
 * Con pares [x,y] la previsualización se pintaba en posiciones NaN, es decir,
 * no se veía.
 */
export function cellsWithinSight(map, origin, radius) {
  if (!map || !origin || !Number.isInteger(origin.col) || !Number.isInteger(origin.row)) return [];
  const limit = Math.max(0, Math.min(60, radius ?? 0));
  const { existing, blocksSight, walls } = boardSightContext(map);
  const visible = [];
  for (let row = origin.row - limit; row <= origin.row + limit; row += 1) {
    for (let col = origin.col - limit; col <= origin.col + limit; col += 1) {
      if (!existing.has(key(col, row))) continue;
      if (!lineBlocked(origin.col, origin.row, col, row, blocksSight, walls)) visible.push({ col, row });
    }
  }
  return visible;
}

// Espejo visual de server/src/services/vision.js. No decide qué datos puede
// ver un jugador: el alcance solo llega al DM y esta función únicamente pinta
// la previsualización de una criatura ya recibida.
export function computeBoardVision(map, viewer) {
  if (!map || !viewer || !Number.isInteger(viewer.col) || !Number.isInteger(viewer.row)) return [];
  const normalRadius = Math.max(1, Math.min(30, viewer.radius ?? 6));
  const fluidType = fluidTypeAtBoardCell(map, viewer.col, viewer.row);
  const fluidRadius = fluidType
    ? normalizeFluidEffects(map.fluidEffects)[fluidType]?.visionRadius
    : null;
  return cellsWithinSight(map, viewer, fluidRadius ? Math.min(normalRadius, fluidRadius) : normalRadius);
}
