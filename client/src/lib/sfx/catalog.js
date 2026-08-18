// Catálogo de sonidos de la mesa: qué suena, cómo se llama para el usuario y
// con qué receta se sintetiza mientras no haya un sample subido.
//
// Este módulo es DATO PURO: no toca la Web Audio API ni el DOM. Por eso lo
// pueden leer el sintetizador del navegador, la página de configuración y las
// pruebas del servidor (que comprueban que las claves que acepta la API son
// exactamente estas).
//
// Las recetas de síntesis son un apaño digno, no el destino: el ruido blanco
// filtrado da un repiqueteo creíble, pero un dado de verdad sobre madera solo
// suena bien con una grabación. Para eso está la subida de samples.

/** Tipos de receta que entiende el sintetizador. */
export const RECIPE_KINDS = ['noise', 'tone', 'chime'];

export const SFX_GROUPS = [
  { id: 'dados', label: 'Dados' },
  { id: 'combate', label: 'Combate' },
  { id: 'mesa', label: 'Mesa' },
  { id: 'interfaz', label: 'Interfaz' },
];

/**
 * Cada sonido declara:
 * - `key`: identificador estable (lo usan la API y los ficheros subidos).
 * - `label` / `hint`: lo que se lee en la página de configuración.
 * - `gain`: volumen relativo; los sonidos que se repiten mucho van más bajos.
 * - `pitchJitter`: variación aleatoria de tono, para que diez dados seguidos no
 *   suenen como diez copias del mismo golpe.
 * - `recipe`: cómo sintetizarlo si no hay sample.
 */
export const SFX_EVENTS = [
  {
    key: 'dice.throw',
    group: 'dados',
    label: 'Lanzamiento de dados',
    hint: 'Al soltar los dados sobre la mesa.',
    gain: 0.4,
    pitchJitter: 0.1,
    recipe: { kind: 'noise', duration: 0.22, attack: 0.004, filter: { type: 'bandpass', from: 900, to: 2600, q: 0.9 } },
  },
  {
    key: 'dice.bounce',
    group: 'dados',
    label: 'Bote del dado',
    hint: 'Cada golpe del dado contra la mesa.',
    gain: 0.28,
    pitchJitter: 0.22,
    recipe: { kind: 'noise', duration: 0.085, attack: 0.002, filter: { type: 'bandpass', from: 2600, to: 1100, q: 1.4 } },
  },
  {
    key: 'dice.land',
    group: 'dados',
    label: 'Dado al pararse',
    hint: 'El último apoyo, cuando ya se puede leer el número.',
    gain: 0.34,
    pitchJitter: 0.12,
    recipe: { kind: 'noise', duration: 0.13, attack: 0.002, filter: { type: 'lowpass', from: 1800, to: 420, q: 0.8 } },
  },
  {
    key: 'dice.crit',
    group: 'dados',
    label: 'Crítico (20 natural)',
    hint: 'El mejor sonido de la sesión. Que se note.',
    gain: 0.55,
    recipe: { kind: 'chime', duration: 1.1, base: 528, partials: [1, 1.5, 2, 3], decay: 0.72 },
  },
  {
    key: 'dice.fumble',
    group: 'dados',
    label: 'Pifia (1 natural)',
    hint: 'Aquí es donde acabará el "BRUH" de Dani.',
    gain: 0.5,
    recipe: { kind: 'tone', duration: 0.55, wave: 'sawtooth', from: 220, to: 70, attack: 0.01, decay: 0.5 },
  },
  {
    key: 'attack.hit',
    group: 'combate',
    label: 'Impacto',
    hint: 'Un ataque que acierta.',
    gain: 0.45,
    pitchJitter: 0.15,
    recipe: { kind: 'noise', duration: 0.18, attack: 0.001, filter: { type: 'lowpass', from: 3200, to: 260, q: 1.1 } },
  },
  {
    key: 'attack.crit',
    group: 'combate',
    label: 'Impacto crítico',
    hint: 'Más seco y más grave que un impacto normal.',
    gain: 0.6,
    recipe: { kind: 'noise', duration: 0.32, attack: 0.001, filter: { type: 'lowpass', from: 4200, to: 150, q: 1.6 } },
  },
  {
    key: 'attack.miss',
    group: 'combate',
    label: 'Fallo',
    hint: 'El arma pasa de largo.',
    gain: 0.3,
    pitchJitter: 0.18,
    recipe: { kind: 'noise', duration: 0.26, attack: 0.02, filter: { type: 'bandpass', from: 700, to: 2400, q: 2.2 } },
  },
  {
    key: 'heal',
    group: 'combate',
    label: 'Curación',
    hint: 'Recuperar puntos de golpe.',
    gain: 0.4,
    recipe: { kind: 'chime', duration: 0.9, base: 396, partials: [1, 2, 3], decay: 0.6 },
  },
  {
    key: 'downed',
    group: 'combate',
    label: 'Caer a 0 PG',
    hint: 'Cuando un personaje cae inconsciente.',
    gain: 0.5,
    recipe: { kind: 'tone', duration: 0.9, wave: 'triangle', from: 180, to: 48, attack: 0.006, decay: 0.85 },
  },
  {
    key: 'death',
    group: 'combate',
    label: 'Muerte definitiva',
    hint: 'Tercer fallo de salvación. No hay vuelta.',
    gain: 0.55,
    recipe: { kind: 'chime', duration: 1.6, base: 116, partials: [1, 1.19, 2.4], decay: 1.2 },
  },
  {
    key: 'turn.start',
    group: 'mesa',
    label: 'Empieza tu turno',
    hint: 'Solo suena para quien tiene el turno.',
    gain: 0.45,
    recipe: { kind: 'chime', duration: 0.7, base: 660, partials: [1, 1.5], decay: 0.45 },
  },
  {
    key: 'combat.start',
    group: 'mesa',
    label: 'Empieza el combate',
    hint: 'Acompaña al cartel de "¡Combate!".',
    gain: 0.6,
    recipe: { kind: 'tone', duration: 1.2, wave: 'sawtooth', from: 70, to: 150, attack: 0.05, decay: 1 },
  },
  {
    key: 'door',
    group: 'mesa',
    label: 'Puerta',
    hint: 'Abrir una puerta del mapa.',
    gain: 0.4,
    pitchJitter: 0.1,
    recipe: { kind: 'noise', duration: 0.5, attack: 0.03, filter: { type: 'lowpass', from: 800, to: 180, q: 0.7 } },
  },
  {
    key: 'ui.click',
    group: 'interfaz',
    label: 'Clic de interfaz',
    hint: 'Botones y paneles. Muy discreto o cansa.',
    gain: 0.2,
    pitchJitter: 0.08,
    recipe: { kind: 'noise', duration: 0.04, attack: 0.001, filter: { type: 'highpass', from: 1800, to: 3200, q: 0.9 } },
  },
];

export const SFX_KEYS = SFX_EVENTS.map((event) => event.key);

const byKey = new Map(SFX_EVENTS.map((event) => [event.key, event]));

export function sfxEvent(key) {
  return byKey.get(key) ?? null;
}

export function isSfxKey(key) {
  return byKey.has(key);
}

/** Sonidos de un grupo, en el orden en que se declararon. */
export function eventsOfGroup(groupId) {
  return SFX_EVENTS.filter((event) => event.group === groupId);
}
