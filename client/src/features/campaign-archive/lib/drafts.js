// Los mutadores del Archivo recargan todos los nodos para conservar un único
// contrato con el backend. Estas funciones separan los valores editables de la
// respuesta remota y permiten conservarlos cuando la misma entidad vuelve con
// una referencia de objeto nueva.

export function entryDraftFrom(entry) {
  return {
    title: entry?.title ?? '',
    summary: entry?.summary ?? '',
    parentId: entry?.parentId ?? '',
    visibility: entry?.visibility === 'players' ? 'players' : 'private',
    icon: entry?.iconAutomatic === false ? entry.icon ?? '' : '',
  };
}

export function blockDraftFrom(block) {
  return {
    content: block?.content ?? '',
    url: block?.url ?? '',
    caption: block?.caption ?? '',
    altText: block?.altText ?? '',
  };
}

export function keepDraftOnRefresh(currentDraft, currentEntityId, nextEntity, createDraft) {
  const nextId = nextEntity?.id ?? null;
  return currentEntityId === nextId ? currentDraft : createDraft(nextEntity);
}

export function blockDraftAfterPrivateUpload(currentDraft) {
  // La subida privada limpia la URL en el servidor, pero no debe borrar el pie,
  // el texto alternativo ni cualquier nota que el DM aún no haya guardado.
  return { ...currentDraft, url: '' };
}
