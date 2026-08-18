import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cellGroundY } from '../domain/elevation.js';
import { outlineEdges } from '../domain/grid.js';

// Contorno de un área del tablero: mantiene limpia la ilustración del suelo y
// se lee igual cuando queda una sola casilla o cuando el área es medio mapa.
//
// Todas las aristas se funden en UNA geometría con un solo material: el alcance
// de un arco puede tener cientos de aristas (su sombra rodea cada columna) y
// una malla animada por arista costaba una llamada de dibujo y un callback de
// frame por cada una.
function buildOutlineGeometry(edges, gridSize, elevation) {
  const thickness = gridSize * 0.06;
  const positions = new Float32Array(edges.length * 12);
  const indices = new Uint32Array(edges.length * 6);

  edges.forEach((edge, index) => {
    const horizontal = edge.side === 'n' || edge.side === 's';
    const x = (edge.col + (edge.side === 'e' ? 1 : edge.side === 'o' ? 0 : 0.5)) * gridSize;
    const z = (edge.row + (edge.side === 's' ? 1 : edge.side === 'n' ? 0 : 0.5)) * gridSize;
    // Cada arista se apoya en la altura de SU casilla: sobre una cornisa el
    // contorno sube con ella en vez de hundirse en la plataforma.
    const y = cellGroundY(elevation, edge.col, edge.row);
    const halfX = (horizontal ? gridSize + thickness : thickness) / 2;
    const halfZ = (horizontal ? thickness : gridSize + thickness) / 2;

    const base = index * 12;
    const corners = [
      [x - halfX, z - halfZ],
      [x + halfX, z - halfZ],
      [x + halfX, z + halfZ],
      [x - halfX, z + halfZ],
    ];
    corners.forEach(([cx, cz], corner) => {
      positions[base + corner * 3] = cx;
      positions[base + corner * 3 + 1] = y;
      positions[base + corner * 3 + 2] = cz;
    });

    const vertex = index * 4;
    const slot = index * 6;
    indices[slot] = vertex;
    indices[slot + 1] = vertex + 2;
    indices[slot + 2] = vertex + 1;
    indices[slot + 3] = vertex;
    indices[slot + 4] = vertex + 3;
    indices[slot + 5] = vertex + 2;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

export default function MovementOutline({
  cells,
  gridSize,
  color = '#b8d66f',
  opacity = 0.82,
  y = 0.021,
  // Relieve del tablero: el borde sube con la cornisa que rodea.
  elevation = null,
  // El latido llama la atención sobre lo que acabas de pedir; un contorno de
  // referencia (el alcance largo, por ejemplo) se queda quieto detrás.
  pulse = true,
}) {
  const materialRef = useRef(null);
  const edges = useMemo(() => outlineEdges(cells), [cells]);
  const geometry = useMemo(
    () => (edges.length ? buildOutlineGeometry(edges, gridSize, elevation) : null),
    [edges, elevation, gridSize]
  );

  useFrame(({ clock }) => {
    if (!materialRef.current || !pulse) return;
    materialRef.current.opacity = opacity * (0.78 + Math.sin(clock.elapsedTime * 2.6) * 0.16);
  });

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, y, 0]} raycast={() => null}>
      {/* MeshBasic se ilumina por sí mismo y el fundido aditivo crea el halo
          sin depender de lineWidth, que WebGL ignora en la mayoría de equipos. */}
      <meshBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}
