import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { canMoveToken } from '../domain/permissions.js';
import MapDoor from './MapDoor.jsx';
import MapFloor from './MapFloor.jsx';
import MapGrid from './MapGrid.jsx';
import MapToken from './MapToken.jsx';
import MeasureOverlay from './MeasureOverlay.jsx';
import MovementRange from './MovementRange.jsx';
import PingMarker from './PingMarker.jsx';
import TacticalCamera from './TacticalCamera.jsx';

// Doble clic en el suelo = ping para toda la mesa
function DoubleClickPing({ onPing }) {
  const { camera, gl } = useThree();

  useEffect(() => {
    if (!onPing) return undefined;
    function handleDoubleClick(event) {
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
      onPing({ x: point.x, z: point.z });
    }
    gl.domElement.addEventListener('dblclick', handleDoubleClick);
    return () => gl.domElement.removeEventListener('dblclick', handleDoubleClick);
  }, [camera, gl.domElement, onPing]);

  return null;
}

function PointerMissedMovement({ register, measureMode, onGroundClick, onMeasurePoint }) {
  const { camera, gl } = useThree();

  useEffect(() => {
    register((event) => {
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

      if (measureMode) {
        onMeasurePoint({ x: point.x, z: point.z });
      } else {
        // La decisión (vista previa de movimiento, deselección…) vive arriba
        onGroundClick({ x: point.x, y: 0, z: point.z });
      }
    });
    return () => register(null);
  }, [camera, gl.domElement, measureMode, onMeasurePoint, onGroundClick, register]);

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
  onGroundClick,
  onOpenDoor,
  onPing,
  pings = [],
  measureMode = false,
  measurePoints = [],
  onMeasurePoint,
  reachableCells = [],
  terrainCells = [],
  pathCells = [],
}) {
  const missedHandlerRef = useRef(null);

  // Con antorchas o braseros en el mapa, el ambiente baja para que las pozas
  // de luz cálida se noten; sin luces, iluminación plana como siempre
  const hasLights =
    (map.rooms ?? []).some((room) => room.lightCells?.length) ||
    ((map.wallLightEvery ?? 0) > 0 && (map.rooms ?? []).some((room) => room.wallEdges?.length));

  return (
    <Canvas
      className="h-full w-full"
      dpr={[1, 1.5]}
      frameloop="always"
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={(event) => missedHandlerRef.current?.(event)}
    >
      <color attach="background" args={['#14110f']} />
      {/* Ambiente + una direccional en ángulo: las caras superiores de las
          plataformas (elevación) y muros reciben más luz que las laterales,
          dando relieve incluso en vista cenital */}
      <ambientLight intensity={hasLights ? 0.6 : 0.95} />
      <directionalLight position={[-6, 12, -4]} intensity={hasLights ? 0.45 : 0.7} />
      <TacticalCamera map={map} command={cameraCommand} />
      <PointerMissedMovement
        measureMode={measureMode}
        onGroundClick={onGroundClick}
        onMeasurePoint={onMeasurePoint}
        register={(handler) => {
          missedHandlerRef.current = handler;
        }}
      />
      <MapFloor map={map} />
      <MapGrid map={map} visible={showGrid} />
      {/* Terreno difícil (ocre, permanente), área de alcance (verde) y
          camino de la vista previa de movimiento (dorado, por encima) */}
      <MovementRange cells={terrainCells} gridSize={map.gridSize} color="#9c6f2e" opacity={0.3} y={0.012} />
      <MovementRange cells={reachableCells} gridSize={map.gridSize} />
      <MovementRange cells={pathCells} gridSize={map.gridSize} color="#e8c368" opacity={0.4} y={0.024} />
      {(map.doors ?? []).map((door, index) => (
        <MapDoor key={`${door.id}-${index}`} door={door} gridSize={map.gridSize} onOpen={onOpenDoor} />
      ))}
      <DoubleClickPing onPing={onPing} />
      {measureMode && <MeasureOverlay points={measurePoints} gridSize={map.gridSize} />}
      {pings
        .filter((ping) => ping.floorId === map.floorId)
        .map((ping) => (
          <PingMarker key={ping.id} ping={ping} gridSize={map.gridSize} origin={map.origin} />
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
