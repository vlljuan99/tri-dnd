import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api.js';
import { campaignTypeOf } from '../steps.js';

const RESOURCE_KEYS = ['gestion', 'maps', 'eventos', 'world', 'archive'];

function emptyResources() {
  return {
    gestion: null,
    maps: null,
    eventos: null,
    world: null,
    archive: null,
  };
}

async function fetchResource(campaignId, resource, narrative) {
  switch (resource) {
    case 'gestion':
      return api(`/campaigns/${campaignId}/gestion`);
    case 'maps':
      return api(`/campaigns/${campaignId}/mapas`).then((data) => data.maps);
    case 'eventos':
      return api(`/campaigns/${campaignId}/eventos`);
    case 'world':
      return narrative
        ? api(`/campaigns/${campaignId}/mundo`).then((data) => data.world)
        : null;
    case 'archive':
      return narrative ? api(`/campaigns/${campaignId}/archivo`) : null;
    default:
      throw new Error(`Recurso del taller desconocido: ${resource}`);
  }
}

function assertResource(resource) {
  if (!RESOURCE_KEYS.includes(resource)) {
    throw new Error(`Recurso del taller desconocido: ${resource}`);
  }
}

// Tres estados editoriales. "started" reconoce trabajo real que aún no
// cumple el hito del paso; no bloquea ninguna otra sección del Taller.
export function computeStatuses({ campaign, members, world, gestion, maps, archive, eventos }) {
  const objectives = campaign.objectives ?? [];
  const archiveEntries = (archive?.nodes ?? []).filter(
    (node) => node.type === 'entrada' || node.kind === 'entrada'
  );
  const worldMaps = world?.maps ?? [];
  const hasWorldImage = worldMaps.some((map) => Boolean(map.imageUrl));
  const hasWorldLocations = worldMaps.some((map) => (map.locations ?? []).length > 0);
  const casted = (gestion?.characters ?? []).some((character) => character.assigned);
  const libraryAssigned = ['objetos', 'hechizos'].some((type) =>
    (gestion?.library?.[type] ?? []).some((entry) => entry.assigned)
  );
  const hasMaps = (maps ?? []).length > 0;
  const hasActiveMap = (maps ?? []).some((map) => map.isActive);

  return {
    identidad:
      campaign.status === 'complete'
        ? 'done'
        : campaign.description?.trim()
          ? 'started'
          : 'empty',
    lore:
      campaign.lore?.trim() || objectives.length > 0 || archiveEntries.length > 0
        ? 'done'
        : 'empty',
    mundo: hasWorldLocations ? 'done' : hasWorldImage ? 'started' : 'empty',
    reparto: casted || libraryAssigned ? 'done' : 'empty',
    mapas: hasActiveMap ? 'done' : hasMaps ? 'started' : 'empty',
    eventos: (eventos?.links ?? []).length > 0 ? 'done' : 'empty',
    jugadores: (members ?? []).some((member) => member.role === 'jugador') ? 'done' : 'empty',
  };
}

// La preparación editorial y la posibilidad de sentarse a jugar son cosas
// distintas. Esta comprobación se limita a los dos requisitos operativos de
// una primera sesión: tablero activo y alguien a quien dirigirla.
export function computeReadiness({ members, maps }) {
  const playerCount = (members ?? []).filter((member) => member.role === 'jugador').length;
  const activeMap = (maps ?? []).find((map) => map.isActive) ?? null;
  const missing = [];

  if (!activeMap) missing.push({ id: 'mapas', label: 'lleva un mapa a la mesa' });
  if (playerCount < 1) missing.push({ id: 'jugadores', label: 'invita al menos a un jugador' });

  return {
    ready: missing.length === 0,
    missing,
    activeMap,
    playerCount,
  };
}

