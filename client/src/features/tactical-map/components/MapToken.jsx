import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import SelectionIndicator from './SelectionIndicator.jsx';
import TokenIcon from './TokenIcon.jsx';
import TokenLabel from './TokenLabel.jsx';

function tokenShapeSegments(type) {
  if (type === 'enemy') return 6;
  if (type === 'npc') return 4;
  return 32;
}

export default function MapToken({ token, selected, movable, saving, onSelect }) {
  const groupRef = useRef(null);
  const targetPosition = useMemo(
    () => new THREE.Vector3(token.position.x, 0.12, token.position.z),
    [token.position.x, token.position.z]
  );
  const segments = tokenShapeSegments(token.type);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.lerp(targetPosition, 0.25);
  });

  return (
    <group
      ref={groupRef}
      position={[token.position.x, 0.12, token.position.z]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(token.id);
      }}
    >
      {selected && <SelectionIndicator size={token.size} />}
      <mesh>
        <cylinderGeometry args={[token.size * 0.43, token.size * 0.43, 0.16, segments]} />
        <meshStandardMaterial color={token.color || '#6e7c55'} roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.087, 0]}>
        <cylinderGeometry args={[token.size * 0.48, token.size * 0.48, 0.035, segments]} />
        <meshBasicMaterial color={movable ? '#f1c96a' : '#3a332c'} transparent opacity={movable ? 0.9 : 0.72} />
      </mesh>
      <TokenIcon imageUrl={token.imageUrl} radius={token.size * 0.4} />
      {saving && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
          <ringGeometry args={[token.size * 0.53, token.size * 0.61, 24]} />
          <meshBasicMaterial color="#e8dfc9" transparent opacity={0.55} />
        </mesh>
      )}
      <TokenLabel token={token} />
    </group>
  );
}
