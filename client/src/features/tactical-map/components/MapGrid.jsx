import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { cellKey, disabledCellsToSet } from '../domain/cells.js';

export default function MapGrid({ map, visible }) {
  const geometry = useMemo(() => {
    const positions = [];
    const cols = Math.ceil(map.width / map.gridSize);
    const rows = Math.ceil(map.height / map.gridSize);
    const disabled = disabledCellsToSet(map.disabledCells);
    const enabled = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && !disabled.has(cellKey(c, r));
    // La rejilla sigue las casillas existentes y no dibuja una hoja infinita
    // sobre el vacío entre salas. Cada arista compartida se pinta una sola vez.
    for (let row = 0; row <= rows; row += 1) {
      for (let col = 0; col <= cols; col += 1) {
        const x = Math.min(col * map.gridSize, map.width);
        const z = Math.min(row * map.gridSize, map.height);
        if (enabled(col, row) || enabled(col, row - 1)) {
          positions.push(x, 0.035, z, Math.min(x + map.gridSize, map.width), 0.035, z);
        }
        if (enabled(col, row) || enabled(col - 1, row)) {
          positions.push(x, 0.035, z, x, 0.035, Math.min(z + map.gridSize, map.height));
        }
      }
    }

    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return nextGeometry;
  }, [map.gridSize, map.height, map.width, map.disabledCells]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (!visible) return null;

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#ddd4b8" transparent opacity={0.16} depthWrite={false} />
    </lineSegments>
  );
}
