import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectedPlayerCount,
  mapActivationContext,
  matchesRequiredText,
} from '../../../lib/confirmations.js';

test('cuenta conectados sin incluir al DM ni duplicar reglas de interfaz', () => {
  const online = [{ id: 10, name: 'DM' }, { id: 20, name: 'A' }, { id: 30, name: 'B' }];
  assert.equal(connectedPlayerCount(online, 10), 2);
});

test('pide confirmación siempre que haya jugadores conectados, esté o no en vivo', () => {
  const online = [{ id: 10 }, { id: 20 }];
  assert.deepEqual(mapActivationContext({ isLive: true, online, dmUserId: 10 }), {
    isLive: true,
    playerCount: 1,
    requiresConfirmation: true,
  });
  assert.equal(mapActivationContext({ isLive: false, online, dmUserId: 10 }).requiresConfirmation, true);
  assert.equal(mapActivationContext({ isLive: true, online: [{ id: 10 }], dmUserId: 10 }).requiresConfirmation, false);
});

test('la confirmación destructiva exige coincidencia exacta', () => {
  assert.equal(matchesRequiredText('La Cripta', 'La Cripta'), true);
  assert.equal(matchesRequiredText('la cripta', 'La Cripta'), false);
  assert.equal(matchesRequiredText('La Cripta ', 'La Cripta'), false);
});
