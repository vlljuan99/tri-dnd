import { getSettings } from './sfx/index.js';

// Vibración en el móvil (Fase 3, añadido del 23-sep-2026): un toque al
// impactar, al recibir daño, en un crítico y en «tu turno». Como el sonido,
// es opcional: se calla con el silencio del usuario y no hace nada donde el
// navegador no sabe vibrar.

export const PATRONES = {
  impacto: [40],
  dano: [70, 40, 90],
  critico: [30, 30, 30, 30, 120],
  turno: [90, 60, 90],
};

export function vibrar(patron) {
  try {
    if (getSettings().muted) return false;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    return navigator.vibrate(PATRONES[patron] ?? patron);
  } catch {
    return false;
  }
}
