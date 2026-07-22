import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockDraftAfterPrivateUpload,
  blockDraftFrom,
  entryDraftFrom,
  keepDraftOnRefresh,
} from '../lib/drafts.js';

test('una recarga de la misma entrada conserva título y resumen sin guardar', () => {
  const remote = { id: 7, title: 'Guardado', summary: 'Resumen guardado', parentId: 2, blocks: [] };
  const draft = { ...entryDraftFrom(remote), title: 'Título en curso', summary: 'Resumen en curso' };
  const refreshed = { ...remote, updatedAt: 'más tarde', blocks: [{ id: 1 }] };

  assert.strictEqual(keepDraftOnRefresh(draft, remote.id, refreshed, entryDraftFrom), draft);
});

test('al seleccionar otra entrada se carga su borrador remoto', () => {
  const current = { title: 'Sin guardar', summary: '', parentId: 1 };
  const next = { id: 9, title: 'Otra entrada', summary: 'Otro resumen', parentId: 3 };

  assert.deepEqual(keepDraftOnRefresh(current, 7, next, entryDraftFrom), entryDraftFrom(next));
});

test('el borrador normaliza la visibilidad de una entrada', () => {
  assert.equal(entryDraftFrom({ visibility: 'players' }).visibility, 'players');
  assert.equal(entryDraftFrom({}).visibility, 'private');
});

test('el borrador distingue el icono automático de uno elegido', () => {
  assert.equal(entryDraftFrom({ icon: 'book', iconAutomatic: true }).icon, '');
  assert.equal(entryDraftFrom({ icon: 'crown', iconAutomatic: false }).icon, 'crown');
});

test('reordenar o añadir bloques no borra el contenido local del mismo bloque', () => {
  const remote = { id: 11, content: 'Guardado', url: '', caption: '', altText: '', position: 0 };
  const draft = { ...blockDraftFrom(remote), content: 'Texto todavía sin guardar' };
  const refreshed = { ...remote, position: 2 };

  assert.strictEqual(keepDraftOnRefresh(draft, remote.id, refreshed, blockDraftFrom), draft);
});

test('subir una imagen limpia solo la URL y conserva el resto del borrador', () => {
  const draft = {
    content: 'Nota sin guardar',
    url: 'https://example.com/anterior.jpg',
    caption: 'Pie sin guardar',
    altText: 'Descripción sin guardar',
  };

  assert.deepEqual(blockDraftAfterPrivateUpload(draft), {
    ...draft,
    url: '',
  });
});
