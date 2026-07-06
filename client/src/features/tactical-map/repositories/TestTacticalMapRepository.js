import { api } from '../../../api.js';
import { createTestTacticalMap } from '../data/testMap.js';
import { updateTokenPosition } from '../domain/tokens.js';

const STORAGE_PREFIX = 'tri-dnd:tactical-map:v1:';
const MAX_UNITS = 16;

function fitDimensions(pixelWidth, pixelHeight) {
  const aspect = pixelWidth / pixelHeight;
  const width = aspect >= 1 ? MAX_UNITS : MAX_UNITS * aspect;
  const height = aspect >= 1 ? MAX_UNITS / aspect : MAX_UNITS;
  return { width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
}

function readImagePixelSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

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
    const base = createTestTacticalMap({ campaignId, user });
    const remote = await api(`/campaigns/${campaignId}/mapa`).catch(() => null);
    const merged = remote?.map
      ? {
          ...base,
          name: remote.map.name || base.name,
          width: remote.map.width || base.width,
          height: remote.map.height || base.height,
          gridSize: remote.map.gridSize || base.gridSize,
          backgroundUrl: remote.map.backgroundUrl || undefined,
        }
      : base;
    return applySavedPositions(merged);
  }

  async uploadBackgroundImage(campaignId, file) {
    const pixelSize = await readImagePixelSize(file);
    const { width, height } = fitDimensions(pixelSize.width, pixelSize.height);
    const params = new URLSearchParams({ width: String(width), height: String(height) });
    const res = await fetch(`/api/campaigns/${campaignId}/mapa/imagen?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
    return data.map;
  }

  async generateBackgroundImage(campaignId, { prompt, provider }) {
    const data = await api(`/campaigns/${campaignId}/mapa/generar`, { method: 'POST', body: { prompt, provider } });
    return data.map;
  }

  async removeBackgroundImage(campaignId) {
    const res = await fetch(`/api/campaigns/${campaignId}/mapa/imagen`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo quitar la imagen');
    return data.map;
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
