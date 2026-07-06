import { api } from '../../../api.js';
import { createTestTacticalMap } from '../data/testMap.js';
import { composeBoardFromMap } from '../domain/composite.js';
import { updateTokenPosition } from '../domain/tokens.js';

const STORAGE_PREFIX = 'tri-dnd:tactical-map:v1:';

function storageKey(mapId) {
  return `${STORAGE_PREFIX}${mapId}`;
}

function readSavedPositions(mapId) {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(mapId)) || '{}');
  } catch {
    return {};
  }
}

function writeSavedPositions(mapId, positions) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(mapId), JSON.stringify(positions));
}

function applySavedPositions(map) {
  const saved = readSavedPositions(map.id);
  return {
    ...map,
    tokens: map.tokens.map((token) => ({
      ...token,
      position: saved[token.id] ? { ...saved[token.id], y: 0 } : token.position,
    })),
  };
}

// Los tokens de jugador aún son datos de prueba (ver comentario de la clase),
// pero cuando representan a un personaje real, su icono sale de la ficha.
function applyCharacterAvatars(map, characters) {
  const avatarByUserId = new Map(
    characters.filter((c) => c.avatarUrl).map((c) => [c.user_id, c.avatarUrl])
  );
  if (avatarByUserId.size === 0) return map;
  return {
    ...map,
    tokens: map.tokens.map((token) =>
      token.ownerUserId && avatarByUserId.has(token.ownerUserId)
        ? { ...token, imageUrl: avatarByUserId.get(token.ownerUserId) }
        : token
    ),
  };
}

/**
 * Repositorio del tablero en vivo. El mapa viene del servidor ya filtrado
 * por rol (mapa activo de la campaña, Fase 7.5); los tokens siguen siendo
 * datos de prueba locales hasta que se persistan por sala en el backend.
 */
export class TestTacticalMapRepository {
  async getMapByCampaignId(campaignId, { user, role, characters = [] } = {}) {
    const base = createTestTacticalMap({ campaignId, user });
    const { map: activeMap } = await api(`/campaigns/${campaignId}/mapa-activo`);
    const board = composeBoardFromMap(activeMap);
    if (!board) {
      throw new Error(
        role === 'dm'
          ? 'La mesa no tiene mapa con salas: prepara uno en el editor de campaña y llévalo a la mesa.'
          : 'El DM aún no ha revelado ninguna zona del mapa.'
      );
    }
    const merged = { ...base, ...board, id: `map-${activeMap.id}` };
    return applyCharacterAvatars(applySavedPositions(merged), characters);
  }

  async updateTokenPosition(mapId, tokenId, position) {
    const saved = readSavedPositions(mapId);
    writeSavedPositions(mapId, {
      ...saved,
      [tokenId]: { x: position.x, y: 0, z: position.z },
    });
  }

  async updateLocalMap(map, tokenId, position) {
    await this.updateTokenPosition(map.id, tokenId, position);
    return updateTokenPosition(map, tokenId, position);
  }
}

export const tacticalMapRepository = new TestTacticalMapRepository();
