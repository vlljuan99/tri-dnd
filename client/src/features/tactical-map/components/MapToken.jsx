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
  return 64;
}

function makeTokenSurfaces() {
  const grainCanvas = document.createElement('canvas');
  grainCanvas.width = 96;
  grainCanvas.height = 96;
  const grainContext = grainCanvas.getContext('2d');
  const pixels = grainContext.createImageData(96, 96);
  for (let index = 0; index < 96 * 96; index += 1) {
    const x = index % 96;
    const y = Math.floor(index / 96);
    const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const value = 160 + Math.floor((noise - Math.floor(noise)) * 60);
    pixels.data.set([value, value, value, 255], index * 4);
  }
  grainContext.putImageData(pixels, 0, 0);
  const grain = new THREE.CanvasTexture(grainCanvas);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d');
  const gradient = shadowContext.createRadialGradient(32, 32, 13, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0, 0, 0, .5)');
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, .22)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  shadowContext.fillStyle = gradient;
  shadowContext.fillRect(0, 0, 64, 64);
  const shadow = new THREE.CanvasTexture(shadowCanvas);
  return { grain, shadow };
}

function TurnIndicator({ size }) {
  const materialRef = useRef(null);
  const meshRef = useRef(null);
  useFrame(({ clock }) => {
    const wave = (Math.sin(clock.elapsedTime * 2.4) + 1) / 2;
    if (materialRef.current) materialRef.current.opacity = 0.4 + wave * 0.2;
    if (meshRef.current) {
      const scale = 0.99 + wave * 0.035;
      meshRef.current.scale.setScalar(scale);
    }
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.075, 0]} raycast={() => null}>
      <ringGeometry args={[size * 0.54, size * 0.59, 64]} />
      <meshBasicMaterial ref={materialRef} color="#edcc8e" transparent opacity={0.6} depthWrite={false} toneMapped={false} />
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
      : visual.type === 'hit'
        ? '¡Crítico!'
        : visual.text ?? (visual.type === 'miss' ? 'Fallo' : '');
  const color = visual.type === 'heal'
    ? '#8ee39b'
    : visual.type === 'damage'
      ? visual.critical ? '#ffd078' : '#ff7b68'
      : visual.type === 'hit'
        ? '#ffd078'
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
      <spriteMaterial ref={materialRef} map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

function GraveCross({ size, visible }) {
  const groupRef = useRef(null);

  useFrame(() => {
    if (!groupRef.current) return;
    const targetScale = visible ? 1 : 0.01;
    const scale = THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, 0.14);
    groupRef.current.scale.setScalar(scale);
    groupRef.current.position.y = THREE.MathUtils.lerp(
      groupRef.current.position.y,
      visible ? size * 0.08 : -size * 0.2,
      0.14
    );
  });

  return (
    <group
      ref={groupRef}
      position={[0, -size * 0.2, 0]}
      rotation={[0.12, -0.24, -0.08]}
      scale={0.01}
    >
      <mesh castShadow position={[0, size * 0.48, 0]} raycast={() => null}>
        <boxGeometry args={[size * 0.15, size * 0.96, size * 0.13]} />
        <meshStandardMaterial color="#77736b" roughness={1} />
      </mesh>
      <mesh castShadow position={[0, size * 0.64, 0]} raycast={() => null}>
        <boxGeometry args={[size * 0.58, size * 0.14, size * 0.13]} />
        <meshStandardMaterial color="#89847a" roughness={1} />
      </mesh>
    </group>
  );
}

// Aro bajo el objetivo mientras apuntas: verde si el golpe llega, ámbar si
// sale a distancia larga (desventaja) y rojo si no llega o no lo ves. Es la
// respuesta a "¿le alcanzo desde aquí?" sin abrir ningún panel.
const RANGE_COLORS = {
  alcance: '#7bb661',
  larga: '#d8a13a',
  fuera: '#c2452d',
  'sin-vision': '#7a6f66',
};

function RangeIndicator({ size, state }) {
  const materialRef = useRef(null);
  const color = state ? RANGE_COLORS[state] ?? RANGE_COLORS.fuera : null;

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 3.2) * 0.2;
  });

  if (!color) return null;
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} raycast={() => null}>
      <torusGeometry args={[size * 0.58, 0.05, 8, 40]} />
      <meshBasicMaterial ref={materialRef} color={color} transparent opacity={0.6} toneMapped={false} />
    </mesh>
  );
}

