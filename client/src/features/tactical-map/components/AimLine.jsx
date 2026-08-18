import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// La línea de tiro entre quien apunta y su objetivo. El contorno naranja dice
// hasta dónde llegas; esta línea dice a QUIÉN estás apuntando ahora mismo, que
// con varios enemigos amontonados no es lo mismo.
//
// Se pinta a ras de suelo, con un pulso que recorre la línea del atacante al
// objetivo para que se lea la dirección del disparo.
const STATE_COLORS = {
  alcance: '#7bb661',
  larga: '#d8a13a',
  fuera: '#c2452d',
  'sin-vision': '#7a6f66',
};

export default function AimLine({ from, to, state = 'alcance', gridSize = 1, y = 0.03 }) {
  const pulseRef = useRef(null);
  const color = STATE_COLORS[state] ?? STATE_COLORS.fuera;

  const line = useMemo(() => {
    if (!from || !to) return null;
    const start = new THREE.Vector3((from.col + 0.5) * gridSize, y, (from.row + 0.5) * gridSize);
    const end = new THREE.Vector3((to.col + 0.5) * gridSize, y, (to.row + 0.5) * gridSize);
    const length = start.distanceTo(end);
    if (length < gridSize * 0.4) return null; // objetivo pegado: la línea no aporta
    const mid = start.clone().lerp(end, 0.5);
    // El ángulo se mide en el plano del tablero; la línea es un plano fino
    // tumbado, no un cilindro, para que no se hunda en el suelo.
    const angle = Math.atan2(end.z - start.z, end.x - start.x);
    return { start, end, mid, length, angle };
  }, [from?.col, from?.row, gridSize, to?.col, to?.row, y]);

  useFrame(({ clock }) => {
    if (!pulseRef.current || !line) return;
    const t = (clock.elapsedTime * 1.6) % 1;
    pulseRef.current.position.copy(line.start).lerp(line.end, t);
    pulseRef.current.position.y = y + 0.002;
  });

  if (!line) return null;

  return (
    <group>
      <mesh
        position={[line.mid.x, y, line.mid.z]}
        rotation={[-Math.PI / 2, 0, -line.angle]}
        raycast={() => null}
      >
        <planeGeometry args={[line.length, gridSize * 0.07]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={pulseRef} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[gridSize * 0.09, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
