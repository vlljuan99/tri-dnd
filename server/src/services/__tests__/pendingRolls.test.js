import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingRolls } from '../pendingRolls.js';

// Relojes de mentira: el plazo se dispara a mano, sin esperar ocho segundos.
function fakeClock() {
  const timers = new Map();
  let next = 1;
  return {
    setTimer(fn) {
      const id = next;
      next += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fireAll() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    size: () => timers.size,
  };
}

function setup(handlers = {}) {
  const clock = fakeClock();
  const store = createPendingRolls({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: () => 1000 });
  const events = { creadas: [], resueltas: [] };
  store.configurar({
    creada: (p) => events.creadas.push(p),
    resuelta: (p, info) => events.resueltas.push({ ...p, ...info }),
    ...handlers,
  });
  let seq = 0;
  const tirar = () => {
    seq += 1;
    return { total: 10 + seq };
  };
  return { clock, store, events, tirar };
}

test('el dueño pulsa y el servidor tira en ese momento', async () => {
  const { store, events, tirar } = setup();
  const published = [];
  const promise = store.solicitar({
    campaignId: 3,
    characterId: 7,
    ownerUserId: 42,
    tipo: 'salvacion',
    etiqueta: 'Salvación de DES',
    cd: 15,
    tirar,
    alTirar: (roll) => published.push(roll),
  });
  assert.equal(events.creadas.length, 1);
  assert.equal(events.creadas[0].cd, null, 'la CD no se enseña si no está revelada');
  assert.equal(published.length, 0, 'no se tira hasta que alguien pulsa');

  assert.deepEqual(store.resolver(events.creadas[0].id, { userId: 42 }), { ok: true });
  const result = await promise;
  assert.equal(result.automatica, false);
  assert.equal(result.motivo, 'jugador');
  assert.deepEqual(published, [{ total: 11 }]);
  assert.equal(store.tamano(), 0);
});

test('si nadie pulsa en el plazo, se tira sola', async () => {
  const { store, clock, tirar } = setup();
  const promise = store.solicitar({ campaignId: 1, ownerUserId: 5, tipo: 'iniciativa', etiqueta: 'Iniciativa', tirar });
  assert.equal(clock.size(), 1);
  clock.fireAll();
  const result = await promise;
  assert.equal(result.automatica, true);
  assert.equal(result.motivo, 'plazo');
  assert.equal(result.roll.total, 11);
});

test('una pendiente ajena no la puede resolver otro jugador; el DM sí, como tirada automática', async () => {
  const { store, events, tirar } = setup();
  const promise = store.solicitar({ campaignId: 1, ownerUserId: 5, tipo: 'salvacion', etiqueta: 'x', tirar });
  const id = events.creadas[0].id;
  assert.deepEqual(store.resolver(id, { userId: 6 }), { error: 'Esa tirada no es tuya' });
  assert.deepEqual(store.resolver(id, { userId: 99, isDm: true }), { ok: true });
  const result = await promise;
  assert.equal(result.motivo, 'dm');
  assert.equal(result.automatica, true);
  assert.deepEqual(store.resolver(id, { userId: 5 }), { error: 'Esa tirada ya no está pendiente' });
});

test('con «tirar automáticamente» (o sin dueño) no se crea espera', async () => {
  const { store, events, clock, tirar } = setup({ debeTirarSola: (p) => p.ownerUserId === 5 });
  const auto = await store.solicitar({ campaignId: 1, ownerUserId: 5, tipo: 'salvacion', etiqueta: 'x', tirar });
  assert.equal(auto.motivo, 'sin-espera');
  const noOwner = await store.solicitar({ campaignId: 1, ownerUserId: null, tipo: 'salvacion', etiqueta: 'x', tirar });
  assert.equal(noOwner.motivo, 'sin-espera');
  assert.equal(events.creadas.length, 0);
  assert.equal(clock.size(), 0);
});

test('el jugador ve solo las suyas y el DM todas; forzar tira por todas', async () => {
  const { store, tirar } = setup();
  const a = store.solicitar({ campaignId: 2, characterId: 1, ownerUserId: 10, tipo: 'salvacion', etiqueta: 'a', tirar });
  const b = store.solicitar({ campaignId: 2, characterId: 2, ownerUserId: 11, tipo: 'salvacion', etiqueta: 'b', tirar });
  const other = store.solicitar({ campaignId: 9, characterId: 3, ownerUserId: 10, tipo: 'salvacion', etiqueta: 'c', tirar });
  assert.equal(store.listar(2, { userId: 10 }).length, 1);
  assert.equal(store.listar(2, { isDm: true }).length, 2);
  assert.ok(store.buscar(2, { characterId: 2, tipo: 'salvacion' }));
  assert.equal(store.forzar(2), 2);
  const results = await Promise.all([a, b]);
  assert.ok(results.every((result) => result.motivo === 'dm'));
  assert.equal(store.tamano(), 1, 'la de otra campaña sigue pendiente');
  store.forzar(9);
  await other;
});

test('cancelar retira sin tirar y la promesa lo dice', async () => {
  const { store, events, tirar } = setup();
  const published = [];
  const promise = store.solicitar({
    campaignId: 4,
    ownerUserId: 1,
    tipo: 'iniciativa',
    etiqueta: 'Iniciativa',
    tirar,
    alTirar: (roll) => published.push(roll),
  });
  const keep = store.solicitar({ campaignId: 4, ownerUserId: 1, tipo: 'prueba', etiqueta: 'Sigilo', tirar });
  assert.equal(store.cancelar(4, { tipos: ['iniciativa'] }), 1);
  const result = await promise;
  assert.equal(result.cancelada, true);
  assert.equal(result.roll, null);
  assert.deepEqual(published, []);
  assert.equal(events.resueltas.at(-1).motivo, 'cancelada');
  assert.equal(store.tamano(), 1);
  store.forzar(4);
  await keep;
});

test('la CD revelada sí viaja con la pendiente', () => {
  const { store, events, tirar } = setup();
  store.solicitar({ campaignId: 1, ownerUserId: 3, tipo: 'prueba', etiqueta: 'Atletismo', cd: 13, revelarCd: true, tirar });
  assert.equal(events.creadas[0].cd, 13);
  store.forzar(1);
});
