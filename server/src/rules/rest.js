// Reglas de descanso (Fase F de la rebanada vertical). Parte pura: cuánto
// cura un dado de golpe, cuántos se recuperan y cómo avanza el reloj. Quién
// puede descansar y qué se escribe en la ficha vive en services/rest.js.

/** Minutos que dura cada descanso en el reloj de campaña, cuando está encendido. */
export const REST_MINUTES = { corto: 60, largo: 8 * 60 };
export const MINUTES_PER_DAY = 24 * 60;

/** Dados de golpe disponibles: uno por nivel, menos los ya gastados. */
export function availableHitDice(level, spent) {
  return Math.max(0, Math.min(level, level - Math.max(0, spent)));
}

/**
 * Curación de gastar dados de golpe en un descanso corto: cada dado suma su
 * tirada más el modificador de CON, y ninguno cura menos de 0 (un CON muy
 * negativo no puede quitar PG).
 */
export function shortRestHealing(rolls, conModifier, hitDie) {
  if (!Array.isArray(rolls) || rolls.length === 0) return { ok: false, error: 'No has gastado ningún dado de golpe' };
  for (const roll of rolls) {
    if (!Number.isInteger(roll) || roll < 1 || roll > hitDie) {
      return { ok: false, error: `Cada dado de golpe es un d${hitDie} (1-${hitDie})` };
    }
  }
  const healed = rolls.reduce((total, roll) => total + Math.max(0, roll + conModifier), 0);
  return { ok: true, healed, spent: rolls.length };
}

/**
 * Dados de golpe que devuelve un descanso largo: la mitad del total,
 * redondeando hacia abajo, y como mínimo uno (regla del manual).
 */
export function hitDiceRecovered(level) {
  return Math.max(1, Math.floor(level / 2));
}

/**
 * Avance del reloj: devuelve los minutos del día y las jornadas que se cruzan.
 * El reloj apagado no llama aquí — el descanso funciona igual sin él.
 */
export function advanceClock(dayMinutes, minutes) {
  const total = (Number.isFinite(dayMinutes) ? dayMinutes : 0) + minutes;
  return {
    dayMinutes: ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
    daysCrossed: Math.floor(total / MINUTES_PER_DAY),
  };
}

/** Hora del día en formato 24 h para la mesa («08:00»). */
export function formatClock(dayMinutes) {
  const safe = ((Math.round(dayMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = String(Math.floor(safe / 60)).padStart(2, '0');
  const minutes = String(safe % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}
