import { useMemo } from 'react';
import * as THREE from 'three';
import { disabledCellsToSet, cellKey } from '../domain/cells.js';

// Solo visible en modo edición de forma: pinta un cuadro sobre cada casilla
// desactivada para que se distinga del resto mientras el DM la ajusta.
function buildDisabledGeometry(map) {
  const cols = Math.ceil(map.width / map.gridSize);
  const rows = Math.ceil(map.height / map.gridSize);
  const disabled = disabledCellsToSet(map.disabledCells);
  const positions = [];
  const indices = [];
  let vertex = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!disabled.has(cellKey(col, row))) continue;

      const x0 = col * map.gridSize;
      const x1 = Math.min((col + 1) * map.gridSize, map.width);
      const z0 = row * map.gridSize;
      const z1 = Math.min((row + 1) * map.gridSize, map.height);

      positions.push(x0, 0.04, z0, x1, 0.04, z0, x1, 0.04, z1, x0, 0.04, z1);
      indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
      vertex += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export default function ShapeOverlay({ map, visible }) {
  const geometry = useMemo(
    () => buildDisabledGeometry(map),
    [map.disabledCells, map.gridSize, map.height, map.width]
  );

  if (!visible) return null;

  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshBasicMaterial color="#8c2f2f" transparent opacity={0.45} side={THREE.DoubleSide} />
    </mesh>
  );
}
