import { useEffect, useState } from 'react';
import { api } from '../../../api.js';

// Lectura del mapa de mundo para la mesa (cualquier rol). Se refresca con la
// señal de socket 'mundo:actualizado' (contador worldVersion): cuando el DM
// viaja o edita ubicaciones, todos repiden /mundo. Sin parpadeo de carga tras
// la primera vez (loadedOnce), igual que useTacticalMap.
export function useWorldState(campaignId, { enabled = true, version = 0 } = {}) {
  const [world, setWorld] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    api(`/campaigns/${campaignId}/mundo`)
      .then(({ world: w }) => {
        if (!cancelled) setWorld(w);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar el mapa de mundo.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, enabled, version]);

  return { world, loading, error };
}
