import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRollCommand, rollChatCommand } from '../../../lib/chatCommands.js';

test('parsea /r con varios dados, modificador y etiqueta', () => {
  assert.deepEqual(parseRollCommand('/r 2d6 + 1d4 - 2 Da\u00f1o de fuego'), {
    pool: { d4: 1, d6: 2, d8: 0, d10: 0, d12: 0, d20: 0, d100: 0 },
    modifier: -2,
    label: 'Da\u00f1o de fuego',
  });
});

test('distingue un mensaje normal y explica una formula invalida', () => {
  assert.equal(parseRollCommand('hola'), null);
  assert.match(parseRollCommand('/r patata').error, /f\u00f3rmula/);
  assert.match(parseRollCommand('/r 2d6-1d4').error, /restar dados/);
});

test('construye una tirada compartible', () => {
  const result = rollChatCommand('/r 1d20+4 Percepci\u00f3n');
  assert.equal(result.roll.formula, '1d20 + 4');
  assert.equal(result.roll.label, 'Percepci\u00f3n');
  assert.ok(result.roll.total >= 5 && result.roll.total <= 24);
});

test('/n convierte el mensaje en narración del DM (Fase 4d)', async () => {
  const { narrationCommand } = await import('../../../lib/chatCommands.js');
  assert.deepEqual(narrationCommand('/n El viento aúlla en el desfiladero.'), { text: 'El viento aúlla en el desfiladero.' });
  assert.deepEqual(narrationCommand('  /N  Silencio.  '), { text: 'Silencio.' });
  assert.ok(narrationCommand('/n').error, 'sin texto no hay nada que narrar');
  assert.equal(narrationCommand('hola /n'), null);
  assert.equal(narrationCommand('/nada'), null, 'solo el comando exacto');
});
