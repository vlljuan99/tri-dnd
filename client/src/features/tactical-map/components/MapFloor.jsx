import { Suspense, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { disabledCellsToSet, cellKey } from '../domain/cells.js';

function Wall({ position, scale }) {
  return (
    <mesh position={position} scale={scale} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#463526" roughness={0.95} />
    </mesh>
  );
}

// Construye una única geometría con un cuadrado por casilla activa (las
// desactivadas se omiten, quedando como vacío/oscuro). Las UV de cada
// casilla apuntan a su porción correspondiente de la textura compartida,
// para que una imagen rectangular se "recorte" a la forma de la sala.
function buildCellFloorGeometry(map) {
  const cols = Math.ceil(map.width / map.gridSize);
  const rows = Math.ceil(map.height / map.gridSize);
  const disabled = disabledCellsToSet(map.disabledCells);
  const positions = [];
  const uvs = [];
  const indices = [];
  let vertex = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (disabled.has(cellKey(col, row))) continue;

      const x0 = col * map.gridSize;
      const x1 = Math.min((col + 1) * map.gridSize, map.width);
      const z0 = row * map.gridSize;
      const z1 = Math.min((row + 1) * map.gridSize, map.height);
      const u0 = x0 / map.width;
      const u1 = x1 / map.width;
      const v0 = 1 - z0 / map.height;
      const v1 = 1 - z1 / map.height;

      positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      // Orden de índices invertido para que la cara quede orientada hacia
      // +Y (la cámara cenital mira hacia abajo): si no, el culling por
      // defecto de FrontSide oculta el suelo entero.
      indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
      vertex += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function useCellFloorGeometry(map) {
  return useMemo(
    () => buildCellFloorGeometry(map),
    [map.disabledCells, map.gridSize, map.height, map.width]
  );
}

function ImageFloor({ map }) {
  const texture = useLoader(THREE.TextureLoader, map.backgroundUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const geometry = useCellFloorGeometry(map);

  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial map={texture} roughness={1} />
    </mesh>
  );
}

// Los muebles y muros de ambientación solo tienen sentido para el rectángulo
// completo de partida; en cuanto el DM personaliza la forma de la sala se
// ocultan para no dar la falsa impresión de que las casillas apagadas siguen
// formando parte de la sala.
function ProceduralFloor({ map }) {
  const geometry = useCellFloorGeometry(map);
  const isDefaultShape = map.disabledCells.length === 0;

  return (
    <group>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial color="#2b241d" roughness={1} metalness={0} />
      </mesh>

      {isDefaultShape && (
        <>
          <mesh position={[3.1, 0.025, 2.2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <planeGeometry args={[2.8, 1.6]} />
            <meshStandardMaterial color="#352d24" roughness={1} />
          </mesh>
          <mesh position={[8.5, 0.03, 5.2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <circleGeometry args={[1.1, 24]} />
            <meshStandardMaterial color="#1f2d2b" roughness={1} />
          </mesh>

          <Wall position={[map.width / 2, 0.18, -0.08]} scale={[map.width + 0.35, 0.35, 0.28]} />
          <Wall position={[map.width / 2, 0.18, map.height + 0.08]} scale={[map.width + 0.35, 0.35, 0.28]} />
          <Wall position={[-0.08, 0.18, map.height / 2]} scale={[0.28, 0.35, map.height + 0.35]} />
          <Wall position={[map.width + 0.08, 0.18, map.height / 2]} scale={[0.28, 0.35, map.height + 0.35]} />

          <Wall position={[6.5, 0.14, 1.55]} scale={[0.22, 0.28, 3.1]} />
          <Wall position={[6.5, 0.14, 6.45]} scale={[0.22, 0.28, 2.7]} />
        </>
      )}
    </group>
  );
}

export default function MapFloor({ map }) {
  if (map.backgroundUrl) {
    return (
      <Suspense fallback={null}>
        <ImageFloor map={map} />
      </Suspense>
    );
  }

  return <ProceduralFloor map={map} />;
}
