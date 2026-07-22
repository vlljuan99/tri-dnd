import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCampaignScreen, isDiceContext } from '../../../lib/gameContext.js';

test('muestra el tirador en la mesa y en la ficha de personaje', () => {
  assert.equal(isDiceContext('/campanas/12'), true);
  assert.equal(isDiceContext('/campanas/12/'), true);
  assert.equal(isDiceContext('/personajes/7'), true);
});

test('oculta el tirador durante la preparación y la consulta', () => {
  const preparationRoutes = [
    '/',
    '/campanas/12/taller',
    '/campanas/12/taller/mapas',
    '/campanas/12/archivo',
    '/campanas/12/mundo',
    '/campanas/12/editor',
    '/personajes',
    '/personajes/7/asistente',
    '/biblioteca',
    '/compendio',
  ];

  for (const pathname of preparationRoutes) {
    assert.equal(isDiceContext(pathname), false, pathname);
  }
});

test('la mesa entra directamente al contenido jugable, nunca al campamento', () => {
  assert.equal(initialCampaignScreen({ hasWorldMap: false }), 'board');
  assert.equal(
    initialCampaignScreen({
      hasWorldMap: true,
      currentLocationId: 3,
      currentLocation: { id: 3, kind: 'campamento', mapId: 9 },
    }),
    'board'
  );
  assert.equal(
    initialCampaignScreen({
      hasWorldMap: true,
      currentLocationId: 3,
      currentLocation: { id: 3, kind: 'campamento', mapId: null },
    }),
    'world'
  );
  assert.equal(initialCampaignScreen({ hasWorldMap: true, currentLocationId: null }), 'world');
});
