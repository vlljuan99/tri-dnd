import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { parseUvtt, uvttImageBlob } from '../lib/uvtt.js';

// Estado y llamadas a la API del editor de mapas del DM. Tras cada mutación
// se recarga el mapa completo del servidor: a la escala de un editor de
// preparación es más simple y fiable que mantener el estado a mano.
export function useMapEditor(campaignId) {
  const [maps, setMaps] = useState(null);
  const [selectedMapId, setSelectedMapId] = useState(null);
  const [map, setMap] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `/campaigns/${campaignId}/mapas`;

  const loadMaps = useCallback(async () => {
    const data = await api(base);
    setMaps(data.maps);
    return data.maps;
  }, [base]);

  const loadMap = useCallback(
    async (mapId) => {
      if (!mapId) {
        setMap(null);
        return;
      }
      const data = await api(`${base}/${mapId}`);
      setMap(data.map);
    },
    [base]
  );

  // Carga inicial: lista de mapas y selección del primero (el activo si existe)
  useEffect(() => {
    let cancelled = false;
    loadMaps()
      .then((loaded) => {
        if (cancelled || !loaded.length) return;
        const initial = loaded.find((m) => m.isActive) || loaded[0];
        setSelectedMapId(initial.id);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [loadMaps]);

  useEffect(() => {
    let cancelled = false;
    setMap(null);
    if (!selectedMapId) return undefined;
    loadMap(selectedMapId).catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMapId, loadMap]);

  // Envuelve una mutación: gestiona busy/error y recarga lista y mapa
  const mutate = useCallback(
    async (action, { refreshMap = true, refreshList = true } = {}) => {
      setBusy(true);
      setError('');
      try {
        const result = await action();
        if (refreshList) await loadMaps();
        if (refreshMap && selectedMapId) await loadMap(selectedMapId);
        return result;
      } catch (e) {
        setError(e.message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [loadMaps, loadMap, selectedMapId]
  );

  return {
    maps,
    map,
    selectedMapId,
    setSelectedMapId,
    error,
    setError,
    busy,

    createMap: (name) =>
      mutate(async () => {
        const { map: created } = await api(base, { method: 'POST', body: { name } });
        setSelectedMapId(created.id);
        return created;
      }),

    // Importa un archivo Universal VTT (.dd2vtt/.uvtt): crea un mapa nuevo
    // con una sala del tamaño exacto del archivo, sube su imagen (la
    // cuadrícula viene definida, no hace falta calibrar) y aplica los muros
    // como paredes por arista.
    importUvtt: (file) =>
      mutate(async () => {
        const parsed = parseUvtt(await file.text());
        if (parsed.cols > 100 || parsed.rows > 100) {
          throw new Error(
            `El mapa UVTT mide ${parsed.cols}×${parsed.rows} casillas y el máximo por sala es 100`
          );
        }
        const name = file.name.replace(/\.[^.]+$/, '') || 'Mapa UVTT';
        const { map: created } = await api(base, { method: 'POST', body: { name } });

        let floorId = created.floors?.[0]?.id;
        if (!floorId) {
          const { floor } = await api(`${base}/${created.id}/plantas`, { method: 'POST', body: {} });
          floorId = floor.id;
        }
        const { room } = await api(`${base}/${created.id}/plantas/${floorId}/salas`, {
          method: 'POST',
          body: { name, x: 0, y: 0, width: parsed.cols, height: parsed.rows },
        });

        const blob = await uvttImageBlob(parsed);
        const upload = await fetch(`/api${base}/${created.id}/salas/${room.id}/imagen`, {
          method: 'PATCH',
          headers: { 'Content-Type': blob.type || 'image/webp' },
          body: blob,
          credentials: 'same-origin',
        });
        if (!upload.ok) {
          const data = await upload.json().catch(() => ({}));
          throw new Error(data.error || 'No se pudo subir la imagen del UVTT');
        }

        if (parsed.wallEdges.length) {
          await api(`${base}/${created.id}/salas/${room.id}`, {
            method: 'PATCH',
            body: { wallEdges: parsed.wallEdges },
          });
        }
        setSelectedMapId(created.id);
        return created;
      }),
    renameMap: (mapId, name) => mutate(() => api(`${base}/${mapId}`, { method: 'PATCH', body: { name } })),
    patchMap: (mapId, fields) => mutate(() => api(`${base}/${mapId}`, { method: 'PATCH', body: fields })),
    deleteMap: (mapId) =>
      mutate(async () => {
        await api(`${base}/${mapId}`, { method: 'DELETE' });
        if (mapId === selectedMapId) setSelectedMapId(null);
      }),
    activateMap: (mapId) => mutate(() => api(`${base}/${mapId}/activar`, { method: 'POST' })),

    addFloor: () => mutate(() => api(`${base}/${selectedMapId}/plantas`, { method: 'POST', body: {} })),
    renameFloor: (floorId, name) =>
      mutate(() => api(`${base}/${selectedMapId}/plantas/${floorId}`, { method: 'PATCH', body: { name } })),
    deleteFloor: (floorId) =>
      mutate(() => api(`${base}/${selectedMapId}/plantas/${floorId}`, { method: 'DELETE' })),

    addRoom: (floorId, room) =>
      mutate(() =>
        api(`${base}/${selectedMapId}/plantas/${floorId}/salas`, { method: 'POST', body: room })
      ),
    patchRoom: (roomId, fields) =>
      mutate(() => api(`${base}/${selectedMapId}/salas/${roomId}`, { method: 'PATCH', body: fields })),
    deleteRoom: (roomId) =>
      mutate(() => api(`${base}/${selectedMapId}/salas/${roomId}`, { method: 'DELETE' })),

    addToken: (roomId, token) =>
      mutate(() =>
        api(`${base}/${selectedMapId}/salas/${roomId}/fichas`, { method: 'POST', body: token })
      ),
    patchToken: (tokenId, fields) =>
      mutate(() => api(`${base}/${selectedMapId}/fichas/${tokenId}`, { method: 'PATCH', body: fields })),
    deleteToken: (tokenId) =>
      mutate(() => api(`${base}/${selectedMapId}/fichas/${tokenId}`, { method: 'DELETE' })),

    addDoor: (door) => mutate(() => api(`${base}/${selectedMapId}/puertas`, { method: 'POST', body: door })),
    patchDoor: (doorId, fields) =>
      mutate(() => api(`${base}/${selectedMapId}/puertas/${doorId}`, { method: 'PATCH', body: fields })),
    deleteDoor: (doorId) =>
      mutate(() => api(`${base}/${selectedMapId}/puertas/${doorId}`, { method: 'DELETE' })),

    uploadRoomImage: (roomId, file) =>
      mutate(async () => {
        const res = await fetch(`/api${base}/${selectedMapId}/salas/${roomId}/imagen`, {
          method: 'PATCH',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
        return data.room;
      }),
    generateRoomImage: (roomId, { prompt, provider }) =>
      mutate(() =>
        api(`${base}/${selectedMapId}/salas/${roomId}/imagen/generar`, {
          method: 'POST',
          body: { prompt, provider },
        })
      ),
    removeRoomImage: (roomId) =>
      mutate(() => api(`${base}/${selectedMapId}/salas/${roomId}/imagen`, { method: 'DELETE' })),
  };
}
