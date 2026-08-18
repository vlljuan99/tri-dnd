// Reglas de subida de nivel (Fase D de la rebanada vertical). Parte pura: no
// toca la base ni decide QUIÉN puede subir (eso es services/leveling.js), solo
// aplica las reglas del manual a los números.
import { abilityModifier } from './abilities.js';

export const MAX_LEVEL = 20;

/** Los seis atributos, en el orden del manual. Ninguno pasa de 20 sin dotes ni objetos. */
export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const MAX_ABILITY = 20;

/** Puntos de característica que reparte una mejora (ASI): 2, y ninguno mayor de 2. */
export const ABILITY_POINTS = 2;

/**
 * PG que se ganan al subir un nivel. Valor fijo (por defecto en la mesa) o
 * tirada del dado de golpe; en ambos casos suma el modificador de CON y nunca
 * baja de 1, como dice el manual.
 */
export function hitPointsGain(hitDie, conModifier, { method = 'fijo', roll = null } = {}) {
  const die = Number.isFinite(hitDie) && hitDie > 0 ? hitDie : 8;
  const base = method === 'tirada' ? roll : Math.floor(die / 2) + 1;
  if (method === 'tirada' && (!Number.isInteger(roll) || roll < 1 || roll > die)) return null;
  return Math.max(1, base + conModifier);
}

/**
 * Reparto válido de una mejora de característica: como mucho 2 puntos en
 * total, ninguno mayor de 2, ninguna característica por encima de 20 y solo
 * las seis del manual.
 */
export function validateAbilityIncreases(increases, abilities) {
  if (increases == null) return { ok: true, increases: {} };
  if (typeof increases !== 'object' || Array.isArray(increases)) return { ok: false, error: 'Reparto no válido' };
  let total = 0;
  for (const [key, value] of Object.entries(increases)) {
    if (!ABILITY_KEYS.includes(key)) return { ok: false, error: `Característica desconocida: ${key}` };
    if (!Number.isInteger(value) || value < 0 || value > ABILITY_POINTS) {
      return { ok: false, error: 'Cada característica sube 1 o 2 puntos, no más' };
    }
    if ((abilities?.[key] ?? 10) + value > MAX_ABILITY) {
      return { ok: false, error: `No puedes pasar de ${MAX_ABILITY} en ninguna característica` };
    }
    total += value;
  }
  if (total > ABILITY_POINTS) return { ok: false, error: 'La mejora reparte 2 puntos como mucho' };
  return { ok: true, increases };
}

/** Características con la mejora ya aplicada. */
export function applyAbilityIncreases(abilities, increases) {
  const next = { ...abilities };
  for (const [key, value] of Object.entries(increases ?? {})) {
    next[key] = Math.min(MAX_ABILITY, (next[key] ?? 10) + value);
  }
  return next;
}

/**
 * PG máximos tras subir: los que ya tenía más lo ganado. No se recalculan
 * desde cero — un personaje puede llevar PG de fuentes que las reglas todavía
 * no cubren y recalcular se los quitaría.
 */
export function nextHitPoints({ hpMax, hpCurrent }, gain) {
  return { hpMax: Math.max(1, hpMax + gain), hpCurrent: Math.max(0, hpCurrent + gain) };
}

/** Modificador de CON que cuenta para los PG del nivel nuevo (ya con la mejora aplicada). */
export function constitutionModifier(abilities) {
  return abilityModifier(abilities?.con ?? 10);
}
