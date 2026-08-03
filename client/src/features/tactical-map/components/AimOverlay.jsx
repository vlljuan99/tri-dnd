import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import MovementRange from './MovementRange.jsx';
import { LabelSprite } from './TokenLabel.jsx';
import { INVALID_COLOR } from '../domain/elements.js';

// Trazo del apuntado: un plano fino tumbado que va del lanzador a la casilla
// apuntada. Se orienta girando sobre el eje Y; con la rotación [-90°, 0, θ] el
// eje X local del plano apunta a (cos θ, −sen θ) en el suelo (x, z).
function AimLine({ from, to, gridSize, color }) {
  const materialRef = useRef(null);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.opacity = 0.5 + Math.sin(clock.elapsedTime * 4.2) * 0.14;
  });

  if (length < gridSize * 0.2) return null;
  return (
    <mesh
      position={[(from.x + to.x) / 2, 0.035, (from.z + to.z) / 2]}
      rotation={[-Math.PI / 2, 0, Math.atan2(-dz, dx)]}
      raycast={() => null}
    >
      <planeGeometry args={[length, gridSize * 0.1]} />
      <meshBasicMaterial ref={materialRef} color={color} transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

// Retícula sobre la casilla apuntada: anillo que late y cruz central, para que
// se vea a qué se apunta aunque no haya plantilla de área.
function AimReticle({ at, gridSize, color }) {
  const ringRef = useRef(null);

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.6) * 0.09;
    ringRef.current.scale.set(pulse, pulse, pulse);
  });

  return (
    <group position={[at.x, 0.04, at.z]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[gridSize * 0.34, gridSize * 0.44, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[gridSize * 0.07, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Mira de conjuro visible en el tablero: plantilla, trazo desde el lanzador y
 * retícula sobre el objetivo. La misma pieza dibuja tu propio apuntado y el de
 * los demás (el servidor reparte el de cada lanzador por la sala), así que la
 * mesa ve a dónde apunta cada quien antes de que se resuelva nada.
 *
 * `aim` llega ya en coordenadas del tablero: { origin: {col,row}, aim:
 * {col,row}, cells: [{col,row}], valid, color, label }.
 */
export default function AimOverlay({ aim, gridSize }) {
  if (!aim?.aim) return null;
  const color = aim.valid ? aim.color : INVALID_COLOR;
  const center = (cell) => ({ x: (cell.col + 0.5) * gridSize, z: (cell.row + 0.5) * gridSize });
  const target = center(aim.aim);
  const source = aim.origin ? center(aim.origin) : null;

  return (
    <group>
      <MovementRange
        cells={aim.cells ?? []}
        gridSize={gridSize}
        color={color}
        opacity={aim.valid ? 0.42 : 0.3}
        y={0.03}
        animated
      />
      {source && <AimLine from={source} to={target} gridSize={gridSize} color={color} />}
      <AimReticle at={target} gridSize={gridSize} color={color} />
      {aim.label && (
        <LabelSprite
          text={aim.label}
          position={[target.x, 0.7, target.z]}
          scale={[2.4, 0.44, 1]}
          fontSize={24}
          color={color}
        />
      )}
    </group>
  );
}
