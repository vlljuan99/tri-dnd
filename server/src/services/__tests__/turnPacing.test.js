import test from 'node:test';
import assert from 'node:assert/strict';
import { BEATS, beatMs, createPacer, paceFactor } from '../turnPacing.js';

test('el ritmo se apaga en tests y corre normal fuera de ellos', () => {
  assert.equal(paceFactor({ NODE_ENV: 'test' }), 0);
  assert.equal(paceFactor({ NODE_ENV: 'production' }), 1);
  assert.equal(paceFactor({}), 1);
});

test('TRIDND_TURN_PACE manda sobre el entorno y descarta valores inválidos', () => {
  assert.equal(paceFactor({ NODE_ENV: 'test', TRIDND_TURN_PACE: '0.5' }), 0.5);
  assert.equal(paceFactor({ NODE_ENV: 'production', TRIDND_TURN_PACE: '0' }), 0);
  // Un valor negativo no adelanta el turno: se queda en cero.
  assert.equal(paceFactor({ TRIDND_TURN_PACE: '-3' }), 0);
  // Basura o cadena vacía: se ignora y vale el entorno.
  assert.equal(paceFactor({ NODE_ENV: 'production', TRIDND_TURN_PACE: 'rápido' }), 1);
  assert.equal(paceFactor({ NODE_ENV: 'test', TRIDND_TURN_PACE: '' }), 0);
});

test('la caminata se cobra por casilla y tiene techo', () => {
  assert.equal(beatMs('caminata', { cells: 1 }), BEATS.porCasilla);
  assert.equal(beatMs('caminata', { cells: 4 }), BEATS.porCasilla * 4);
  assert.equal(beatMs('caminata', { cells: 400 }), BEATS.caminataMax);
  // Sin recorrido no hay espera: quien no se mueve no hace esperar a la mesa.
  assert.equal(beatMs('caminata', { cells: 0 }), 0);
});

test('el factor escala todos los tiempos y a cero los anula', () => {
  assert.equal(beatMs('telegrafia', { factor: 2 }), BEATS.telegrafia * 2);
  assert.equal(beatMs('caminata', { cells: 3, factor: 0.5 }), (BEATS.porCasilla * 3) / 2);
  for (const name of [...Object.keys(BEATS), 'caminata']) {
    assert.equal(beatMs(name, { cells: 5, factor: 0 }), 0, `${name} debe anularse`);
  }
});

test('un tiempo mal escrito rompe en vez de desaparecer', () => {
  // Si un nombre inválido devolviese 0, el turno volvería a resolverse de
  // golpe sin que nada avisara.
  assert.throws(() => beatMs('telegrfia'), /Tiempo de turno desconocido/);
});

test('el marcador de ritmo resuelve al instante cuando está apagado', async () => {
  const pacer = createPacer({ NODE_ENV: 'test' });
  assert.equal(pacer.factor, 0);
  assert.equal(pacer.ms('entreAtaques'), 0);
  const started = Date.now();
  await pacer.wait('entreAtaques');
  await pacer.wait('caminata', { cells: 12 });
  assert.ok(Date.now() - started < 50, 'no debe esperar nada con el ritmo apagado');
});

test('el marcador de ritmo espera de verdad cuando está encendido', async () => {
  const pacer = createPacer({ TRIDND_TURN_PACE: '0.05' });
  const espera = pacer.ms('caminata', { cells: 4 });
  assert.ok(espera > 0, 'con ritmo encendido la caminata debe durar algo');
  const started = Date.now();
  await pacer.wait('caminata', { cells: 4 });
  assert.ok(Date.now() - started >= espera - 15, `esperó ${Date.now() - started}ms, esperaba ~${espera}ms`);
});

test('la espera resuelve aunque no haya nada más vivo en el proceso', async () => {
  // Regresión: el temporizador se desreferenciaba con `unref`, así que si la
  // espera era lo único pendiente el bucle de eventos moría con la promesa sin
  // resolver («Promise resolution is still pending»). Un turno a medias.
  const pacer = createPacer({ TRIDND_TURN_PACE: '0.02' });
  await pacer.wait('entreAtaques');
  assert.ok(true, 'la promesa resolvió');
});
