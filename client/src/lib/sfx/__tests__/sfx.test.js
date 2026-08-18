import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPE_KINDS, SFX_EVENTS, SFX_GROUPS, SFX_KEYS, eventsOfGroup, isSfxKey, sfxEvent } from '../catalog.js';
import {
  MAX_VOCES,
  SETTINGS_KEY,
  clampVolume,
  effectiveGain,
  mergeOverrides,
  playbackRate,
  readSettings,
  resolveSource,
  shouldPlay,
  writeSettings,
} from '../mixer.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

test('el catálogo está bien formado', () => {
  assert.ok(SFX_EVENTS.length > 0);
  assert.equal(new Set(SFX_KEYS).size, SFX_KEYS.length, 'no puede haber claves repetidas');
  const grupos = new Set(SFX_GROUPS.map((group) => group.id));
  for (const event of SFX_EVENTS) {
    assert.ok(event.label, `${event.key} necesita nombre para la configuración`);
    assert.ok(grupos.has(event.group), `${event.key} está en un grupo inexistente: ${event.group}`);
    assert.ok(event.gain > 0 && event.gain <= 1, `${event.key} tiene un volumen fuera de rango`);
    assert.ok(RECIPE_KINDS.includes(event.recipe?.kind), `${event.key} no tiene receta válida`);
    assert.ok(event.recipe.duration > 0, `${event.key} necesita duración`);
  }
});

test('todos los sonidos caen en algún grupo mostrable', () => {
  const cubiertos = SFX_GROUPS.flatMap((group) => eventsOfGroup(group.id));
  assert.equal(cubiertos.length, SFX_EVENTS.length, 'ningún sonido puede quedar sin pestaña');
});

test('las claves desconocidas no existen', () => {
  assert.equal(isSfxKey('dice.crit'), true);
  assert.equal(isSfxKey('no.existe'), false);
  assert.equal(sfxEvent('no.existe'), null);
});

test('los ajustes se guardan y se recuperan acotados', () => {
  const storage = fakeStorage();
  writeSettings(storage, { volume: 0.42, muted: true });
  assert.deepEqual(readSettings(storage), { volume: 0.42, muted: true });
  assert.ok(storage.data[SETTINGS_KEY].includes('0.42'));

  writeSettings(storage, { volume: 5, muted: false });
  assert.equal(readSettings(storage).volume, 1, 'el volumen no puede pasar de 1');
  writeSettings(storage, { volume: -2 });
  assert.equal(readSettings(storage).volume, 0);
});

test('un ajuste corrupto no deja la app sin sonido', () => {
  assert.deepEqual(readSettings(fakeStorage({ [SETTINGS_KEY]: '{no es json' })), {
    volume: 0.7,
    muted: false,
  });
  assert.deepEqual(readSettings(null), { volume: 0.7, muted: false });
  assert.equal(clampVolume('mucho'), 0.7);
});

test('silenciar deja el volumen a cero de verdad', () => {
  assert.equal(effectiveGain('dice.crit', { volume: 1, muted: true }), 0);
  assert.ok(effectiveGain('dice.crit', { volume: 1, muted: false }) > 0);
  assert.equal(effectiveGain('no.existe', { volume: 1 }), 0);
});

test('el volumen general se aplica al cuadrado, que es como oye el oído', () => {
  const evento = sfxEvent('dice.land');
  assert.equal(effectiveGain('dice.land', { volume: 1 }), evento.gain);
  assert.equal(effectiveGain('dice.land', { volume: 0.5 }), evento.gain * 0.25);
});

test('el límite de voces evita el muro de ruido de una tirada grande', () => {
  let recent = [];
  const now = 1_000;
  for (let i = 0; i < MAX_VOCES; i += 1) {
    const verdict = shouldPlay('dice.bounce', now + i, recent);
    assert.equal(verdict.play, true, `la voz ${i + 1} debería sonar`);
    recent = verdict.recent;
  }
  const extra = shouldPlay('dice.bounce', now + MAX_VOCES, recent);
  assert.equal(extra.play, false, 'la quinta voz simultánea se descarta');
  // Pasada la ventana, vuelve a sonar.
  const despues = shouldPlay('dice.bounce', now + 5_000, recent);
  assert.equal(despues.play, true);
  assert.equal(despues.recent.length, 1, 'las marcas viejas se olvidan');
});

test('shouldPlay no muta la lista que recibe', () => {
  const recent = [10, 20];
  const copia = [...recent];
  shouldPlay('dice.bounce', 25, recent);
  assert.deepEqual(recent, copia);
});

test('el tono varía solo en los sonidos que lo declaran', () => {
  // `dice.crit` no tiene jitter: un crítico debe sonar siempre igual de rotundo.
  assert.equal(playbackRate('dice.crit', () => 0), 1);
  const jitter = sfxEvent('dice.bounce').pitchJitter;
  assert.equal(playbackRate('dice.bounce', () => 1), 1 + jitter);
  assert.equal(playbackRate('dice.bounce', () => 0), 1 - jitter);
  assert.equal(playbackRate('dice.bounce', () => 0.5), 1);
});

test('un sample subido sustituye a la síntesis', () => {
  const sinSample = resolveSource('door', {});
  assert.equal(sinSample.type, 'synth');
  assert.equal(sinSample.recipe.kind, 'noise');

  const conSample = resolveSource('door', { door: '/uploads/sounds/door.mp3' });
  assert.equal(conSample.type, 'sample');
  assert.equal(conSample.url, '/uploads/sounds/door.mp3');

  // Una url vacía o en blanco no cuenta como sample.
  assert.equal(resolveSource('door', { door: '   ' }).type, 'synth');
  assert.equal(resolveSource('no.existe', {}), null);
});

test('las capas de sonidos se pisan por orden de prioridad', () => {
  // Hoy solo hay capa global; mañana la del DM entra encima sin tocar nada más.
  const global = { door: '/uploads/sounds/global-door.mp3', 'dice.crit': '/uploads/sounds/crit.mp3' };
  const mesa = { door: '/uploads/sounds/mesa-door.mp3', heal: '' };
  assert.deepEqual(mergeOverrides(global, mesa), {
    door: '/uploads/sounds/mesa-door.mp3',
    'dice.crit': '/uploads/sounds/crit.mp3',
  });
  assert.deepEqual(mergeOverrides(null, undefined), {});
});
