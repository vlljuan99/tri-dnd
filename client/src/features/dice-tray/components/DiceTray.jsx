import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { buildDieGeometry, dieFaces } from '../lib/diceShapes.js';
import { dadosDeTirada, faceLabel } from '../lib/supported.js';
import { VUELO_MS, createTumble } from '../lib/tumble.js';
import { play } from '../../../lib/sfx/index.js';

// Bandeja de dados físicos: los dados caen sobre la pantalla, botan, ruedan y
// se quedan en la cara que salió. No decide nada — el número ya lo tiró
// `lib/dice.js` y ya viajó por el socket — y no captura ni un clic.
//
// Solo está montada mientras la cola de revelado (store/reveal.js) enseña una
// tirada: fuera de eso no hay canvas ni bucle de render. Cuándo aparece y
// cuándo se va lo decide la cola, no la bandeja.

const COLOR_NORMAL = '#e9e3d2';
const COLOR_CRITICO = '#e8c368';
const COLOR_PIFIA = '#8f2b23';
const COLOR_NUMERO = '#1b1a17';
const COLOR_NUMERO_CLARO = '#f3ecd8';

// Lo lejos que se mira la mesa. Es la palanca del tamaño de los dados: alejar
// la cámara los encoge de forma proporcional —cuerpo, separación entre ellos y
// altura de los botes— sin tocar la física ni descuadrar dónde caen. La primera
// versión (a 7,4 / 8,6) ocupaba demasiada pantalla.
const CAMARA = [0, 10.4, 12.1];

// Tamaño del número sobre la cara: las caras del d20 y el d12 son pequeñas, y
// las cometas del d10 son estrechas.
const TAMANO_NUMERO = { d4: 0.62, d6: 0.72, d8: 0.6, d10: 0.46, d12: 0.42, d20: 0.34 };

const texturas = new Map();

