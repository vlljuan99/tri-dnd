import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Puertas y trampas que revelan (Fase 3, añadido del 23-sep-2026).
//
// - Al abrirse una sala nueva, la niebla no se apaga de golpe: un velo oscuro
//   se retira en barrido desde la puerta abierta más cercana.
// - Una trampa que acaba de aparecer (la has descubierto con Percepción) se
//   ilumina con un aro que late unos segundos. Solo la ve quien la recibe del
//   servidor, que es quien la ha encontrado.
//
// Solo lee el mapa que ya ha llegado: no revela nada que el servidor no haya
// enviado, y todo lo que pinta encima desaparece solo.

const BARRIDO_MS = 1300;
const BRILLO_TRAMPA_MS = 2600;

function prefiereMenosMovimiento() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

const VEIL_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Distancia de cada punto a la puerta, en casillas; lo que el frente ya ha
// alcanzado se vuelve transparente con un borde suave.
const VEIL_FRAGMENT = `
  varying vec2 vUv;
  uniform vec2 uSize;
  uniform vec2 uOrigin;
  uniform float uRadius;
  void main() {
    vec2 point = vec2(vUv.x * uSize.x, (1.0 - vUv.y) * uSize.y);
    float d = distance(point, uOrigin);
    float cleared = 1.0 - smoothstep(uRadius - 1.6, uRadius, d);
    gl_FragColor = vec4(0.02, 0.025, 0.03, (1.0 - cleared) * 0.96);
  }
`;

function RoomVeil({ sweep, gridSize, onDone }) {
  const materialRef = useRef(null);
  const { room, origin, start } = sweep;
  const maxDistance = Math.hypot(Math.max(origin.x, room.width - origin.x), Math.max(origin.y, room.height - origin.y)) + 2;
  const uniforms = useMemo(
    () => ({
      uSize: { value: new THREE.Vector2(room.width, room.height) },
      uOrigin: { value: new THREE.Vector2(origin.x, origin.y) },
      uRadius: { value: 0 },
    }),
    [room.width, room.height, origin.x, origin.y]
  );

  useFrame(() => {
    const t = (performance.now() - start) / BARRIDO_MS;
    if (materialRef.current) materialRef.current.uniforms.uRadius.value = Math.min(1, t) * maxDistance;
    if (t >= 1) onDone(sweep.id);
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(room.col + room.width / 2) * gridSize, 0.035, (room.row + room.height / 2) * gridSize]}
      raycast={() => null}
      renderOrder={5}
    >
      <planeGeometry args={[room.width * gridSize, room.height * gridSize]} />
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={VEIL_VERTEX}
        fragmentShader={VEIL_FRAGMENT}
      />
    </mesh>
  );
}

function TrapGlow({ glow, gridSize, onDone }) {
  const materialRef = useRef(null);
  const meshRef = useRef(null);
  useFrame(() => {
    const age = (performance.now() - glow.start) / BRILLO_TRAMPA_MS;
    if (age >= 1) {
      onDone(glow.id);
      return;
    }
    const pulse = (Math.sin(age * Math.PI * 6) + 1) / 2;
    if (materialRef.current) materialRef.current.opacity = (1 - age) * (0.45 + pulse * 0.45);
    if (meshRef.current) meshRef.current.scale.setScalar(0.9 + pulse * 0.25);
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[glow.position.x, 0.06, glow.position.z]} raycast={() => null}>
      <ringGeometry args={[gridSize * 0.38, gridSize * 0.52, 40]} />
      <meshBasicMaterial ref={materialRef} color="#e8c368" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Origen del barrido: la puerta abierta más cercana a la sala, o su centro. */
function sweepOrigin(room, doors) {
  let best = null;
  for (const door of doors ?? []) {
    if (!door.isOpen) continue;
    const dx = Math.max(room.col - door.col, 0, door.col - (room.col + room.width - 1));
    const dy = Math.max(room.row - door.row, 0, door.row - (room.row + room.height - 1));
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { distance, door };
  }
  if (!best || best.distance > 2) return { x: room.width / 2, y: room.height / 2 };
  return {
    x: Math.min(room.width, Math.max(0, best.door.col - room.col + 0.5)),
    y: Math.min(room.height, Math.max(0, best.door.row - room.row + 0.5)),
  };
}

export default function RevealEffects({ map }) {
  const [sweeps, setSweeps] = useState([]);
  const [glows, setGlows] = useState([]);
  const seenRef = useRef({ floorId: null, rooms: null, traps: null });

  useEffect(() => {
    const revealedRooms = (map.rooms ?? []).filter((room) => room.revealed);
    const traps = (map.tokens ?? []).filter((token) => token.kind === 'trampa' && token.visible !== false);
    const seen = seenRef.current;
    // Primera carga o cambio de planta: lo que ya estaba no se «revela»
    if (seen.floorId !== map.floorId || !seen.rooms) {
      seenRef.current = {
        floorId: map.floorId,
        rooms: new Set(revealedRooms.map((room) => room.id)),
        traps: new Set(traps.map((token) => token.id)),
      };
      return;
    }
    const freshRooms = revealedRooms.filter((room) => !seen.rooms.has(room.id));
    const freshTraps = traps.filter((token) => !seen.traps.has(token.id));
    seenRef.current = {
      floorId: map.floorId,
      rooms: new Set(revealedRooms.map((room) => room.id)),
      traps: new Set(traps.map((token) => token.id)),
    };
    if (prefiereMenosMovimiento()) return;
    const now = performance.now();
    if (freshRooms.length) {
      setSweeps((current) => [
        ...current,
        ...freshRooms.map((room) => ({ id: `${room.id}-${now}`, room, origin: sweepOrigin(room, map.doors), start: now })),
      ]);
    }
    if (freshTraps.length) {
      setGlows((current) => [
        ...current,
        ...freshTraps.map((token) => ({ id: `${token.id}-${now}`, position: token.position, start: now })),
      ]);
    }
  }, [map]);

  return (
    <>
      {sweeps.map((sweep) => (
        <RoomVeil
          key={sweep.id}
          sweep={sweep}
          gridSize={map.gridSize}
          onDone={(id) => setSweeps((current) => current.filter((item) => item.id !== id))}
        />
      ))}
      {glows.map((glow) => (
        <TrapGlow
          key={glow.id}
          glow={glow}
          gridSize={map.gridSize}
          onDone={(id) => setGlows((current) => current.filter((item) => item.id !== id))}
        />
      ))}
    </>
  );
}
