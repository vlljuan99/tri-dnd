import { Suspense, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

function Wall({ position, scale }) {
  return (
    <mesh position={position} scale={scale} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#463526" roughness={0.95} />
    </mesh>
  );
}

function ImageFloor({ map }) {
  const texture = useLoader(THREE.TextureLoader, map.backgroundUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return (
    <mesh position={[map.width / 2, 0, map.height / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[map.width, map.height]} />
      <meshStandardMaterial map={texture} roughness={1} />
    </mesh>
  );
}

function ProceduralFloor({ map }) {
  const floorMaterial = useMemo(
    () => ({
      color: '#2b241d',
      roughness: 1,
      metalness: 0,
    }),
    []
  );

  return (
    <group>
      <mesh
        position={[map.width / 2, 0, map.height / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={() => null}
      >
        <planeGeometry args={[map.width, map.height]} />
        <meshStandardMaterial {...floorMaterial} />
      </mesh>

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
