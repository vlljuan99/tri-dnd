import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

// Pulso efímero lanzado con doble clic: anillo dorado que se expande en
// bucle hasta que el store descarta el ping (unos segundos).
export default function PingMarker({ ping, gridSize, origin }) {
  const ringRef = useRef(null);
  const x = (ping.x - (origin?.x ?? 0) + 0.5) * gridSize;
  const z = (ping.y - (origin?.y ?? 0) + 0.5) * gridSize;

  useFrame(() => {
    if (!ringRef.current) return;
    const t = ((Date.now() - ping.createdAt) % 1100) / 1100;
    const scale = 0.35 + t * 1.4;
    ringRef.current.scale.set(scale, scale, scale);
    ringRef.current.material.opacity = 0.95 * (1 - t);
  });

  return (
    <group position={[x, 0.1, z]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[gridSize * 0.32, gridSize * 0.42, 32]} />
        <meshBasicMaterial color="#e8c368" transparent opacity={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[gridSize * 0.1, 16]} />
        <meshBasicMaterial color="#e8c368" />
      </mesh>
    </group>
  );
}
