import { canMoveToken } from '../domain/permissions.js';
import { snapToMapGrid } from '../domain/grid.js';
import { updateTokenPosition } from '../domain/tokens.js';

export function useTokenMovement({ map, setMap, repository, user, role, setSavingTokenId, setSaveError }) {
  async function moveToken(tokenId, position) {
    if (!map) return false;
    const token = map.tokens.find((candidate) => candidate.id === tokenId);
    if (!canMoveToken({ token, user, role })) {
      setSaveError('No tienes permiso para mover ese token.');
      return false;
    }

    const snappedPosition = snapToMapGrid(position, map);
    const previousMap = map;
    setSavingTokenId(tokenId);
    setSaveError('');
    setMap(updateTokenPosition(map, tokenId, snappedPosition));

    try {
      await repository.updateTokenPosition(map.id, tokenId, snappedPosition);
      return true;
    } catch (error) {
      setMap(previousMap);
      setSaveError(error.message || 'No se pudo guardar la posición del token.');
      return false;
    } finally {
      setSavingTokenId(null);
    }
  }

  return { moveToken };
}
