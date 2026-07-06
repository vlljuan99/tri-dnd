import { useMemo } from 'react';
import * as THREE from 'three';

export default function MapGrid({ map, visible }) {
  const geometry = useMemo(() => {
    const positions = [];
    const cols = Math.ceil(map.width / map.gridSize);
    const rows = Math.ceil(map.height / map.gridSize);

    for (let col = 0; col <= cols; col += 1) {
      const x = Math.min(col * map.gridSize, map.width);
      positions.push(x, 0.035, 0, x, 0.035, map.height);
    }
    for (let row = 0; row <= rows; row += 1) {
      const z = Math.min(row * map.gridSize, map.height);
      positions.push(0, 0.035, z, map.width, 0.035, z);
    }

    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return nextGeometry;
  }, [map.gridSize, map.height, map.width]);

  if (!visible) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#e8dfc9" transparent opacity={0.32} />
    </lineSegments>
  );
}
