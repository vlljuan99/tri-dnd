import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChatReferences, standaloneChatReference } from '../chatReferences.js';

const entries = new Map([
  ['spells:fireball', { category: 'spells', idx: 'fireball', name_es: 'Bola de fuego', name_en: 'Fireball' }],
  ['monsters:goblin', { category: 'monsters', idx: 'goblin', name_es: null, name_en: 'Goblin' }],
]);
const lookup = (category, index) => entries.get(`${category}:${index}`);

test('canoniza referencias públicas del SRD y conserva su posición', () => {
  const text = 'Lanza @Bola de fuego aquí';
  const result = sanitizeChatReferences(text, [
    { start: 6, end: 20, category: 'spells', index: 'fireball' },
  ], lookup);

  assert.deepEqual(result, {
    references: [{
      start: 6,
      end: 20,
      category: 'spells',
      index: 'fireball',
      name: 'Bola de fuego',
      translated: true,
    }],
  });
});

test('rechaza rangos manipulados, solapados o que no existan en el SRD', () => {
  const text = '@Bola de fuego @Goblin';
  assert.ok(sanitizeChatReferences(text, [
    { start: 1, end: 14, category: 'spells', index: 'fireball' },
  ], lookup).error);
  assert.ok(sanitizeChatReferences(text, [
    { start: 0, end: 14, category: 'spells', index: 'fireball' },
    { start: 10, end: 22, category: 'monsters', index: 'goblin' },
  ], lookup).error);
  assert.ok(sanitizeChatReferences('@Privado', [
    { start: 0, end: 8, category: 'spells', index: 'custom:1' },
  ], lookup).error);
});

test('construye el mensaje independiente que se comparte desde el detalle', () => {
  assert.deepEqual(standaloneChatReference(entries.get('monsters:goblin')), {
    text: '@Goblin',
    references: [{
      start: 0,
      end: 7,
      category: 'monsters',
      index: 'goblin',
      name: 'Goblin',
      translated: false,
    }],
  });
});
