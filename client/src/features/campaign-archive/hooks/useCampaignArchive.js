import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api.js';
import { ARCHIVE_ICON_IDS, inferArchiveIcon } from '../lib/archiveIcons.js';

const numberOrNull = (value) => (value == null || value === '' ? null : Number(value));

function normalizeBlock(raw) {
  return {
    ...raw,
    id: Number(raw.id),
    nodeId: Number(raw.nodeId ?? raw.node_id ?? raw.nodoId ?? raw.nodo_id),
    type: raw.type ?? raw.kind ?? raw.tipo ?? 'texto',
    content: raw.content ?? raw.contenido ?? '',
    url: raw.url ?? '',
    caption: raw.caption ?? raw.pie ?? '',
    altText: raw.altText ?? raw.alt_text ?? '',
    position: Number(raw.position ?? raw.posicion ?? 0),
    hasImage: Boolean(
      raw.hasPrivateImage ?? raw.has_private_image ?? raw.hasImage ?? raw.has_image ?? raw.imageUrl ?? raw.image_url
    ),
    hasPrivateImage: Boolean(raw.hasPrivateImage ?? raw.has_private_image),
    imageUrl: raw.imageUrl ?? raw.image_url ?? null,
  };
}

function flattenNodes(rows, inheritedParentId = null, output = []) {
  for (const raw of rows ?? []) {
    const legacyPublished = raw.isPublished ?? raw.is_published ?? raw.published;
    const type = raw.type ?? raw.kind ?? raw.tipo ?? raw.nodeType ?? 'entrada';
    const title = raw.title ?? raw.titulo ?? '';
    const rawIcon = raw.icon ?? raw.icono;
    const hasValidIcon = ARCHIVE_ICON_IDS.has(rawIcon);
    const iconAutomatic = Boolean(
      raw.iconAutomatic ?? raw.icon_automatic ?? raw.iconoAutomatico ?? !hasValidIcon
    );
    const node = {
      ...raw,
      id: Number(raw.id),
      parentId: numberOrNull(raw.parentId ?? raw.parent_id ?? raw.padreId ?? raw.padre_id ?? inheritedParentId),
      type,
      title,
      summary: raw.summary ?? raw.resumen ?? '',
      visibility:
        raw.visibility === 'players' || raw.visibilidad === 'players' || legacyPublished === true || legacyPublished === 1
          ? 'players'
          : 'private',
      icon: hasValidIcon ? rawIcon : inferArchiveIcon(type, title),
      iconAutomatic,
      position: Number(raw.position ?? raw.posicion ?? 0),
      blocks: (raw.blocks ?? raw.bloques ?? []).map(normalizeBlock).sort((a, b) => a.position - b.position),
    };
    delete node.children;
    delete node.hijos;
    output.push(node);
    flattenNodes(raw.children ?? raw.hijos, node.id, output);
  }
  return output;
}

function unpackNodes(data, { preserveOrder = false } = {}) {
  const rows = Array.isArray(data) ? data : data.nodes ?? data.nodos ?? data.results ?? [];
  const nodes = flattenNodes(rows);
  return preserveOrder ? nodes : nodes.sort((a, b) => a.position - b.position || a.id - b.id);
}

export function useCampaignArchive(campaignId, { initialData = null, onData = null } = {}) {
  const [nodes, setNodes] = useState(() => unpackNodes(initialData ?? []));
  const [loading, setLoading] = useState(initialData == null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onDataRef = useRef(onData);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  const base = `/campaigns/${campaignId}/archivo`;

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await api(base);
      setNodes(unpackNodes(data));
      onDataRef.current?.(data);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    if (initialData != null) {
      setNodes(unpackNodes(initialData));
      setLoading(false);
      setError('');
      return;
    }
    reload().catch(() => {});
  }, [initialData, reload]);

  const mutate = useCallback(
    async (action) => {
      setBusy(true);
      setError('');
      try {
        const result = await action();
        await reload({ silent: true });
        return result;
      } catch (e) {
        setError(e.message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  const createNode = (body) => mutate(() => api(`${base}/nodos`, { method: 'POST', body }));
  const patchNode = (nodeId, body) => mutate(() => api(`${base}/nodos/${nodeId}`, { method: 'PATCH', body }));
  const deleteNode = (nodeId) => mutate(() => api(`${base}/nodos/${nodeId}`, { method: 'DELETE' }));
  const moveNode = (nodeId, body) => mutate(() => api(`${base}/nodos/${nodeId}/mover`, { method: 'POST', body }));
  const createBlock = (nodeId, body) =>
    mutate(() => api(`${base}/nodos/${nodeId}/bloques`, { method: 'POST', body }));
  const patchBlock = (blockId, body) =>
    mutate(() => api(`${base}/bloques/${blockId}`, { method: 'PATCH', body }));
  const deleteBlock = (blockId) => mutate(() => api(`${base}/bloques/${blockId}`, { method: 'DELETE' }));
  const moveBlock = (blockId, body) =>
    mutate(() => api(`${base}/bloques/${blockId}/mover`, { method: 'POST', body }));

  const search = useCallback(
    async (query) => {
      if (!query.trim()) return [];
      const data = await api(`${base}/buscar?q=${encodeURIComponent(query.trim())}`);
      return unpackNodes(data, { preserveOrder: true });
    },
    [base]
  );

  const uploadBlockImage = useCallback(
    async (blockId, file) => {
      setBusy(true);
      setError('');
      try {
        const response = await fetch(`/api${base}/bloques/${blockId}/imagen`, {
          method: 'PATCH',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
          credentials: 'same-origin',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo subir la imagen');
        await reload({ silent: true });
        return data;
      } catch (e) {
        setError(e.message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [base, reload]
  );

  return {
    nodes,
    loading,
    busy,
    error,
    reload,
    createNode,
    patchNode,
    deleteNode,
    moveNode,
    createBlock,
    patchBlock,
    deleteBlock,
    moveBlock,
    search,
    uploadBlockImage,
    privateImageUrl: (blockId) => `/api${base}/bloques/${blockId}/imagen`,
  };
}
