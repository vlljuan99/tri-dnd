import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { canMoveToken } from '../domain/permissions.js';
import MapDoor from './MapDoor.jsx';
import MapFloor from './MapFloor.jsx';
import MapGrid from './MapGrid.jsx';
import MapToken from './MapToken.jsx';
import TacticalCamera from './TacticalCamera.jsx';

function PointerMissedMovement({ register, selectedTokenId, onMoveToken }) {
  const { camera, gl } = useThree();

  useEffect(() => {
    register((event) => {
      if (!selectedTokenId) return;
      const rect = gl.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, point)) return;

      onMoveToken(selectedTokenId, { x: point.x, y: 0, z: point.z });
    });
    return () => register(null);
  }, [camera, gl.domElement, onMoveToken, register, selectedTokenId]);

  return null;
}

export default function TacticalMapCanvas({
  map,
  user,
  role,
  selectedTokenId,
  showGrid,
  savingTokenId,
  cameraCommand,
  onSelectToken,
  onMoveToken,
  onOpenDoor,
}) {
  const missedHandlerRef = useRef(null);

  return (
    <Canvas
      className="h-full w-full"
      dpr={[1, 1.5]}
      frameloop="always"
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={(event) => missedHandlerRef.current?.(event)}
    >
      <color attach="background" args={['#14110f']} />
      <ambientLight intensity={1.25} />
      <TacticalCamera map={map} command={cameraCommand} />
      <PointerMissedMovement
        selectedTokenId={selectedTokenId}
        onMoveToken={onMoveToken}
        register={(handler) => {
          missedHandlerRef.current = handler;
        }}
      />
      <MapFloor map={map} />
      <MapGrid map={map} visible={showGrid} />
      {(map.doors ?? []).map((door, index) => (
        <MapDoor key={`${door.id}-${index}`} door={door} gridSize={map.gridSize} onOpen={onOpenDoor} />
      ))}
      {map.tokens
        .filter((token) => token.visible)
        .map((token) => (
          <MapToken
            key={token.id}
            token={token}
            selected={token.id === selectedTokenId}
            movable={canMoveToken({ token, user, role })}
            saving={token.id === savingTokenId}
            onSelect={onSelectToken}
          />
        ))}
    </Canvas>
  );
}
