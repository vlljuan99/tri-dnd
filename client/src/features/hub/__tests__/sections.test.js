import test from 'node:test';
import assert from 'node:assert/strict';
import { HUB_SECTIONS, campaignTypeOf, isDraft, splitCampaigns } from '../sections.js';

test('las rutas de las secciones son estáticas y no chocan con /campanas/:id', () => {
  for (const section of HUB_SECTIONS) {
    assert.ok(section.path.startsWith('/campanas'), `${section.id}: fuera de la zona de campañas`);
    const rest = section.path.slice('/campanas'.length).replace(/^\//, '');
    // Un segmento dinámico (`:algo`) competiría en igualdad con el detalle de
    // campaña; los estáticos ganan siempre y los ids son numéricos.
    assert.ok(!rest.includes(':'), `${section.id}: la ruta no puede ser dinámica`);
    assert.ok(!/^\d+$/.test(rest), `${section.id}: la ruta no puede parecer un id`);
  }
  assert.equal(new Set(HUB_SECTIONS.map((s) => s.path)).size, HUB_SECTIONS.length);
});

test('el tipo de campaña cae al mapa de mundo solo si falta campaignType', () => {
  assert.equal(campaignTypeOf({ campaignType: 'escaramuza', hasWorldMap: true }), 'escaramuza');
  assert.equal(campaignTypeOf({ hasWorldMap: true }), 'campana');
  assert.equal(campaignTypeOf({ hasWorldMap: false }), 'escaramuza');
  assert.equal(isDraft({ status: 'draft' }), true);
  assert.equal(isDraft({ status: 'complete' }), false);
});

test('el reparto separa lo que diriges de lo que juegas', () => {
  const groups = splitCampaigns([
    { id: 1, role: 'dm', campaignType: 'campana' },
    { id: 2, role: 'dm', campaignType: 'escaramuza' },
    { id: 3, role: 'dm', campaignType: 'escaramuza', status: 'draft' },
    { id: 4, role: 'jugador', campaignType: 'campana' },
    { id: 5, role: 'jugador', campaignType: 'escaramuza' },
    { id: 6, role: 'jugador', owner: true, soloMode: true, campaignType: 'escaramuza' },
  ]);
  assert.deepEqual(groups.campanas.map((c) => c.id), [1]);
  assert.deepEqual(groups.escaramuzas.map((c) => c.id), [2, 3, 6]);
  // Donde juegas entran ambas: como jugador no distingues preparación
  assert.deepEqual(groups.ajenas.map((c) => c.id), [4, 5]);
});

test('sin campañas cargadas el reparto no revienta', () => {
  const groups = splitCampaigns(null);
  assert.deepEqual(groups, { campanas: [], escaramuzas: [], ajenas: [] });
});
