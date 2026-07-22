import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRepartoCharacters,
  filterRepartoLibrary,
  repartoCategoryCounts,
} from '../lib/reparto.js';

const characters = [
  { id: 1, name: 'Áurea', dmCategory: 'pnj', assigned: true },
  { id: 2, name: 'Dragón rojo', dmCategory: 'enemigo', assigned: true },
  { id: 3, name: 'El Regente', dmCategory: 'jefe', assigned: false },
];

test('Reparto muestra solo la campaña por defecto y combina búsqueda y categoría', () => {
  assert.deepEqual(filterRepartoCharacters(characters).map((item) => item.id), [1, 2]);
  assert.deepEqual(
    filterRepartoCharacters(characters, { query: 'dragon', category: 'enemigo', onlyCampaign: true }).map((item) => item.id),
    [2]
  );
  assert.deepEqual(
    filterRepartoCharacters(characters, { query: 'regente', category: 'jefe', onlyCampaign: false }).map((item) => item.id),
    [3]
  );
});

test('los chips cuentan el resultado dentro del alcance y la búsqueda', () => {
  assert.deepEqual(repartoCategoryCounts(characters), { todos: 2, pnj: 1, enemigo: 1, jefe: 0 });
  assert.deepEqual(repartoCategoryCounts(characters, { query: 'a', onlyCampaign: false }), {
    todos: 2,
    pnj: 1,
    enemigo: 1,
    jefe: 0,
  });
});

test('objetos y hechizos respetan búsqueda y alcance de campaña', () => {
  const entries = [
    { name: 'Poción de curación', assigned: true },
    { name: 'Báculo de hielo', assigned: false },
  ];
  assert.deepEqual(filterRepartoLibrary(entries).map((item) => item.name), ['Poción de curación']);
  assert.deepEqual(
    filterRepartoLibrary(entries, { query: 'baculo', onlyCampaign: false }).map((item) => item.name),
    ['Báculo de hielo']
  );
});
