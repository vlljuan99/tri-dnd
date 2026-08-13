import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import SelectionIndicator from './SelectionIndicator.jsx';
import TokenIcon from './TokenIcon.jsx';
import TokenLabel from './TokenLabel.jsx';
import { isTokenDowned } from '../domain/tokens.js';

function tokenShapeSegments(type) {
  if (type === 'enemy') return 6;
  if (type === 'npc') return 4;
  return 32;
}

// Barra de vida plana sobre el suelo, junto al token: fondo oscuro y
// relleno proporcional que va del verde al rojo según lo herido que esté
function HpBar({ token }) {
  if (!Number.isInteger(token.hp) || !Number.isInteger(token.hpMax) || token.hpMax <= 0) return null;
  const ratio = Math.max(0, Math.min(1, token.hp / token.hpMax));
  const width = token.size * 0.9;
  const color = ratio > 0.5 ? '#5e8c4a' : ratio > 0.25 ? '#c98f2e' : '#b33939';

  return (
    <group position={[0, 0.02, -token.size * 0.62]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[width, 0.14]} />
        <meshBasicMaterial color="#14110f" transparent opacity={0.85} />
      </mesh>
      {ratio > 0 && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[(-width * (1 - ratio)) / 2, 0.005, 0]}
          raycast={() => null}
        >
          <planeGeometry args={[width * ratio, 0.1]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}

function TurnIndicator({ size }) {
  const materialRef = useRef(null);
  const meshRef = useRef(null);
  useFrame(({ clock }) => {
    const wave = (Math.sin(clock.elapsedTime * 4.2) + 1) / 2;
    if (materialRef.current) materialRef.current.opacity = 0.35 + wave * 0.45;
    if (meshRef.current) {
      const scale = 0.96 + wave * 0.14;
      meshRef.current.scale.setScalar(scale);
    }
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.075, 0]} raycast={() => null}>
      <ringGeometry args={[size * 0.53, size * 0.66, 40]} />
      <meshBasicMaterial ref={materialRef} color="#f6d77b" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

function textTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = 'bold 72px Georgia, serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 12;
  context.strokeStyle = 'rgba(12, 9, 8, .92)';
  context.strokeText(text, 192, 64);
  context.fillStyle = color;
  context.fillText(text, 192, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function FloatingCombatText({ visual, size }) {
  const spriteRef = useRef(null);
  const materialRef = useRef(null);
  const label = visual.type === 'damage'
    ? `−${visual.value}`
    : visual.type === 'heal'
      ? `+${visual.value}`
      : visual.text ?? (visual.type === 'miss' ? 'Fallo' : '');
  const color = visual.type === 'heal'
    ? '#8ee39b'
    : visual.type === 'damage'
      ? visual.critical ? '#ffd078' : '#ff7b68'
      : '#e8d7ad';
  const texture = useMemo(() => textTexture(label, color), [color, label]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const age = Math.max(0, (Date.now() - visual.createdAt) / 1000);
    if (spriteRef.current) spriteRef.current.position.y = size * (1.05 + age * 0.95);
    if (materialRef.current) materialRef.current.opacity = Math.max(0, 1 - age / 1.55);
  });
  if (!label) return null;
  return (
    <sprite ref={spriteRef} position={[0, size * 1.05, 0]} scale={[size * 1.8, size * 0.6, 1]} raycast={() => null}>
      <spriteMaterial ref={materialRef} map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

export default function MapToken({ token, selected, active, movable, saving, visuals = [], onSelect }) {
  const groupRef = useRef(null);
  const discRef = useRef(null);
  const baseMaterialRef = useRef(null);
  const rimMaterialRef = useRef(null);
  const grayOverlayMaterialRef = useRef(null);
  const flashRef = useRef(0);
  const missRef = useRef(0);
  const targetPosition = useMemo(
    () => new THREE.Vector3(token.position.x, 0.12, token.position.z),
    [token.position.x, token.position.z]
  );
  const segments = tokenShapeSegments(token.type);
  // El disco se vuelca al caer inconsciente (0 PG), no al acumular el tercer
  // fallo de muerte. El estado final vive en el tracker, no en la pose.
  const dead = isTokenDowned(token);
  const baseColor = useMemo(() => new THREE.Color(token.color || '#6e7c55'), [token.color]);
  const rimColor = useMemo(() => new THREE.Color(movable ? '#f1c96a' : '#3a332c'), [movable]);
  const deadBaseColor = useMemo(() => new THREE.Color('#626462'), []);
  const deadRimColor = useMemo(() => new THREE.Color('#8a8c88'), []);
  const impactColor = useMemo(() => new THREE.Color('#ff3f32'), []);

  useEffect(() => {
    const latest = visuals.at(-1);
    if (!latest) return;
    if (latest.type === 'hit' || latest.type === 'damage') flashRef.current = Date.now() + 220;
    if (latest.type === 'miss') missRef.current = Date.now() + 300;
  }, [visuals]);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.lerp(targetPosition, 0.25);
    if (missRef.current > Date.now()) {
      const left = missRef.current - Date.now();
      groupRef.current.position.x += Math.sin(left * 0.11) * Math.min(0.11, left / 1800);
    }
    if (discRef.current) {
      discRef.current.rotation.x = THREE.MathUtils.lerp(
        discRef.current.rotation.x,
        dead ? Math.PI / 2 : 0,
        0.16
      );
    }
    baseMaterialRef.current?.color.lerp(
      flashRef.current > Date.now() ? impactColor : dead ? deadBaseColor : baseColor,
      flashRef.current > Date.now() ? 0.7 : 0.16
    );
    rimMaterialRef.current?.color.lerp(dead ? deadRimColor : rimColor, 0.16);
    if (grayOverlayMaterialRef.current) {
      grayOverlayMaterialRef.current.opacity = THREE.MathUtils.lerp(
        grayOverlayMaterialRef.current.opacity,
        dead ? 0.68 : 0,
        0.16
      );
    }
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
      {active && <TurnIndicator size={token.size} />}
      <group ref={discRef}>
        <mesh>
          <cylinderGeometry args={[token.size * 0.43, token.size * 0.43, 0.16, segments]} />
          <meshStandardMaterial ref={baseMaterialRef} color={token.color || '#6e7c55'} roughness={0.82} />
        </mesh>
        <mesh position={[0, 0.087, 0]}>
          <cylinderGeometry args={[token.size * 0.48, token.size * 0.48, 0.035, segments]} />
          <meshBasicMaterial
            ref={rimMaterialRef}
            color={movable ? '#f1c96a' : '#3a332c'}
            transparent
            opacity={movable ? 0.9 : 0.72}
          />
        </mesh>
        <TokenIcon imageUrl={token.imageUrl} radius={token.size * 0.4} />
        {/* Velo gris sobre el retrato: desatura también las texturas sin
            necesitar un shader adicional y desaparece al recuperar PG. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.112, 0]} raycast={() => null}>
          <circleGeometry args={[token.size * 0.405, 32]} />
          <meshBasicMaterial
            ref={grayOverlayMaterialRef}
            color="#737773"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      </group>
      {saving && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
          <ringGeometry args={[token.size * 0.53, token.size * 0.61, 24]} />
          <meshBasicMaterial color="#e8dfc9" transparent opacity={0.55} />
        </mesh>
      )}
      <HpBar token={token} />
      <TokenLabel token={token} />
      {visuals
        .filter((visual) => ['damage', 'heal', 'miss', 'legendary', 'lair'].includes(visual.type))
        .map((visual) => <FloatingCombatText key={visual.id} visual={visual} size={token.size} />)}
    </group>
  );
}
