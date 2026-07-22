import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapCreationHref, readMapCreationIntent } from '../lib/mapCreationIntent.js';

test('construye un salto de creación que conserva nombre, ubicación y vuelta al mundo', () => {
  const href = buildMapCreationHref({ campaignId: 7, locationId: 42, name: 'Torre & cripta' });
  const url = new URL(href, 'http://localhost');

  assert.equal(url.pathname, '/campanas/7/editor');
  assert.equal(url.searchParams.get('nuevo'), '1');
  assert.equal(url.searchParams.get('nombre'), 'Torre & cripta');
  assert.equal(url.searchParams.get('ubicacion'), '42');
  assert.equal(url.searchParams.get('volver'), 'mundo');
});

test('interpreta la intención y normaliza ids y nombre', () => {
  const params = new URLSearchParams('nuevo=1&nombre=%20Templo%20&ubicacion=12&volver=mundo');

  assert.deepEqual(readMapCreationIntent(params), {
    requestedMapId: null,
    createMapIntent: true,
    requestedMapName: 'Templo',
    requestedLocationId: 12,
    returnToWorld: true,
  });
});
