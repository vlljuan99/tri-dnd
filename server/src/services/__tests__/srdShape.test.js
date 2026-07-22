import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeta, SRD_CATEGORIES, SRD_CATEGORY_KEYS } from '../srdShape.js';

test('expone las 24 categorías del catálogo SRD 2014 sin duplicados', () => {
  assert.equal(SRD_CATEGORY_KEYS.length, 24);
  assert.equal(new Set(SRD_CATEGORY_KEYS).size, SRD_CATEGORY_KEYS.length);
  assert.equal(SRD_CATEGORIES.every(({ key, label }) => key && label), true);
  assert.equal(SRD_CATEGORY_KEYS.includes('features'), true);
  assert.equal(SRD_CATEGORY_KEYS.includes('magic-items'), true);
  assert.equal(SRD_CATEGORY_KEYS.includes('rules'), true);
});

test('resume categorías que antes no aparecían en el buscador', () => {
  assert.deepEqual(buildMeta('features', {
    level: 2,
    class: { index: 'fighter' },
    subclass: { index: 'champion' },
  }), { level: 2, class: 'fighter', subclass: 'champion' });

  assert.deepEqual(buildMeta('magic-items', {
    equipment_category: { index: 'wondrous-items' },
    rarity: { name: 'Rare' },
  }), { equipmentCategory: 'wondrous-items', rarity: 'Rare' });
});

test('normaliza la CA de monstruos antigua y moderna', () => {
  assert.equal(buildMeta('monsters', { armor_class: 15 }).ac, 15);
  assert.equal(buildMeta('monsters', { armor_class: [{ type: 'natural', value: 17 }] }).ac, 17);
  assert.equal(buildMeta('monsters', {}).ac, null);
});
