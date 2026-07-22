import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTallerReturnSearch, resolveCharacterReturn } from '../../../lib/characterReturn.js';

test('construye y resuelve un retorno explícito al Taller', () => {
  const search = buildTallerReturnSearch(24, 'reparto');
  assert.equal(search, '?volver=taller&campana=24&paso=reparto');
  assert.deepEqual(resolveCharacterReturn(search), {
    to: '/campanas/24/taller/reparto',
    label: 'Volver al Taller',
    search,
  });
});

test('rechaza destinos manipulados y nunca acepta una URL arbitraria', () => {
  assert.equal(resolveCharacterReturn('?volver=https://evil.example&campana=24&paso=reparto'), null);
  assert.equal(resolveCharacterReturn('?volver=taller&campana=../24&paso=reparto'), null);
  assert.equal(resolveCharacterReturn('?volver=taller&campana=24&paso=https://evil.example'), null);
  assert.equal(buildTallerReturnSearch('no-es-id', 'reparto'), '');
});
