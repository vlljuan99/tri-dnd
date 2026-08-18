import { sfxEvent } from './catalog.js';

// Las decisiones del sonido, separadas de la Web Audio API para poder probarlas:
// cuánto suena cada cosa, cuándo NO hay que sonar y de dónde sale el audio.

export const SETTINGS_KEY = 'tri-dnd:sfx';
const DEFAULT_SETTINGS = { volume: 0.7, muted: false };

// Diez dados cayendo a la vez son diez golpes en el mismo instante: sin tope se
// convierte en un chasquido de ruido blanco. Se limita cuántas voces del mismo
// sonido pueden empezar dentro de una ventana corta.
export const MAX_VOCES = 4;
export const VENTANA_VOCES_MS = 70;

export function readSettings(storage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      volume: clampVolume(parsed?.volume),
      muted: Boolean(parsed?.muted),
    };
  } catch {
    // Un ajuste corrupto no puede dejar la app sin sonido ni romperla.
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(storage, settings) {
  const clean = { volume: clampVolume(settings?.volume), muted: Boolean(settings?.muted) };
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(clean));
  } catch {
    // Modo privado o almacenamiento lleno: se pierde la preferencia, no el audio.
  }
  return clean;
}

export function clampVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.volume;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * Volumen final de un sonido: el suyo propio por el volumen general, y cero si
 * está silenciado. El volumen general se aplica al cuadrado porque el oído no
 * es lineal y un cursor a la mitad debe sonar a la mitad, no a tres cuartos.
 */
export function effectiveGain(key, settings) {
  const event = sfxEvent(key);
  if (!event) return 0;
  if (settings?.muted) return 0;
  const master = clampVolume(settings?.volume);
  return event.gain * master * master;
}

/** Tono variado para que un sonido repetido no suene calcado. */
export function playbackRate(key, random = Math.random) {
  const jitter = sfxEvent(key)?.pitchJitter ?? 0;
  if (!jitter) return 1;
  return 1 + (random() * 2 - 1) * jitter;
}

/**
 * ¿Puede sonar esta voz? Devuelve el veredicto y la lista de marcas de tiempo
 * actualizada, sin mutar la que recibe.
 */
export function shouldPlay(key, now, recent = [], { maxVoices = MAX_VOCES, windowMs = VENTANA_VOCES_MS } = {}) {
  const recientes = (recent ?? []).filter((stamp) => now - stamp < windowMs);
  if (recientes.length >= maxVoices) return { play: false, recent: recientes };
  return { play: true, recent: [...recientes, now] };
}

/**
 * De dónde sale el audio de un sonido: del sample subido si lo hay, y si no de
 * la receta sintetizada. `overrides` es el mapa `{ clave: url }` que sirve la
 * API — hoy con los sonidos globales, mañana con los de cada mesa encima.
 */
export function resolveSource(key, overrides = {}) {
  const event = sfxEvent(key);
  if (!event) return null;
  const url = overrides?.[key];
  if (typeof url === 'string' && url.trim()) return { type: 'sample', url: url.trim(), event };
  return { type: 'synth', recipe: event.recipe, event };
}

/**
 * Mezcla las capas de sonidos por orden de prioridad: lo que venga después pisa
 * a lo anterior. Hoy solo hay una capa (la global); cuando cada DM pueda poner
 * los suyos, entrarán aquí como una capa más encima, sin tocar nada más.
 */
export function mergeOverrides(...layers) {
  const merged = {};
  for (const layer of layers) {
    for (const [key, url] of Object.entries(layer ?? {})) {
      if (typeof url === 'string' && url.trim()) merged[key] = url.trim();
    }
  }
  return merged;
}
