import test from 'node:test';
import assert from 'node:assert/strict';
import { latestMessageId, pickIncomingRoll } from '../lib/incoming.js';

const tirada = (id, autorId, value = 14) => ({
  id,
  type: 'roll',
  author: { id: autorId, name: `Jugador ${autorId}` },
  body: { groups: [{ die: 'd20', sides: 20, results: [{ rolls: [value], kept: value }] }] },
});

const charla = (id, autorId) => ({ id, type: 'chat', author: { id: autorId }, body: 'hola' });

test('coge la última tirada ajena posterior al arranque', () => {
  const messages = [tirada(1, 5), charla(2, 5), tirada(3, 9)];
  const elegida = pickIncomingRoll(messages, { selfId: 5, sinceId: 0 });
  assert.equal(elegida.id, 3);
  assert.equal(elegida.authorName, 'Jugador 9');
});

test('no repite las tiradas propias, que ya ruedan al lanzarlas', () => {
  const messages = [tirada(1, 9), tirada(2, 5)];
  // La última es mía: se salta y se coge la anterior, que es ajena.
  assert.equal(pickIncomingRoll(messages, { selfId: 5, sinceId: 0 }).id, 1);
  // Y si todas son mías, no rueda nada.
  assert.equal(pickIncomingRoll([tirada(1, 5), tirada(2, 5)], { selfId: 5, sinceId: 0 }), null);
});

test('al entrar en la mesa no se pone a rodar el historial', () => {
  const historial = [tirada(1, 9), tirada(2, 9), tirada(3, 9)];
  const arranque = latestMessageId(historial);
  assert.equal(arranque, 3);
  assert.equal(pickIncomingRoll(historial, { selfId: 5, sinceId: arranque }), null);
  // Pero la siguiente que llegue sí rueda.
  const conNueva = [...historial, tirada(4, 9)];
  assert.equal(pickIncomingRoll(conNueva, { selfId: 5, sinceId: arranque }).id, 4);
});

test('una tirada ya vista no vuelve a rodar', () => {
  const messages = [tirada(1, 9), tirada(2, 9)];
  assert.equal(pickIncomingRoll(messages, { selfId: 5, sinceId: 2 }), null);
});

test('se ignora lo que no sea una tirada con dados que rueden', () => {
  // Charla suelta.
  assert.equal(pickIncomingRoll([charla(1, 9)], { selfId: 5, sinceId: 0 }), null);
  // Tirada sin dados con cuerpo: nada que enseñar, pero no debe romper.
  const soloModificador = { id: 1, type: 'roll', author: { id: 9 }, body: { groups: [] } };
  assert.equal(pickIncomingRoll([soloModificador], { selfId: 5, sinceId: 0 }), null);
  assert.equal(pickIncomingRoll([], { selfId: 5, sinceId: 0 }), null);
  assert.equal(pickIncomingRoll(undefined, { selfId: 5, sinceId: 0 }), null);
});

test('un percentil ajeno también rueda', () => {
  const percentil = {
    id: 4,
    type: 'roll',
    author: { id: 9, name: 'Dani' },
    body: { groups: [{ die: 'd100', sides: 100, results: [{ rolls: [73], kept: 73 }] }] },
  };
  const elegida = pickIncomingRoll([percentil], { selfId: 5, sinceId: 0 });
  assert.equal(elegida.id, 4);
  assert.equal(elegida.authorName, 'Dani');
});

test('latestMessageId aguanta ids raros y listas vacías', () => {
  assert.equal(latestMessageId([]), 0);
  assert.equal(latestMessageId(undefined), 0);
  assert.equal(latestMessageId([{ id: 'x' }, { id: 7 }, {}]), 7);
});
