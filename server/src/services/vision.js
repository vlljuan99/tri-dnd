// Línea de visión sobre la cuadrícula (Fase 8, niebla fina). Todo en
// casillas absolutas del lienzo de una planta: las paredes (casillas que no
// pertenecen a ninguna sala o desactivadas), los obstáculos y las paredes
// por arista (v29) bloquean la visión; un obstáculo se ve a sí mismo pero
// tapa lo que hay detrás.

import { buildWallSet, wallBlocksStep } from './walls.js';

const key = (x, y) => `${x},${y}`;

// Recorre la línea de Bresenham paso a paso: bloqueada si algún paso cruza
// una arista con pared, o si alguna casilla intermedia tapa la visión (el
// destino puede ser un obstáculo y verse igualmente).
function sightBlocked(x0, y0, x1, y1, blocksSight, walls) {
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

/**
 * Calcula las casillas visibles de UNA planta.
 * - rooms: filas de map_rooms de esa planta (con disabled/obstacle_cells)
 * - viewers: [{ x, y, radius }] posiciones y alcance de cada token que ve
 *   (distancia de Chebyshev, regla 5e); el radio es por viewer para que la
 *   visión en la oscuridad de un personaje no afecte a los demás
 * Devuelve un Set de 'x,y' absolutas visibles.
 */
export function computeFloorVision({ rooms, viewers, doors = [] }) {
  const existing = new Set();
  const obstacles = new Set();
  for (const room of rooms) {
    const disabled = new Set(
      JSON.parse(room.disabled_cells || '[]').map(([c, r]) => key(c, r))
    );
    for (let r = 0; r < room.height; r += 1) {
      for (let c = 0; c < room.width; c += 1) {
        if (disabled.has(key(c, r))) continue;
        existing.add(key(room.x + c, room.y + r));
      }
    }
    for (const [c, r] of JSON.parse(room.obstacle_cells || '[]')) {
      obstacles.add(key(room.x + c, room.y + r));
    }
  }

  const blocksSight = (x, y) => obstacles.has(key(x, y)) || !existing.has(key(x, y));
  const walls = buildWallSet(rooms, doors);

  const visible = new Set();
  for (const viewer of viewers) {
    const radius = viewer.radius;
    for (let y = viewer.y - radius; y <= viewer.y + radius; y += 1) {
      for (let x = viewer.x - radius; x <= viewer.x + radius; x += 1) {
        const target = key(x, y);
        if (visible.has(target) || !existing.has(target)) continue;
        if (!sightBlocked(viewer.x, viewer.y, x, y, blocksSight, walls)) visible.add(target);
      }
    }
  }
  return visible;
}