export function useTallerProgress(campaignId) {
  const [campaign, setCampaignState] = useState(null);
  const [members, setMembers] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [resources, setResources] = useState(emptyResources);
  const [statuses, setStatuses] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const campaignRef = useRef(null);
  const membersRef = useRef([]);
  const resourcesRef = useRef(emptyResources());
  const loadRequestRef = useRef(0);
  const overviewRequestRef = useRef(0);
  const resourceRequestsRef = useRef(Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])));
  const leaveGuardRef = useRef(null);

  const recompute = useCallback((nextCampaign, nextMembers, nextResources) => {
    if (!nextCampaign || nextCampaign.role !== 'dm') {
      setStatuses({});
      return;
    }
    setStatuses(
      computeStatuses({
        campaign: nextCampaign,
        members: nextMembers,
        ...nextResources,
      })
    );
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    overviewRequestRef.current += 1;
    // Invalida refrescos individuales anteriores para que nunca pisen una
    // carga completa más reciente.
    const resourceVersions = {};
    for (const key of RESOURCE_KEYS) {
      resourceRequestsRef.current[key] += 1;
      resourceVersions[key] = resourceRequestsRef.current[key];
    }
    setError('');
    try {
      const {
        campaign: loaded,
        members: loadedMembers = [],
        characters: loadedCharacters = [],
      } = await api(`/campaigns/${campaignId}`);
      if (requestId !== loadRequestRef.current) return;

      campaignRef.current = loaded;
      membersRef.current = loadedMembers;
      setCampaignState(loaded);
      setMembers(loadedMembers);
      setCharacters(loadedCharacters);

      if (loaded.role !== 'dm') {
        const cleared = emptyResources();
        resourcesRef.current = cleared;
        setResources(cleared);
        setStatuses({});
        return;
      }

      const narrative = campaignTypeOf(loaded) === 'campana';
      const values = await Promise.all(
        RESOURCE_KEYS.map((resource) =>
          fetchResource(campaignId, resource, narrative).catch(() => null)
        )
      );
      if (requestId !== loadRequestRef.current) return;

      const loadedResources = Object.fromEntries(
        RESOURCE_KEYS.map((resource, index) => [
          resource,
          // Si ese recurso se refrescó de forma individual mientras esta
          // carga estaba en vuelo, conservamos el payload más reciente.
          resourceRequestsRef.current[resource] === resourceVersions[resource]
            ? values[index]
            : resourcesRef.current[resource],
        ])
      );
      resourcesRef.current = loadedResources;
      setResources(loadedResources);
      recompute(loaded, loadedMembers, loadedResources);
    } catch (loadError) {
      if (requestId === loadRequestRef.current) setError(loadError.message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [campaignId, recompute]);

  useEffect(() => {
    setLoading(true);
    setCampaignState(null);
    campaignRef.current = null;
    load();
  }, [load]);

  const updateCampaign = useCallback(
    (valueOrUpdater) => {
      const current = campaignRef.current;
      const next =
        typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater;
      if (!next) return;
      campaignRef.current = next;
      setCampaignState(next);
      recompute(next, membersRef.current, resourcesRef.current);
    },
    [recompute]
  );

  // Refresca solo campaña, miembros y fichas. Es lo que necesita Jugadores
  // tras expulsar a alguien; volver a descargar Archivo, Mundo, Mapas,
  // Eventos y Reparto sería trabajo duplicado y podría pisar ediciones.
  const refreshOverview = useCallback(async () => {
    const requestId = ++overviewRequestRef.current;
    const {
      campaign: loaded,
      members: loadedMembers = [],
      characters: loadedCharacters = [],
    } = await api(`/campaigns/${campaignId}`);
    if (requestId !== overviewRequestRef.current) {
      return { campaign: loaded, members: loadedMembers, characters: loadedCharacters };
    }
    campaignRef.current = loaded;
    membersRef.current = loadedMembers;
    setCampaignState(loaded);
    setMembers(loadedMembers);
    setCharacters(loadedCharacters);
    recompute(loaded, loadedMembers, resourcesRef.current);
    return { campaign: loaded, members: loadedMembers, characters: loadedCharacters };
  }, [campaignId, recompute]);

  const updateResource = useCallback(
    (resource, valueOrUpdater) => {
      assertResource(resource);
      const current = resourcesRef.current;
      const currentValue = current[resource];
      const nextValue =
        typeof valueOrUpdater === 'function' ? valueOrUpdater(currentValue) : valueOrUpdater;
      const next = { ...current, [resource]: nextValue };
      resourcesRef.current = next;
      setResources(next);
      recompute(campaignRef.current, membersRef.current, next);
    },
    [recompute]
  );

  const refreshResource = useCallback(
    async (resource) => {
      assertResource(resource);
      const currentCampaign = campaignRef.current;
      if (!currentCampaign || currentCampaign.role !== 'dm') return null;
      const requestId = ++resourceRequestsRef.current[resource];
      const narrative = campaignTypeOf(currentCampaign) === 'campana';
      const value = await fetchResource(campaignId, resource, narrative);
      if (requestId !== resourceRequestsRef.current[resource]) return value;
      updateResource(resource, value);
      return value;
    },
    [campaignId, updateResource]
  );

  // Identidad registra aquí su flush. Los enlaces propios del Taller lo
  // esperan antes de cambiar de paso; otros pasos no pagan coste adicional.
  const registerLeaveGuard = useCallback((guard) => {
    leaveGuardRef.current = guard;
    return () => {
      if (leaveGuardRef.current === guard) leaveGuardRef.current = null;
    };
  }, []);

  const prepareNavigation = useCallback(async () => {
    const guard = leaveGuardRef.current;
    if (!guard) return true;
    try {
      return (await guard()) !== false;
    } catch {
      return false;
    }
  }, []);

  const readiness = computeReadiness({ members, maps: resources.maps });

  return {
    campaign,
    // Alias compatible con los pasos existentes, pero ya no expone el setter
    // crudo: siempre mantiene refs y estados derivados sincronizados.
    setCampaign: updateCampaign,
    updateCampaign,
    members,
    characters,
    statuses,
    readiness,
    resources,
    // Accesos directos para que los pasos consumidores reutilicen exactamente
    // los payloads que ya alimentan el progreso.
    gestion: resources.gestion,
    maps: resources.maps,
    eventos: resources.eventos,
    world: resources.world,
    archive: resources.archive,
    error,
    loading,
    refresh: load,
    refreshOverview,
    refreshResource,
    updateResource,
    registerLeaveGuard,
    prepareNavigation,
  };
}
