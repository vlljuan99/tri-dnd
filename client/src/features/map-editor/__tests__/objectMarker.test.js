import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectMarkerLoot } from '../lib/objectMarker.js';

test('un objeto SRD elegido se convierte en un marcador saqueable', () => {
  assert.deepEqual(
    buildObjectMarkerLoot({ index: 'healing-potion', name: 'Poción de curación' }, 'loot-1'),
    [
      {
        id: 'loot-1',
        name: 'Poción de curación',
        source: 'srd',
        index: 'healing-potion',
        qty: 1,
        chance: 100,
      },
    ]
  );
});

test('los objetos propios conservan su índice sintético y su origen', () => {
  const [loot] = buildObjectMarkerLoot(
    { index: 'custom:42', name: 'Brújula de ceniza', custom: true },
    'loot-2'
  );

  assert.equal(loot.source, 'custom');
  assert.equal(loot.index, 'custom:42');
});

test('sin una elección válida no se altera el marcador de texto libre', () => {
  assert.equal(buildObjectMarkerLoot(null), undefined);
  assert.equal(buildObjectMarkerLoot({ name: 'Cofre' }), undefined);
});

