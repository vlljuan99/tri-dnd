import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReadiness,
  computeStatuses,
} from '../../taller/hooks/useTallerProgress.js';

function progressData(overrides = {}) {
  return {
    campaign: { status: 'complete', description: '', lore: '', objectives: [] },
    members: [],
    world: { maps: [] },
    gestion: { characters: [], library: { objetos: [], hechizos: [] } },
    maps: [],
    archive: { nodes: [] },
    eventos: { links: [] },
    ...overrides,
  };
}

test('Mundo distingue una imagen empezada de un mundo con ubicaciones completo', () => {
  const withImage = computeStatuses(
    progressData({ world: { maps: [{ id: 1, imageUrl: '/mundo.webp', locations: [] }] } })
  );
  assert.equal(withImage.mundo, 'started');

  const withLocation = computeStatuses(
    progressData({
      world: {
        maps: [{ id: 1, imageUrl: '/mundo.webp', locations: [{ id: 8, name: 'Puerto' }] }],
      },
    })
  );
  assert.equal(withLocation.mundo, 'done');
});

test('Mapas solo está completo cuando uno se ha llevado a la mesa', () => {
  assert.equal(
    computeStatuses(progressData({ maps: [{ id: 2, isActive: false }] })).mapas,
    'started'
  );
  assert.equal(
    computeStatuses(progressData({ maps: [{ id: 2, isActive: true }] })).mapas,
    'done'
  );
});

test('los pasos admiten estado vacío, empezado y completo', () => {
  const empty = computeStatuses(
    progressData({ campaign: { status: 'draft', description: '', lore: '', objectives: [] } })
  );
  assert.equal(empty.identidad, 'empty');

  const started = computeStatuses(
    progressData({
      campaign: { status: 'draft', description: 'Una idea inicial', lore: '', objectives: [] },
    })
  );
  assert.equal(started.identidad, 'started');
  assert.equal(progressData().campaign.status, 'complete');
  assert.equal(computeStatuses(progressData()).identidad, 'done');
});

test('la primera sesión exige simultáneamente mapa activo y jugador', () => {
  const missingBoth = computeReadiness({ members: [], maps: [{ id: 4, isActive: false }] });
  assert.equal(missingBoth.ready, false);
  assert.deepEqual(
    missingBoth.missing.map((requirement) => requirement.id),
    ['mapas', 'jugadores']
  );

  const ready = computeReadiness({
    members: [{ id: 1, role: 'dm' }, { id: 2, role: 'jugador' }],
    maps: [{ id: 4, name: 'Cripta', isActive: true }],
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.playerCount, 1);
  assert.equal(ready.activeMap.name, 'Cripta');
  assert.deepEqual(ready.missing, []);
});
