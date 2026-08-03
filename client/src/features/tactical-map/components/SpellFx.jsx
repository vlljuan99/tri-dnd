import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

// Tiempos del efecto, en milisegundos. El store descarta la entrada algo más
// tarde (1700 ms), así que la animación siempre termina antes de desmontarse.
const TRAVEL_MS = 360;
const IMPACT_MS = 780;

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Destello de un conjuro ya resuelto: el servidor avisa por socket al lanzar y
 * toda la mesa ve lo mismo. Es puramente cosmético — el daño, las salvaciones
 * y los estados los resolvió el servidor antes de emitirlo.
 *
 * `fx` llega en coordenadas del tablero: { createdAt, origin: {col,row}, aim:
 * {col,row}, cells: [{col,row}], color, projectile }.
 */
export default function SpellFx({ fx, gridSize }) {
  const boltRef = useRef(null);
  const ringRef = useRef(null);
  const cellsRef = useRef(null);

  const center = (cell) => ({ x: (cell.col + 0.5) * gridSize, z: (cell.row + 0.5) * gridSize });
  const target = center(fx.aim);
  const source = fx.origin ? center(fx.origin) : target;
  const travel = fx.projectile ? TRAVEL_MS : 0;

  useFrame(() => {
    const age = Date.now() - fx.createdAt;

    // Proyectil: sale del lanzador y describe un arco corto hasta el objetivo
    if (boltRef.current) {
      const t = Math.min(1, age / TRAVEL_MS);
      boltRef.current.visible = age <= TRAVEL_MS;
      boltRef.current.position.set(
        source.x + (target.x - source.x) * t,
        0.25 + Math.sin(t * Math.PI) * gridSize * 0.45,
        source.z + (target.z - source.z) * t
      );
      const flicker = 0.85 + Math.sin(age * 0.05) * 0.15;
      boltRef.current.scale.setScalar(flicker);
    }

    // Impacto: anillo que se abre y se apaga sobre la casilla apuntada
    if (ringRef.current) {
      const t = Math.min(1, Math.max(0, (age - travel) / IMPACT_MS));
      ringRef.current.visible = age >= travel && t < 1;
      const scale = 0.2 + easeOut(t) * (fx.cells?.length ? 2.6 : 1.4);
      ringRef.current.scale.set(scale, scale, scale);
      ringRef.current.material.opacity = 0.9 * (1 - t);
    }

    // Área: cada casilla de la plantilla destella y se desvanece
    if (cellsRef.current) {
      const t = Math.min(1, Math.max(0, (age - travel) / (IMPACT_MS + 200)));
      for (const cell of cellsRef.current.children) {
        cell.material.opacity = 0.62 * (1 - t) * (0.75 + Math.sin(age * 0.02 + cell.position.x) * 0.25);
        cell.scale.setScalar(0.65 + easeOut(t) * 0.35);
      }
    }
  });

  return (
    <group>
      {fx.projectile && (
        <mesh ref={boltRef} position={[source.x, 0.25, source.z]} raycast={() => null}>
          <sphereGeometry args={[gridSize * 0.16, 12, 12]} />
          <meshBasicMaterial color={fx.color} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      )}
      <mesh
        ref={ringRef}
        position={[target.x, 0.06, target.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={() => null}
      >
        <ringGeometry args={[gridSize * 0.3, gridSize * 0.5, 32]} />
        <meshBasicMaterial color={fx.color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <group ref={cellsRef}>
        {(fx.cells ?? []).map((cell) => (
          <mesh
            key={`${cell.col}-${cell.row}`}
            position={[(cell.col + 0.5) * gridSize, 0.05, (cell.row + 0.5) * gridSize]}
            rotation={[-Math.PI / 2, 0, 0]}
            raycast={() => null}
          >
            <planeGeometry args={[gridSize * 0.92, gridSize * 0.92]} />
            <meshBasicMaterial color={fx.color} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
