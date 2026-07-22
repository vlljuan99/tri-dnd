import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findActiveMention,
  prepareChatMessage,
  reconcileReferenceRanges,
  replaceMention,
  splitMessageReferences,
} from '../chatReferences.js';

test('detecta una mención y la reemplaza por un chip con rango estable', () => {
  const text = 'Mira @bola de fue';
  const mention = findActiveMention(text, text.length);
  assert.deepEqual(mention, { start: 5, end: 17, query: 'bola de fue' });
  const result = replaceMention(text, mention, { name: 'Bola de fuego', category: 'spells', index: 'fireball' });
  assert.equal(result.text, 'Mira @Bola de fuego');
  assert.deepEqual(result.reference, { start: 5, end: 19, category: 'spells', index: 'fireball' });
});

test('desplaza chips posteriores y descarta el chip que el usuario edita', () => {
  const references = [{ start: 5, end: 19, category: 'spells', index: 'fireball' }];
  assert.deepEqual(
    reconcileReferenceRanges('Mira @Bola de fuego', 'Ahora mira @Bola de fuego', references),
    [{ start: 11, end: 25, category: 'spells', index: 'fireball' }]
  );
  assert.deepEqual(
    reconcileReferenceRanges('Mira @Bola de fuego', 'Mira @Bola de fuegX', references),
    []
  );
});

test('al recortar el mensaje ajusta los rangos y lo divide para pintarlo', () => {
  const prepared = prepareChatMessage('  Mira @Goblin  ', [
    { start: 7, end: 14, category: 'monsters', index: 'goblin' },
  ]);
  assert.deepEqual(prepared, {
    text: 'Mira @Goblin',
    references: [{ start: 5, end: 12, category: 'monsters', index: 'goblin' }],
  });
  assert.deepEqual(splitMessageReferences(prepared.text, prepared.references), [
    { type: 'text', text: 'Mira ' },
    { type: 'reference', text: '@Goblin', reference: prepared.references[0] },
  ]);
});
