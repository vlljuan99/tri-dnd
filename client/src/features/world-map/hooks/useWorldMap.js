import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api.js';

// Estado y llamadas del editor del mapa de mundo (solo DM). Mismo patrón que
// useMapEditor: tras cada mutación se recarga todo del servidor, más simple y
// fiable a la escala de un editor de preparación. Además carga la biblioteca de
// mapas de la campaña para poder enlazar cada ubicación a un tablero.
export function useWorldMap(campaignId) {
  const [world, setWorld] = useState(null);
  const [maps, setMaps] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `/campaigns/${campaignId}/mundo`;

  const load = useCallback(async () => {
    const [{ world: w }, { maps: m }] = await Promise.all([
      api(base),
      api(`/campaigns/${campaignId}/mapas`),
    ]);
    setWorld(w);
    setMaps(m);
  }, [base, campaignId]);

  useEffect(() => {
    let cancelled = false;
    load().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const mutate = useCallback(
    async (action) => {
      setBusy(true);
      setError('');
      try {
        const result = await action();
        await load();
        return result;
      } catch (e) {
        setError(e.message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return {
    world,
    maps,
    error,
    setError,
    busy,

    uploadImage: (file) =>
      mutate(async () => {
        const res = await fetch(`/api${base}/imagen`, {
          method: 'PATCH',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
        return data.world;
      }),
    generateImage: ({ prompt, provider }) =>
      mutate(() => api(`${base}/imagen/generar`, { method: 'POST', body: { prompt, provider } })),
    removeImage: () => mutate(() => api(`${base}/imagen`, { method: 'DELETE' })),

    createLocation: ({ x, y }) => mutate(() => api(`${base}/ubicaciones`, { method: 'POST', body: { x, y } })),
    updateLocation: (locId, fields) =>
      mutate(() => api(`${base}/ubicaciones/${locId}`, { method: 'PATCH', body: fields })),
    deleteLocation: (locId) => mutate(() => api(`${base}/ubicaciones/${locId}`, { method: 'DELETE' })),
  };
}
