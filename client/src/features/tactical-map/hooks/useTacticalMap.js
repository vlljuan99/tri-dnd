import { useEffect, useMemo, useRef, useState } from 'react';
import { tacticalMapRepository } from '../repositories/TestTacticalMapRepository.js';
import { allCells, toggleDisabledCell } from '../domain/cells.js';
import { useTokenMovement } from './useTokenMovement.js';

const SHAPE_SAVE_DEBOUNCE_MS = 500;

export function useTacticalMap(campaignId, { user, role, characters = [], enabled = true } = {}) {
  const repository = useMemo(() => tacticalMapRepository, []);
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingTokenId, setSavingTokenId] = useState(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
  const [shapeError, setShapeError] = useState('');
  const pendingCellsRef = useRef(null);
  const shapeSaveTimerRef = useRef(null);
  const mapRef = useRef(map);
  mapRef.current = map;

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

  useEffect(() => () => clearTimeout(shapeSaveTimerRef.current), []);

  function scheduleShapeSave(disabledCells) {
    pendingCellsRef.current = disabledCells;
    clearTimeout(shapeSaveTimerRef.current);
    shapeSaveTimerRef.current = setTimeout(async () => {
      const cells = pendingCellsRef.current;
      pendingCellsRef.current = null;
      try {
        await repository.updateDisabledCells(campaignId, cells);
        setShapeError('');
      } catch (error) {
        setShapeError(error.message || 'No se pudo guardar la forma de la sala.');
      }
    }, SHAPE_SAVE_DEBOUNCE_MS);
  }

  function setDisabledCells(disabledCells) {
    setMap((prev) => (prev ? { ...prev, disabledCells } : prev));
    scheduleShapeSave(disabledCells);
  }

  function toggleShapeCell(col, row) {
    // Se lee y actualiza mapRef (no el `map` cerrado en este render) para que
    // varios clics seguidos antes del siguiente render no se pisen entre sí.
    if (!mapRef.current) return;
    const disabledCells = toggleDisabledCell(mapRef.current.disabledCells, col, row);
    mapRef.current = { ...mapRef.current, disabledCells };
    setMap(mapRef.current);
    scheduleShapeSave(disabledCells);
  }

  function fillAllCells() {
    setDisabledCells([]);
  }

  function clearAllCells() {
    if (!map) return;
    setDisabledCells(allCells(map));
  }

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
    shapeError,
    toggleShapeCell,
    fillAllCells,
    clearAllCells,
  };
}