/** Textura con el rótulo dibujado, cacheada por texto y color. */
function numberTexture(label, color) {
  const key = `${label}-${color}`;
  if (texturas.has(key)) return texturas.get(key);

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.font = `bold ${label.length > 1 ? 62 : 76}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 4);
  // El 6 y el 9 se confunden girados: subrayarlos es lo que se hace en los
  // dados reales.
  if (label === '6' || label === '9') {
    ctx.fillRect(size * 0.33, size * 0.78, size * 0.34, 6);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texturas.set(key, texture);
  return texture;
}

/** Los números de cada cara, mirando hacia fuera. */
function FaceNumbers({ die, colorNumero, faces: papel }) {
  const faces = useMemo(() => dieFaces(die), [die]);
  const size = TAMANO_NUMERO[die] ?? 0.5;

  return faces.map((face) => {
    // El plano nace mirando a +Z; se gira para que mire como la cara y se
    // separa un pelo para no quedar enterrado en el cuerpo del dado.
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      face.normal
    );
    const position = face.centroid.clone().addScaledVector(face.normal, 0.012);
    return (
      <mesh key={face.value} position={position} quaternion={quaternion} raycast={() => null}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial
          map={numberTexture(faceLabel(face.value, papel), colorNumero)}
          transparent
          depthWrite={false}
        />
      </mesh>
    );
  });
}

function Die({ spec, index, count, seed, vueloMs, onSettled }) {
  const groupRef = useRef(null);
  const startRef = useRef(null);
  const avisadoRef = useRef(false);
  const geometry = useMemo(() => buildDieGeometry(spec.die), [spec.die]);
  const tumble = useMemo(
    () => createTumble({ die: spec.die, value: spec.value, index, count, seed, vueloMs }),
    [spec.die, spec.value, index, count, seed, vueloMs]
  );

  const esCritico = spec.die === 'd20' && spec.value === 20 && !spec.discarded;
  const esPifia = spec.die === 'd20' && spec.value === 1 && !spec.discarded;
  const color = esCritico ? COLOR_CRITICO : esPifia ? COLOR_PIFIA : COLOR_NORMAL;
  const colorNumero = esPifia ? COLOR_NUMERO_CLARO : COLOR_NUMERO;

  // El sonido sigue a la física en vez de ir por su cuenta: suena cuando el
  // dado toca de verdad la mesa, detectando el momento en que deja de bajar.
  const bajandoRef = useRef(false);
  const alturaRef = useRef(Infinity);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    if (startRef.current == null) startRef.current = clock.elapsedTime;
    const elapsed = (clock.elapsedTime - startRef.current) * 1000;
    const state = tumble.sample(elapsed);
    groupRef.current.position.copy(state.position);
    groupRef.current.quaternion.copy(state.quaternion);
    groupRef.current.visible = state.visible;

    if (state.visible && !state.settled) {
      const y = state.position.y;
      const bajando = y < alturaRef.current;
      // Cambio de bajar a subir = ha rebotado contra la mesa.
      if (bajandoRef.current && !bajando) play('dice.bounce');
      bajandoRef.current = bajando;
      alturaRef.current = y;
    }

    if (state.settled && !avisadoRef.current) {
      avisadoRef.current = true;
      play('dice.land');
      if (esCritico) play('dice.crit');
      if (esPifia) play('dice.fumble');
      onSettled?.();
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          color={color}
          roughness={0.42}
          metalness={0.08}
          emissive={esCritico ? COLOR_CRITICO : '#000000'}
          emissiveIntensity={esCritico ? 0.35 : 0}
          transparent={spec.discarded}
          opacity={spec.discarded ? 0.4 : 1}
        />
      </mesh>
      <FaceNumbers die={spec.die} colorNumero={colorNumero} faces={spec.faces} />
    </group>
  );
}

/**
 * Tirada física de una tanda de dados. `roll` es un resultado de `lib/dice.js`
 * y `rollId` identifica la tirada (sirve de semilla: la misma tirada siempre
 * rueda igual). `onSettled` avisa cuando ya se puede leer el resultado.
 *
 * - `vueloMs`: duración del vuelo según el ritmo de quien mira (y más lento en
 *   un crítico o una pifia: la cámara lenta de la Fase 4b).
 * - `escenario`: en el tablero ('mesa') los dados caen en la franja baja para
 *   no tapar el objetivo; en el resto de pantallas, en el centro.
 */
export default function DiceTray({ roll, rollId, onSettled, vueloMs = VUELO_MS, escenario = 'centro' }) {
  const dados = useMemo(() => dadosDeTirada(roll), [roll]);
  const asentadosRef = useRef(0);

  useEffect(() => {
    asentadosRef.current = 0;
    if (dados.length) play('dice.throw');
    // `dados` cambia con la tirada; se depende de rollId para no volver a sonar
    // por un re-render con la misma tirada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);

  if (!dados.length) return null;

  const enMesa = escenario === 'mesa';
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center ${
        // En la mesa, justo encima del HUD (mismas alturas que sus paneles):
        // la mitad alta del tablero, donde suele estar el objetivo, queda libre.
        enMesa
          ? 'bottom-[12rem] h-[min(28vh,15rem)] sm:bottom-[9rem] md:bottom-[5.5rem] md:h-[min(34vh,17rem)]'
          : 'top-1/2 h-[min(60vh,26rem)] -translate-y-1/2'
      }`}
      aria-hidden="true"
    >
      <div className={`h-full ${enMesa ? 'w-[min(96vw,40rem)]' : 'w-[min(92vw,44rem)]'}`}>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: CAMARA, fov: 42 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.6, 0)}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[-4, 9, 6]} intensity={1.5} />
          <directionalLight position={[5, 4, -3]} intensity={0.5} />
          {dados.map((spec, index) => (
            <Die
              key={`${rollId}-${index}`}
              spec={spec}
              index={index}
              count={dados.length}
              seed={rollId || 1}
              vueloMs={vueloMs}
              onSettled={() => {
                asentadosRef.current += 1;
                if (asentadosRef.current >= dados.length) onSettled?.();
              }}
            />
          ))}
        </Canvas>
      </div>
    </div>
  );
}
