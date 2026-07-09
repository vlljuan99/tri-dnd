// Línea de visión sobre la cuadrícula (Fase 8, niebla fina). Todo en
// casillas absolutas del lienzo de una planta: las paredes (casillas que no
// pertenecen a ninguna sala o desactivadas) y los obstáculos bloquean la
// visión; un obstáculo se ve a sí mismo pero tapa lo que hay detrás.

const key = (x, y) => `${x},${y}`;

// Casillas intermedias de la línea de Bresenham entre dos puntos,
// excluyendo origen y destino
function cellsBetween(x0, y0, x1, y1) {
  const cells = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  for (;;) {
    if (!(x === x0 && y === y0) && !(x === x1 && y === y1)) cells.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

/**
 * Calcula las casillas visibles de UNA planta.
 * - rooms: filas de map_rooms de esa planta (con disabled/obstacle_cells)
 * - viewers: [{ x, y, radius }] posiciones y alcance de cada token que ve
 *   (distancia de Chebyshev, regla 5e); el radio es por viewer para que la
 *   visión en la oscuridad de un personaje no afecte a los demás
 * Devuelve un Set de 'x,y' absolutas visibles.
 */
export function computeFloorVision({ rooms, viewers }) {
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

  const visible = new Set();
  for (const viewer of viewers) {
    const radius = viewer.radius;
    for (let y = viewer.y - radius; y <= viewer.y + radius; y += 1) {
      for (let x = viewer.x - radius; x <= viewer.x + radius; x += 1) {
        const target = key(x, y);
        if (visible.has(target) || !existing.has(target)) continue;
        const blocked = cellsBetween(viewer.x, viewer.y, x, y).some(([cx, cy]) =>
          blocksSight(cx, cy)
        );
        if (!blocked) visible.add(target);
      }
    }
  }
  return visible;
}
