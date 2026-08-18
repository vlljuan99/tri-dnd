import { cellKey } from './cells.js';
import { worldToGrid } from './grid.js';

// Altura de mundo de cada nivel de elevación (un nivel = 5 pies). La usan
// tanto la plataforma que se pinta en el suelo (MapFloor) como todo lo que
// debe apoyarse ENCIMA de ella: tokens, contorno de alcance, camino, visión.
export const ELEV_STEP = 0.4;

/**
 * Altura a la que se apoya lo que esté en esa casilla.
 *
 * Un token sobre una cornisa se dibujaba a ras de suelo y quedaba enterrado
 * dentro del bloque de la plataforma: desde arriba solo asomaba su etiqueta.
 * Los fosos (nivel negativo) no hunden nada: su bloque oscuro tiene la cara
 * superior a ras de suelo y meter el token dentro lo haría desaparecer.
 */
export function cellGroundY(elevation, col, row) {
  if (!elevation || elevation.size === 0) return 0;
  const level = elevation.get(cellKey(col, row)) ?? 0;
  return Math.max(0, level) * ELEV_STEP;
}

/** Igual, pero a partir de la posición de mundo del token. */
export function tokenGroundY(elevation, position, gridSize) {
  if (!elevation || elevation.size === 0 || !position || !gridSize) return 0;
  const cell = worldToGrid(position, gridSize);
  return cellGroundY(elevation, cell.col, cell.row);
}
