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

// Gestos que el navegador acepta para arrancar el audio. `pointerdown` solo
// cuenta con ratón: con el dedo, Chrome y Safari exigen que se levante
// (`pointerup`, `touchend`, `click`). Antes solo se escuchaba `pointerdown` y
// el primer toque en el móvil daba el audio por desbloqueado sin que llegara
// a arrancar: la mesa se quedaba muda para siempre.
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

/**
 * Desbloquea el audio con el primer gesto del usuario. Es obligatorio: sin él
 * el navegador deja el AudioContext suspendido y no suena nada. Sigue
 * escuchando hasta que el contexto arranca de verdad.
 */
export function bindUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const detach = () => {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, true);
  };
  const ready = () => {
    detach();
    preloadSamples();
  };
  function unlock() {
    const context = ensureContext();
    if (!context) {
      detach();
      return;
    }
    unlocked = true;
    if (context.state === 'running') {
      ready();
      return;
    }
    // Safari solo arranca si algo suena dentro del gesto: basta una muestra
    // de silencio.
    try {
      const silence = context.createBufferSource();
      silence.buffer = context.createBuffer(1, 1, context.sampleRate);
      silence.connect(context.destination);
      silence.start();
    } catch {
      // Sin el truco de Safari, el resume de abajo basta en el resto
    }
    context
      .resume?.()
      .then(() => {
        if (context.state === 'running') ready();
      })
      .catch(() => {});
  }
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true, passive: true });
}

function loadSample(url) {
  if (sampleCache.has(url)) return sampleCache.get(url);
  const promise = (async () => {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`No se pudo cargar el sonido ${url} (${response.status})`);
    const bytes = await response.arrayBuffer();
    return await ensureContext().decodeAudioData(bytes);
  })().catch((error) => {
    // Un fallo (red, formato que este navegador no descodifica) no se queda
    // guardado: el siguiente golpe lo reintenta.
    console.warn('[sonido]', error?.message ?? error);
    if (sampleCache.get(url) === promise) sampleCache.delete(url);
    return null;
  });
  sampleCache.set(url, promise);
  return promise;
}

// Descarga y descodifica los sonidos subidos en cuanto hay audio: sin esto el
// primer impacto esperaba a la red y sonaba tarde, ya pasado el golpe.
function preloadSamples() {
  if (!ctx) return;
  for (const url of new Set(Object.values(overrides))) loadSample(url);
}

/** Sonidos personalizados vigentes: `{ clave: url }`. */
export function setOverrides(next) {
  overrides = mergeOverrides(next);
  // Cada subida estrena url (el fichero lleva marca de tiempo), así que lo ya
  // descodificado sigue valiendo: solo se olvida lo que ya no se usa.
  const vigentes = new Set(Object.values(overrides));
  for (const url of sampleCache.keys()) {
    if (!vigentes.has(url)) sampleCache.delete(url);
  }
  preloadSamples();
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
    if (context.state !== 'running') {
      context.resume?.().catch(() => {});
      // Con el audio parado, lo que se programe ahora sonaría todo de golpe al
      // volver (o nunca): mejor callar este sonido.
      if (!force) return false;
    }

    const voice = context.createGain();
    voice.gain.value = volumen;
    voice.connect(masterGain);

    const velocidad = rate ?? playbackRate(key);
    const url = overrides[key];

    if (url) {
      loadSample(url).then((buffer) => {
        try {
          // Un sample ilegible no deja la mesa sin sonido: suena la receta
          if (!buffer) {
            playRecipe(context, voice, sfxEvent(key)?.recipe, { rate: velocidad });
            return;
          }
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = velocidad;
          source.connect(voice);
          source.start();
        } catch {
          // Nunca rompe la app: como mucho, silencio
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
