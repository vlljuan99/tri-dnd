import { useEffect, useMemo, useState } from 'react';
import { tacticalMapRepository } from '../repositories/TestTacticalMapRepository.js';
import { useTokenMovement } from './useTokenMovement.js';

export function useTacticalMap(campaignId, { user, role, characters = [], enabled = true } = {}) {
  const repository = useMemo(() => tacticalMapRepository, []);
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingTokenId, setSavingTokenId] = useState(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');

  useEffect(() => {
    if (!enabled || !campaignId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setSaveError('');

    repository
      .getMapByCampaignId(campaignId, { user, role, characters })
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
  }, [campaignId, characters, enabled, repository, role, user]);

  const movement = useTokenMovement({
    map,
    setMap,
    repository,
    user,
    role,
    setSavingTokenId,
    setSaveError,
  });

  function applyMapMeta(meta) {
    if (!meta) return;
    setMap((prev) => (prev ? { ...prev, ...meta } : prev));
  }

  async function runBackgroundAction(action) {
    setBackgroundBusy(true);
    setBackgroundError('');
    try {
      const meta = await action();
      applyMapMeta(meta);
    } catch (error) {
      setBackgroundError(error.message || 'No se pudo actualizar el mapa.');
    } finally {
      setBackgroundBusy(false);
    }
  }

  const uploadBackground = (file) => runBackgroundAction(() => repository.uploadBackgroundImage(campaignId, file));
  const generateBackground = (options) =>
    runBackgroundAction(() => repository.generateBackgroundImage(campaignId, options));
  const removeBackground = () => runBackgroundAction(() => repository.removeBackgroundImage(campaignId));

  return {
    map,
    loading,
    loadError,
    saveError,
    savingTokenId,
    moveToken: movement.moveToken,
    backgroundBusy,
    backgroundError,
    uploadBackground,
    generateBackground,
    removeBackground,
  };
}
