// Orientación de la cámara táctica: hacia dónde mira y cuánto se inclina.
//
// La geometría vive aquí y no dentro del componente porque es lo que puede
// romperse sin que se note en una captura: que la inclinación se pase de rosca
// y la cámara acabe bajo el suelo, o que arrastrar hacia arriba incline al
// revés. El componente solo traduce gestos a estas dos funciones.

export const TILT_INITIAL = (26 * Math.PI) / 180;
export const TILT_MAX = 1.1; // ~63°: más allá la cámara ortográfica rasa el suelo
export const AZIMUTH_STEP = Math.PI / 4; // 45° por pulsación de Q/E
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 120;

// Sensibilidad del arrastre, en radianes por píxel.
const ORBIT_AZIMUTH = 0.006;
const ORBIT_TILT = 0.005;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Encuadre inicial según la superficie disponible: el tablero entra entre la
// iniciativa y el hotbar incluso en móvil. Girar y hacer zoom sigue siendo libre.
export function fitBoardZoom(map, viewport, view = { tilt: TILT_INITIAL, azimuth: 0 }) {
  const mobile = viewport.width < 768;
  const usableWidth = Math.max(160, viewport.width - (mobile ? 40 : 200));
  const usableHeight = Math.max(160, viewport.height - (mobile ? 340 : 260));
  const width = Math.max(Number(map.width) || 1, 1);
  const height = Math.max(Number(map.height) || 1, 1);
  const cos = Math.abs(Math.cos(view.azimuth));
  const sin = Math.abs(Math.sin(view.azimuth));
  const projectedWidth = width * cos + height * sin;
  const projectedHeight = (width * sin + height * cos) * Math.cos(view.tilt) + 1;
  return Math.min(usableWidth / projectedWidth, usableHeight / projectedHeight, 85);
}

/**
 * Órbita por arrastre: horizontal gira el tablero, vertical lo inclina.
 * Arrastrar hacia arriba levanta la vista (más escorzo), como en cualquier
 * juego con cámara táctica.
 */
export function orbitBy(view, dx, dy) {
  return {
    azimuth: view.azimuth + dx * ORBIT_AZIMUTH,
    tilt: clamp(view.tilt - dy * ORBIT_TILT, 0, TILT_MAX),
  };
}

/** Giro por pasos del dock y de Q/E. */
export function rotateBy(view, dir) {
  return { ...view, azimuth: view.azimuth + AZIMUTH_STEP * (dir === -1 ? -1 : 1) };
}

/** Inclinación fijada por el dock (en radianes), con el mismo tope. */
export function withTilt(view, tilt) {
  return { ...view, tilt: clamp(Number(tilt) || 0, 0, TILT_MAX) };
}

/** El ángulo que enseña el HUD: grados enteros y azimut normalizado a 0–359. */
export function viewDegrees(view) {
  const azimuth = ((view.azimuth * 180) / Math.PI) % 360;
  return {
    tiltDeg: (view.tilt * 180) / Math.PI,
    azimuthDeg: azimuth < 0 ? azimuth + 360 : azimuth,
  };
}