export default function MapToken({
  token,
  selected,
  active,
  dead = false,
  movable,
  saving,
  visuals = [],
  onSelect,
  // Altura del suelo bajo el token: sobre una cornisa, la ficha se apoya en la
  // plataforma. Sin esto quedaba enterrada dentro del bloque y desde la cámara
  // cenital solo asomaba su etiqueta.
  groundY = 0,
  // Veredicto del arma que llevas empuñada sobre ESTE objetivo, o null si no
  // estás apuntando: 'alcance' | 'larga' | 'fuera' | 'sin-vision'.
  rangeState = null,
}) {
  const groupRef = useRef(null);
  const discRef = useRef(null);
  const baseMaterialRef = useRef(null);
  const rimMaterialRef = useRef(null);
  const grayOverlayMaterialRef = useRef(null);
  const flashRef = useRef(0);
  const missRef = useRef(0);
  const targetPosition = useMemo(
    () => new THREE.Vector3(token.position.x, groundY + 0.12, token.position.z),
    [groundY, token.position.x, token.position.z]
  );
  const segments = tokenShapeSegments(token.type);
  // El retrato circular queda dentro de la cara de las peanas cuadradas.
  const portraitRadius = token.size * (token.type === 'npc' ? 0.305 : 0.385);
  const surfaces = useMemo(makeTokenSurfaces, []);
  useEffect(() => () => {
    surfaces.grain.dispose();
    surfaces.shadow.dispose();
  }, [surfaces]);
  // El disco se vuelca con 0 PG. La cruz, en cambio, depende del estado final
  // del tracker que llega por separado desde el servidor.
  const downed = isTokenDowned(token);
  const baseColor = useMemo(() => new THREE.Color(token.color || '#6e7c55').lerp(new THREE.Color('#363a35'), 0.48), [token.color]);
  const rimColor = useMemo(() => new THREE.Color(movable ? '#b69b66' : '#77786e'), [movable]);
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
        downed ? Math.PI / 2 : 0,
        0.16
      );
    }
    baseMaterialRef.current?.color.lerp(
      flashRef.current > Date.now() ? impactColor : downed ? deadBaseColor : baseColor,
      flashRef.current > Date.now() ? 0.7 : 0.16
    );
    rimMaterialRef.current?.color.lerp(downed ? deadRimColor : rimColor, 0.16);
    if (grayOverlayMaterialRef.current) {
      grayOverlayMaterialRef.current.opacity = THREE.MathUtils.lerp(
        grayOverlayMaterialRef.current.opacity,
        downed ? 0.68 : 0,
        0.16
      );
    }
  });

  return (
    <group
      ref={groupRef}
      position={[token.position.x, groundY + 0.12, token.position.z]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(token.id);
      }}
    >
      {selected && <SelectionIndicator size={token.size} />}
      <RangeIndicator size={token.size} state={rangeState} />
      {active && <TurnIndicator size={token.size} />}
      {/* Contacto suave incluso con sombras de resolución reducida;
          la peana conserva el mismo centro y huella lógica de la ficha. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.113, 0]} raycast={() => null}>
        <planeGeometry args={[token.size * 1.24, token.size * 1.24]} />
        <meshBasicMaterial map={surfaces.shadow} transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <group ref={discRef}>
        <mesh castShadow receiveShadow position={[0, -0.055, 0]}>
          <cylinderGeometry args={[token.size * 0.48, token.size * 0.45, 0.11, segments]} />
          <meshStandardMaterial color="#323632" roughness={0.95} bumpMap={surfaces.grain} bumpScale={0.018} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.02, 0]}>
          <cylinderGeometry args={[token.size * 0.46, token.size * 0.48, 0.1, segments]} />
          <meshStandardMaterial ref={baseMaterialRef} color={baseColor} roughness={0.76} metalness={0.18} bumpMap={surfaces.grain} bumpScale={0.01} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.092, 0]}>
          <cylinderGeometry args={[token.size * 0.447, token.size * 0.48, 0.045, segments]} />
          <meshStandardMaterial
            ref={rimMaterialRef}
            color={rimColor}
            roughness={0.4}
            metalness={0.64}
            roughnessMap={surfaces.grain}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.117, 0]} raycast={() => null}>
          <ringGeometry args={[portraitRadius, portraitRadius + token.size * 0.018, 64]} />
          <meshStandardMaterial color="#272b27" roughness={0.65} metalness={0.3} />
        </mesh>
        <TokenIcon imageUrl={token.imageUrl} radius={portraitRadius} color={token.color} name={token.name} />
        {/* Velo gris sobre el retrato: desatura también las texturas sin
            necesitar un shader adicional y desaparece al recuperar PG. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.123, 0]} raycast={() => null}>
          <circleGeometry args={[portraitRadius, 64]} />
          <meshBasicMaterial
            ref={grayOverlayMaterialRef}
            color="#737773"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      </group>
      <GraveCross size={token.size} visible={dead && downed} />
      {saving && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]} raycast={() => null}>
          <ringGeometry args={[token.size * 0.53, token.size * 0.61, 24]} />
          <meshBasicMaterial color="#e8dfc9" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <TokenLabel token={token} selected={selected} active={active} />
      {visuals
        .filter(
          (visual) =>
            ['damage', 'heal', 'miss', 'legendary', 'lair'].includes(visual.type) ||
            (visual.type === 'hit' && visual.critical)
        )
        .map((visual) => <FloatingCombatText key={visual.id} visual={visual} size={token.size} />)}
    </group>
  );
}
