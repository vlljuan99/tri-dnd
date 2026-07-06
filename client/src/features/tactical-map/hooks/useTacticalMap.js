import { useEffect, useMemo, useState } from 'react';
import { tacticalMapRepository } from '../repositories/TestTacticalMapRepository.js';
import { useTokenMovement } from './useTokenMovement.js';

export function useTacticalMap(campaignId, { user, role, enabled = true } = {}) {
  const repository = useMemo(() => tacticalMapRepository, []);
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingTokenId, setSavingTokenId] = useState(null);

  useEffect(() => {
    if (!enabled || !campaignId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setSaveError('');

    repository
      .getMapByCampaignId(campaignId, { user, role })
      .then((loadedMap) => {
        if (!cancelled) setMap(loadedMap);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message || 'No se pudo cargar el mapa táctico.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, enabled, repository, role, user]);

  const movement = useTokenMovement({
    map,
    setMap,
    repository,
    user,
    role,
    setSavingTokenId,
    setSaveError,
  });

  return {
    map,
    loading,
    loadError,
    saveError,
    savingTokenId,
    moveToken: movement.moveToken,
  };
}
