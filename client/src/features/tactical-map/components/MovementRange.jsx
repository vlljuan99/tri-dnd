import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { cellGroundY } from '../domain/elevation.js';

function OverlayCell({ col, row, gridSize, color, opacity, y, animated, index }) {
  const meshRef = useRef(null);
  const materialRef = useRef(null);
  const startRef = useRef(null);
  useFrame(({ clock }) => {
    if (!animated || !meshRef.current || !materialRef.current) return;
    if (startRef.current == null) startRef.current = clock.elapsedTime;
    const age = Math.max(0, (clock.elapsedTime - startRef.current) * 2.7 - index * 0.045);
    const reveal = Math.min(1, age);
    const pulse = 0.92 + Math.sin(clock.elapsedTime * 3.4 + index * 0.31) * 0.06;
    meshRef.current.scale.setScalar(reveal * pulse);
    materialRef.current.opacity = opacity * reveal * (0.82 + Math.sin(clock.elapsedTime * 2.5 + index) * 0.12);
  });
  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(col + 0.5) * gridSize, y, (row + 0.5) * gridSize]}
      scale={animated ? 0.01 : 1}
      raycast={() => null}
    >
      <planeGeometry args={[gridSize * 0.92, gridSize * 0.92]} />
      <meshBasicMaterial ref={materialRef} color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

// Overlay de casillas sobre el suelo, sin capturar clics. Se usa para el
// área de movimiento del combatiente activo (verde musgo), el camino de la
// vista previa de movimiento (dorado) y el terreno difícil (ocre).
export default function MovementRange({
  cells,
  gridSize,
  color = '#5e8c4a',
  opacity = 0.28,
  y = 0.018,
  animated = false,
  // Relieve del tablero: sobre una cornisa el overlay se pinta a la altura de
  // la plataforma; a ras de suelo quedaría tapado por ella.
  elevation = null,
}) {
  if (!cells?.length) return null;
  return (
    <group>
      {cells.map(({ col, row }, index) => (
        <OverlayCell
          key={`${col}-${row}`}
          col={col}
          row={row}
          index={index}
          gridSize={gridSize}
          color={color}
          opacity={opacity}
          y={y + cellGroundY(elevation, col, row)}
          animated={animated}
        />
      ))}
    </group>
  );
}
