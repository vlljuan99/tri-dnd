import { isSfxKey, sfxEvent } from './catalog.js';
import {
  effectiveGain,
  mergeOverrides,
  playbackRate,
  readSettings,
  shouldPlay,
  writeSettings,
} from './mixer.js';
import { playRecipe } from './synth.js';

// Punto único por el que suena todo. Reglas que cumple siempre:
//
// 1. **Nunca rompe la app.** Un fallo de audio no puede tirar una tirada ni un
//    turno: todo va envuelto y, como mucho, se queda en silencio.
// 2. **No suena antes de que el usuario toque algo.** Los navegadores no dejan
//    arrancar un AudioContext sin un gesto previo, así que se desbloquea con la
//    primera interacción real y hasta entonces se calla.
// 3. **No sabe nada del juego.** Recibe claves del catálogo; quién las dispara
//    es cosa de quien conoce el evento.

// Ver el comentario de `ensureContext`: sale de medir el peor apilamiento.
export const MASTER_HEADROOM = 0.65;

let ctx = null;
let masterGain = null;
let settings = null;
let overrides = {};
let unlocked = false;
let unlockBound = false;
const recentByKey = new Map();
const sampleCache = new Map();

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentSettings() {
  if (!settings) settings = readSettings(storage());
  return settings;
}

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  masterGain = ctx.createGain();
  // Margen del bus principal. Medido con render offline: ningún sonido satura
  // por sí solo (el más fuerte, el crítico, llega a 0,74), pero al apilarse sí
  // — con el tope de voces puesto, el peor caso posible alcanza 1,50 y eso
  // recorta con chasquido. A 0,65 ese mismo peor caso se queda en 0,97.
  //
  // Se hace con ganancia fija y no con un DynamicsCompressor a propósito: se
  // probó, y el compresor de Chrome tiene lookahead y machaca los transitorios
  // cortos (un bote de dado perdía el 80% aun estando 30 dB por debajo del
  // umbral). Una escala uniforme no toca la dinámica entre sonidos: el crítico
  // sigue sonando mucho más que un bote.
  masterGain.gain.value = MASTER_HEADROOM;
  masterGain.connect(ctx.destination);
  return ctx;
}

/**
 * Desbloquea el audio con el primer gesto del usuario. Es obligatorio: sin él
 * el navegador deja el AudioContext suspendido y no suena nada.
 */
export function bindUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const unlock = () => {
    unlocked = true;
    const context = ensureContext();
    context?.resume?.().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

async function loadSample(url) {
  if (sampleCache.has(url)) return sampleCache.get(url);
  const promise = (async () => {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`No se pudo cargar el sonido ${url}`);
    const bytes = await response.arrayBuffer();
    return await ensureContext().decodeAudioData(bytes);
  })().catch(() => null);
  sampleCache.set(url, promise);
  return promise;
}

/** Sonidos personalizados vigentes: `{ clave: url }`. */
export function setOverrides(next) {
  overrides = mergeOverrides(next);
  // Si cambia un sample hay que olvidar el descodificado anterior.
  sampleCache.clear();
}

export function getOverrides() {
  return { ...overrides };
}

export function getSettings() {
  return { ...currentSettings() };
}

export function setSettings(next) {
  settings = writeSettings(storage(), { ...currentSettings(), ...next });
  return { ...settings };
}

/**
 * Hace sonar un evento del catálogo. `force` se salta el límite de voces y el
 * silencio de "aún no ha habido gesto": lo usa la página de configuración, donde
 * el usuario acaba de pulsar el botón de escuchar.
 */
export function play(key, { rate, gain, force = false } = {}) {
  try {
    if (!isSfxKey(key)) return false;
    if (!unlocked && !force) return false;

    const volumen = gain ?? effectiveGain(key, currentSettings());
    if (volumen <= 0) return false;

    const now = Date.now();
    const verdict = shouldPlay(key, now, recentByKey.get(key));
    if (!verdict.play && !force) return false;
    recentByKey.set(key, verdict.recent);

    const context = ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') context.resume?.().catch(() => {});

    const voice = context.createGain();
    voice.gain.value = volumen;
    voice.connect(masterGain);

    const velocidad = rate ?? playbackRate(key);
    const url = overrides[key];

    if (url) {
      loadSample(url).then((buffer) => {
        if (!buffer) return;
        try {
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = velocidad;
          source.connect(voice);
          source.start();
        } catch {
          // Un sample ilegible no debe dejar la mesa sin sonido.
        }
      });
      return true;
    }

    return playRecipe(context, voice, sfxEvent(key)?.recipe, { rate: velocidad });
  } catch {
    return false;
  }
}

/** Escucha suelta para la página de configuración. */
export function preview(key) {
  bindUnlock();
  unlocked = true;
  ensureContext()?.resume?.().catch(() => {});
  return play(key, { force: true, gain: effectiveGain(key, { ...currentSettings(), muted: false }) });
}

/** Carga los sonidos personalizados desde la API. Silencioso si falla. */
export async function loadOverrides(api) {
  try {
    const { sonidos } = await api('/sonidos');
    setOverrides(
      Object.fromEntries((sonidos ?? []).filter((s) => s.url).map((s) => [s.key, s.url]))
    );
    return true;
  } catch {
    return false;
  }
}
