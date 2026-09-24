// Agitar el móvil para tirar (Fase 4c, opcional). Con una tirada pendiente en
// pantalla, una sacudida equivale a pulsar «Tirar». Está apagado por defecto,
// cada cual lo activa en «Sonido y ritmo», y en iOS exige un permiso explícito
// del navegador que solo se puede pedir tras un toque.

const AGITAR_KEY = 'tri-dnd:agitar';

// Aceleración (m/s², con gravedad incluida) a partir de la cual se cuenta como
// sacudida. En reposo el módulo ronda 9,8; andar con el móvil en la mano no
// pasa de ~15; una sacudida deliberada supera con holgura 25.
export const UMBRAL_SACUDIDA = 25;

export function agitarActivado() {
  try {
    return window.localStorage.getItem(AGITAR_KEY) === '1';
  } catch {
    return false;
  }
}

export function guardarAgitar(activo) {
  try {
    window.localStorage.setItem(AGITAR_KEY, activo ? '1' : '0');
  } catch {
    // Sin almacenamiento, la preferencia dura lo que la pestaña
  }
}

/** ¿Esta lectura del acelerómetro es una sacudida? */
export function esSacudida(aceleracion, umbral = UMBRAL_SACUDIDA) {
  if (!aceleracion) return false;
  const { x, y, z } = aceleracion;
  if (![x, y, z].every((valor) => Number.isFinite(valor))) return false;
  return Math.hypot(x, y, z) > umbral;
}

/**
 * Pide permiso al navegador (iOS) para leer el movimiento. Devuelve true si se
 * puede usar. En el resto de navegadores no hay que pedir nada.
 */
export async function pedirPermisoMovimiento() {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return false;
  const permiso = window.DeviceMotionEvent?.requestPermission;
  if (typeof permiso !== 'function') return true;
  try {
    return (await permiso.call(window.DeviceMotionEvent)) === 'granted';
  } catch {
    return false;
  }
}
