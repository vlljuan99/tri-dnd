import { api } from '../../../api.js';
import { composeBoardFromMap } from '../domain/composite.js';

/**
 * Repositorio del tablero en vivo: todo el estado viene del servidor ya
 * filtrado por rol (mapa activo, marcadores preparados y tokens de
 * personaje persistidos por sala).
 */
export class TacticalMapRepository {
  async getMapByCampaignId(campaignId, { role, floorId } = {}) {
    const { map: activeMap } = await api(`/campaigns/${campaignId}/mapa-activo`);
    const board = composeBoardFromMap(activeMap, floorId);
    if (!board) {
      throw new Error(
        role === 'dm'
          ? 'La mesa no tiene mapa con salas: prepara uno en el editor de campaña y llévalo a la mesa.'
          : 'El DM aún no ha revelado ninguna zona del mapa.'
      );
    }
    const { serverTokens, characterTokens, ...boardRest } = board;
    return {
      ...boardRest,
      id: `map-${activeMap.id}`,
      campaignId,
      serverMapId: activeMap.id,
      tokens: [...characterTokens, ...serverTokens],
    };
  }

  // Persiste el movimiento en el servidor, que avisa a toda la mesa por
  // socket: los personajes por su endpoint (dueño o DM), los marcadores
  // preparados por el del editor (solo DM).
  async updateTokenPosition(map, tokenId, position) {
    const token = map.tokens.find((t) => t.id === tokenId);
    if (!token) return;
    const x = Math.floor(position.x / map.gridSize) + (map.origin?.x ?? 0);
    const y = Math.floor(position.z / map.gridSize) + (map.origin?.y ?? 0);

    if (token.characterId) {
      await api(`/campaigns/${map.campaignId}/mapa-activo/personajes/${token.characterId}/mover`, {
        method: 'POST',
        body: { x, y },
      });
    } else if (token.serverId) {
      await api(`/campaigns/${map.campaignId}/mapas/${map.serverMapId}/fichas/${token.serverId}`, {
        method: 'PATCH',
        body: { x, y },
      });
    }
  }
}

export const tacticalMapRepository = new TacticalMapRepository();
