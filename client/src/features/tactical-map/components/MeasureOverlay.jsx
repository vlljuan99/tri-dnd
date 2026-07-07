import { useMemo } from 'react';
import * as THREE from 'three';
import { LabelSprite } from './TokenLabel.jsx';

// Regla de la mesa: dos puntos (centrados en casilla) unidos por una línea
// con la distancia en casillas y pies (regla simplificada de 5e: la
// diagonal cuenta como una casilla → distancia de Chebyshev).
export default function MeasureOverlay({ points, gridSize }) {
  const lineGeometry = useMemo(() => {
    if (points.length < 2) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [points[0].x, 0.09, points[0].z, points[1].x, 0.09, points[1].z],
        3
      )
    );
    return geometry;
  }, [points]);

  if (points.length === 0) return null;

  const cells =
    points.length === 2
      ? Math.max(
          Math.abs(Math.round((points[1].x - points[0].x) / gridSize)),
          Math.abs(Math.round((points[1].z - points[0].z) / gridSize))
        )
      : 0;
  const mid =
    points.length === 2
      ? { x: (points[0].x + points[1].x) / 2, z: (points[0].z + points[1].z) / 2 }
      : null;

  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={[p.x, 0.09, p.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <circleGeometry args={[gridSize * 0.14, 16]} />
          <meshBasicMaterial color="#7fb2d9" />
        </mesh>
      ))}
      {lineGeometry && (
        <line geometry={lineGeometry} raycast={() => null}>
          <lineBasicMaterial color="#7fb2d9" linewidth={2} transparent opacity={0.9} />
        </line>
      )}
      {mid && (
        <LabelSprite
          text={`${cells} casillas · ${cells * 5} pies`}
          position={[mid.x, 0.5, mid.z]}
          scale={[2.6, 0.5, 1]}
          fontSize={26}
        />
      )}
    </group>
  );
}
