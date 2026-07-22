import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeExternalUrl,
  inferNarrativeIcon,
  NARRATIVE_ICONS,
  normalizeExternalUrl,
  serializeNarrativeNode,
  validateRasterImage,
  wouldCreateNarrativeCycle,
} from '../campaignArchive.js';

test('los iconos del archivo tienen defaults contextuales y catálogo cerrado', () => {
  assert.equal(inferNarrativeIcon('seccion', 'Lore general'), 'book');
  assert.equal(inferNarrativeIcon('seccion', 'Facciones'), 'flag');
  assert.equal(inferNarrativeIcon('entrada', 'Notas'), 'document');
  assert.equal(NARRATIVE_ICONS.has('crown'), true);
  assert.equal(NARRATIVE_ICONS.has('<svg>'), false);
});

test('la serialización expone el icono efectivo y si sigue en automático', () => {
  const base = {
    id: 7,
    parent_id: null,
    kind: 'seccion',
    title: 'Lugares',
    summary: '',
    visibility: 'private',
    position: 0,
    created_at: 'ahora',
    updated_at: 'ahora',
  };
  assert.deepEqual(
    { icon: serializeNarrativeNode({ ...base, icon: null }).icon, automatic: serializeNarrativeNode({ ...base, icon: null }).iconAutomatic },
    { icon: 'pin', automatic: true }
  );
  assert.deepEqual(
    { icon: serializeNarrativeNode({ ...base, icon: 'castle' }).icon, automatic: serializeNarrativeNode({ ...base, icon: 'castle' }).iconAutomatic },
    { icon: 'castle', automatic: false }
  );
});

test('el archivo solo acepta enlaces web externos seguros', () => {
  assert.equal(isSafeExternalUrl('https://example.com/video?id=7'), true);
  assert.equal(isSafeExternalUrl('http://localhost:8080/audio.ogg'), true);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('data:text/html,hola'), false);
  assert.equal(isSafeExternalUrl('file:///secreto.txt'), false);
  assert.equal(isSafeExternalUrl('https://usuario:clave@example.com'), false);
  assert.equal(normalizeExternalUrl('   '), null);
  assert.equal(normalizeExternalUrl('no es una url'), undefined);
});

test('una sección no puede moverse dentro de su propio descendiente', () => {
  const parents = new Map([
    [1, null],
    [2, 1],
    [3, 2],
    [4, null],
  ]);
  const parentOf = (id) => parents.get(id) ?? null;

  assert.equal(wouldCreateNarrativeCycle(1, 3, parentOf), true);
  assert.equal(wouldCreateNarrativeCycle(2, 2, parentOf), true);
  assert.equal(wouldCreateNarrativeCycle(3, 4, parentOf), false);
  assert.equal(wouldCreateNarrativeCycle(3, null, parentOf), false);
});

test('la subida privada comprueba MIME y firma raster', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  const gif = Buffer.from('GIF89a', 'ascii');

  assert.deepEqual(validateRasterImage(png, 'image/png'), { mime: 'image/png', extension: '.png' });
  assert.deepEqual(validateRasterImage(jpeg, 'image/jpeg'), { mime: 'image/jpeg', extension: '.jpg' });
  assert.deepEqual(validateRasterImage(webp, 'image/webp'), { mime: 'image/webp', extension: '.webp' });
  assert.deepEqual(validateRasterImage(gif, 'image/gif'), { mime: 'image/gif', extension: '.gif' });
  assert.equal(validateRasterImage(Buffer.from('<svg></svg>'), 'image/svg+xml'), null);
  assert.equal(validateRasterImage(png, 'image/jpeg'), null);
});
