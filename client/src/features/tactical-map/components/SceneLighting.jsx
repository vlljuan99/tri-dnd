import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Una sola luz proyecta sombras. El resto aporta ambiente: el coste no crece
// con cada antorcha y el suelo nocturno conserva la legibilidad del mapa.
export default function SceneLighting({ map, lighting }) {
  const width = Math.max(map.width, 1);
  const height = Math.max(map.height, 1);
  const span = Math.max(width, height, 12);
  const radius = Math.hypot(width, height) / 2 + 4;
  const target = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(width / 2, 0, height / 2);
    return object;
  }, [width, height]);
  const viewport = useThree((state) => state.size);
  const shadowSize = viewport.width < 768 ? 1024 : 2048;
  const night = map.timeOfDay === 'noche';
  const twilight = ['amanecer', 'atardecer'].includes(map.timeOfDay);
  return (
    <>
      <ambientLight intensity={lighting.ambient} color={night ? '#c8d5ec' : '#e0e6e6'} />
      <hemisphereLight args={['#c7d9e5', '#514638', 0.65]} />
      <primitive object={target} />
      <directionalLight
        key={shadowSize}
        position={[width / 2 - span * 0.4, span * 0.9, height / 2 - span * 0.3]}
        target={target}
        intensity={lighting.directional * 1.65}
        color={night ? '#bbd0f0' : twilight ? '#ffdab0' : '#fff1d8'}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 3 + 20}
        shadow-bias={-0.00025}
        shadow-normalBias={0.025}
        onUpdate={(light) => light.shadow.camera.updateProjectionMatrix()}
      />
    </>
  );
}
