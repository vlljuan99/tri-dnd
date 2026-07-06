import { createTestTacticalMap } from '../data/testMap.js';
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

/**
 * Adaptador temporal hasta que exista modelo persistente de mapas en backend.
 * La página consume este repositorio como contrato reemplazable por API.
 */
export class TestTacticalMapRepository {
  async getMapByCampaignId(campaignId, { user } = {}) {
    return applySavedPositions(createTestTacticalMap({ campaignId, user }));
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
