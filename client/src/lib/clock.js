// Reloj de campaña (Fase F). Espejo de server/src/rules/rest.js: el servidor
// guarda los minutos del día y aquí solo se pintan. Es una capacidad opcional
// de la campaña — con ella apagada nadie llama a esto.
const MINUTES_PER_DAY = 24 * 60;

/** Hora del día en formato 24 h para la mesa («08:00»). */
export function formatClock(dayMinutes) {
  const safe = ((Math.round(dayMinutes ?? 0) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = String(Math.floor(safe / 60)).padStart(2, '0');
  const minutes = String(safe % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}
