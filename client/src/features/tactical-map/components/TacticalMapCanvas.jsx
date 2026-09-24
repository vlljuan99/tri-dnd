import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cellGroundY, tokenGroundY } from '../domain/elevation.js';
import { buildBoardElevation } from '../domain/pathfinding.js';
import { canMoveToken } from '../domain/permissions.js';
import { sceneLighting } from '../domain/weather.js';
import AimOverlay from './AimOverlay.jsx';
import MapDoor from './MapDoor.jsx';
import MapFloor from './MapFloor.jsx';
import MapGrid from './MapGrid.jsx';
import MapToken from './MapToken.jsx';
import MeasureOverlay from './MeasureOverlay.jsx';
import MovementOutline from './MovementOutline.jsx';
import MovementRange from './MovementRange.jsx';
import PingMarker from './PingMarker.jsx';
import Projectiles from './Projectiles.jsx';
import AimLine from './AimLine.jsx';
import SpellFx from './SpellFx.jsx';
import TacticalCamera from './TacticalCamera.jsx';
import WeatherLayer from './WeatherLayer.jsx';
import SceneLighting from './SceneLighting.jsx';
import RevealEffects from './RevealEffects.jsx';

const HAZARD_COLORS = {
  fuego: '#ff6a2a',
  telarana: '#d8d4c8',
  nube: '#8eb064',
  arcana: '#9a74ff',
};

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
  onViewChange,
  onSelectToken,
  onGroundClick,
  onOpenDoor,
  onPing,
  pings = [],
  measureMode = false,
  measurePoints = [],
  onMeasurePoint,
  reachableCells = [],
  // Apuntado con un arma: contorno de su alcance (normal y distancia larga) y
  // veredicto por objetivo (llega / distancia larga / fuera).
  aimRangeCells = null,
  aimTargetStates = null,
  // Línea recta hasta el objetivo apuntado: { from, to, state } en casillas
  aimLine = null,
  terrainCells = [],
  pathCells = [],
  visionCells = [],
  // Miras de conjuro (la propia y las de la mesa) y destellos de los ya
  // lanzados, todo en coordenadas del tablero
  aims = [],
  spellFx = [],
  activeTokenId = null,
  combatVisuals = [],
  combatants = [],
}) {
  const missedHandlerRef = useRef(null);
  // Relieve del tablero: todo lo que se apoya en el suelo (fichas, contorno de
  // alcance, camino, terreno) sube con la cornisa en la que cae. Es el mismo
  // mapa de niveles que usa el pathfinding para cobrar la subida.
  const elevation = useMemo(() => buildBoardElevation(map), [map]);

  // Las antorchas suman luz cálida sobre una base siempre legible.
  const hasLights =
    (map.rooms ?? []).some((room) => room.lightCells?.length) ||
    ((map.wallLightEvery ?? 0) > 0 && (map.rooms ?? []).some((room) => room.wallEdges?.length));
  const lighting = sceneLighting(map, hasLights);

  return (
    <Canvas
      className="h-full w-full"
      dpr={[1, 1.5]}
      frameloop="always"
      shadows="percentage"
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      onPointerMissed={(event) => missedHandlerRef.current?.(event)}
    >
      <color attach="background" args={[lighting.background]} />
      <SceneLighting map={map} lighting={lighting} />
      <WeatherLayer map={map} />
      <TacticalCamera map={map} command={cameraCommand} onViewChange={onViewChange} />
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
      {/* Fase 3 (añadido): barrido al revelar una sala y brillo de trampa descubierta */}
      <RevealEffects map={map} />
      {/* Terreno difícil, visión, camino y peligros conservan su relleno. Solo
          el alcance usa contorno para no teñir la ilustración del suelo. */}
      <MovementRange cells={terrainCells} gridSize={map.gridSize} color="#9c6f2e" opacity={0.3} y={0.012} elevation={elevation} />
      <MovementRange cells={visionCells} gridSize={map.gridSize} color="#6cb7d9" opacity={0.24} y={0.018} elevation={elevation} />
      <MovementOutline cells={reachableCells} gridSize={map.gridSize} elevation={elevation} />
      {/* Naranja para el alcance del arma, frente al verde del movimiento: son
          dos preguntas distintas ("hasta dónde ando" / "hasta dónde disparo") y
          a menudo se ven a la vez. La distancia larga va detrás, apagada y sin
          latido, porque dispara con desventaja. */}
      <MovementOutline
        cells={aimRangeCells?.long ?? []}
        gridSize={map.gridSize}
        color="#a8532c"
        opacity={0.42}
        y={0.019}
        elevation={elevation}
        pulse={false}
      />
      <MovementOutline
        cells={aimRangeCells?.normal ?? []}
        gridSize={map.gridSize}
        color="#ff8a3d"
        opacity={0.8}
        y={0.022}
        elevation={elevation}
      />
      <MovementRange cells={pathCells} gridSize={map.gridSize} color="#e8c368" opacity={0.4} y={0.024} elevation={elevation} />
      {(map.hazardZones ?? []).map((zone, index) => (
        <MovementRange
          key={zone.id}
          cells={zone.cells}
          gridSize={map.gridSize}
          color={HAZARD_COLORS[zone.visualType] ?? HAZARD_COLORS.arcana}
          opacity={0.28}
          y={0.027 + index * 0.0001}
          elevation={elevation}
          animated
        />
      ))}
      {aims.map((aim) => (
        <AimOverlay key={aim.id} aim={aim} gridSize={map.gridSize} />
      ))}
      {spellFx.map((fx) => (
        <SpellFx key={fx.id} fx={fx} gridSize={map.gridSize} />
      ))}
      {(map.doors ?? []).map((door, index) => (
        <MapDoor key={`${door.id}-${index}`} door={door} gridSize={map.gridSize} onOpen={onOpenDoor} />
      ))}
      {aimLine && (
        <AimLine from={aimLine.from} to={aimLine.to} state={aimLine.state} gridSize={map.gridSize} />
      )}
      {/* Los disparos vuelan por encima de las fichas, entre las dos puntas que
          manda el servidor: los ve toda la mesa, no solo quien tira. */}
      <Projectiles visuals={combatVisuals} tokens={map.tokens} gridSize={map.gridSize} />
      <DoubleClickPing onPing={onPing} />
      {measureMode && <MeasureOverlay points={measurePoints} gridSize={map.gridSize} />}
      {pings
        .filter((ping) => ping.floorId === map.floorId)
        .map((ping) => (
          <PingMarker key={ping.id} ping={ping} gridSize={map.gridSize} origin={map.origin} />
        ))}
      {map.tokens
        .filter((token) => token.visible)
        .map((token) => {
          // El mismo emparejamiento alimenta los efectos de combate y el
          // estado de muerte; así un PJ y un marcador nunca divergen.
          const matchesToken = (entry) => token.characterId
            ? entry.characterId === token.characterId
            : entry.mapTokenId === token.serverId;
          // Sus propios golpes (Fase 3, añadido): embiste hacia el objetivo
          const ownStrikes = combatVisuals
            .filter((entry) => (entry.type === 'hit' || entry.type === 'miss') && entry.from && matchesToken(entry.from))
            .map((entry) => {
              const target = map.tokens.find((candidate) =>
                entry.characterId ? candidate.characterId === entry.characterId : candidate.serverId === entry.mapTokenId
              );
              return target ? { id: entry.id, to: target.position } : null;
            })
            .filter(Boolean);
          return (
            <MapToken
              key={token.id}
              token={token}
              groundY={tokenGroundY(elevation, token.position, map.gridSize)}
              rangeState={aimTargetStates?.get(token.id) ?? null}
              selected={token.id === selectedTokenId}
              active={token.id === activeTokenId}
              dead={Boolean(combatants.find(matchesToken)?.dead)}
              visuals={combatVisuals.filter(matchesToken)}
              strikes={ownStrikes}
              movable={canMoveToken({ token, user, role })}
              saving={token.id === savingTokenId}
              onSelect={onSelectToken}
            />
          );
        })}
    </Canvas>
  );
}
