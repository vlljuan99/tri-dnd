import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_ICON_IDS,
  inferArchiveIcon,
  resolveArchiveIcon,
} from '../lib/archiveIcons.js';

test('los nodos existentes reciben un icono contextual sin configuración', () => {
  assert.equal(inferArchiveIcon('seccion', 'Lore general'), 'book');
  assert.equal(inferArchiveIcon('seccion', 'Personajes importantes'), 'users');
  assert.equal(inferArchiveIcon('seccion', 'Mapa del mundo'), 'map');
  assert.equal(inferArchiveIcon('seccion', 'Mis notas'), 'folder');
  assert.equal(inferArchiveIcon('entrada', 'Una nota cualquiera'), 'document');
});

test('un icono elegido prevalece sobre el valor contextual', () => {
  assert.equal(resolveArchiveIcon({ kind: 'entrada', title: 'Mapa del mundo', icon: 'crown' }), 'crown');
  assert.equal(resolveArchiveIcon({ kind: 'entrada', title: 'Mapa del mundo', icon: 'desconocido' }), 'map');
  assert.equal(ARCHIVE_ICON_IDS.has('sparkles'), true);
  assert.equal(ARCHIVE_ICON_IDS.has('desconocido'), false);
});
