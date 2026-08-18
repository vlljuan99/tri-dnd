import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { flightDuration, resolveProjectile } from '../domain/projectiles.js';

// El disparo que cruza el tablero. Hasta ahora un ataque a distancia quitaba
// vida al otro lado del mapa sin que nada volara: el resultado se narraba, pero
// no se veía salir de tu ficha.
//
// Sale de quien dispara y llega a quien recibe; si el ataque falla, pasa de
// largo y se pierde un poco más allá, que es la forma más barata de leer un
// fallo sin texto.
function Flight({ flight, gridSize, createdAt }) {
  const groupRef = useRef(null);
  const materialRef = useRef(null);
  const { look } = flight;

  const path = useMemo(() => {
    const start = new THREE.Vector3(flight.from.position.x, 0.35, flight.from.position.z);
    const target = new THREE.Vector3(flight.to.position.x, 0.35, flight.to.position.z);
    const distance = start.distanceTo(target) / gridSize;
    // Un fallo no se para en seco sobre el objetivo: lo pasa de largo.
    const end = flight.hit
      ? target
      : target.clone().add(target.clone().sub(start).normalize().multiplyScalar(gridSize * 1.6));
    return { start, end, distance, duration: flightDuration(distance, flight.kind) };
  }, [flight, gridSize]);

  useFrame(() => {
    if (!groupRef.current) return;
    const age = Date.now() - createdAt;
    const t = Math.min(1, age / path.duration);
    groupRef.current.position.copy(path.start).lerp(path.end, t);
    // Arco de tiro: sube y baja: sin él, un disparo largo se ve rastrero.
    groupRef.current.position.y = 0.35 + Math.sin(t * Math.PI) * Math.min(1.1, path.distance * 0.12);
    if (look.spin) groupRef.current.rotation.z = age * 0.02;
    if (materialRef.current) {
      // Se desvanece justo al final del vuelo, y más deprisa si ha fallado.
      materialRef.current.opacity = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
    }
  });

  const angle = Math.atan2(path.end.z - path.start.z, path.end.x - path.start.x);
  const size = gridSize;

  return (
    <group ref={groupRef} position={path.start} rotation={[0, -angle, 0]}>
      {look.shape === 'bola' ? (
        <mesh raycast={() => null}>
          <sphereGeometry args={[size * look.thickness * 0.5, 10, 8]} />
          <meshBasicMaterial ref={materialRef} color={look.color} transparent toneMapped={false} />
        </mesh>
      ) : (
        <mesh rotation={[0, 0, Math.PI / 2]} raycast={() => null}>
          <cylinderGeometry
            args={[size * look.thickness * 0.35, size * look.thickness * 0.5, size * look.length, 6]}
          />
          <meshBasicMaterial ref={materialRef} color={look.color} transparent toneMapped={false} />
        </mesh>
      )}
      {/* Estela: el mismo color estirado hacia atrás, para que a media
          velocidad se vea la dirección y no un punto suelto. */}
      <mesh position={[(-size * look.length) / 1.4, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[size * look.length * look.trail * 3, size * look.thickness * 0.6]} />
        <meshBasicMaterial
          color={look.color}
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export default function Projectiles({ visuals = [], tokens = [], gridSize = 1 }) {
  const flights = visuals
    .filter((visual) => visual.type === 'proyectil')
    .map((visual) => {
      const resolved = resolveProjectile(visual, tokens);
      return resolved ? { ...resolved, id: visual.id, kind: visual.kind, createdAt: visual.createdAt } : null;
    })
    .filter(Boolean);

  return flights.map((flight) => (
    <Flight key={flight.id} flight={flight} gridSize={gridSize} createdAt={flight.createdAt} />
  ));
}
