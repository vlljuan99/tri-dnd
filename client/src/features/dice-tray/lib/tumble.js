import * as THREE from 'three';
import { quaternionForValue } from './diceShapes.js';

// El vuelo del dado: cae, bota, rueda y frena hasta quedarse en la cara que ya
// salió. Todo es determinista a partir de una semilla, así que la trayectoria se
// puede reproducir y comprobar sin pintar un solo píxel.
//
// La regla que no se puede romper: al terminar, la orientación debe ser
// EXACTAMENTE la que deja arriba el valor de la tirada. El giro que da la
// sensación de rodar se desvanece a cero justo al final para que eso se cumpla
// por construcción y no por aproximación.

const UP = new THREE.Vector3(0, 1, 0);

// Tiempos, en milisegundos. Un dado que rueda menos de medio segundo no pesa;
// uno que rueda dos segundos aburre a la cuarta tirada de la sesión.
export const VUELO_MS = 1150;
// Cada dado sale un poco después que el anterior: el repiqueteo se lee en
// secuencia en vez de como un golpe único.
export const RETARDO_ENTRE_DADOS_MS = 90;
// Con muchos dados el retardo acumulado se comprime para que una tirada de 8d6
// no dure el triple que una de 2d6.
export const RETARDO_MAXIMO_MS = 520;

const ALTURA_SALIDA = 7;
const BOTES = 2.4;

/** Generador determinista (mulberry32): misma semilla, mismo vuelo. */
function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

export function retardoDe(index, count) {
  if (count <= 1) return 0;
  const total = Math.min(RETARDO_ENTRE_DADOS_MS * (count - 1), RETARDO_MAXIMO_MS);
  return (total * index) / (count - 1);
}

/** Duración total de una tanda: el último dado en salir más su vuelo. */
export function duracionTotal(count) {
  return retardoDe(Math.max(0, count - 1), count) + VUELO_MS;
}

/**
 * Prepara el vuelo de un dado.
 *
 * - `die` y `value`: qué dado es y qué número tiene que quedar arriba.
 * - `index` / `count`: su sitio en la tanda, para el retardo y el reposo.
 * - `seed`: semilla de la tirada (el `rollId` del store sirve).
 */
export function createTumble({ die, value, index = 0, count = 1, seed = 1, radius = 1.15 }) {
  const random = seededRandom(seed * 7919 + index * 104_729);
  const delay = retardoDe(index, count);
  const target = quaternionForValue(die, value, { spin: random() * Math.PI * 2 });

  // Reposo repartido en abanico, con desorden suficiente para que dos tiradas
  // iguales no queden calcadas pero sin que los dados se pisen.
  const spread = Math.min(1.1 + count * 0.42, 4.6);
  const slot = count <= 1 ? 0 : index / (count - 1) - 0.5;
  const rest = new THREE.Vector3(
    slot * spread + (random() - 0.5) * 0.34,
    radius,
    (random() - 0.5) * 1.5
  );
  // Sale desde arriba y desde un lado, como lanzado desde la mano.
  const start = new THREE.Vector3(
    rest.x + (random() - 0.5) * 3.4,
    ALTURA_SALIDA + random() * 1.6,
    rest.z - 3.6 - random() * 1.4
  );

  const startQuaternion = new THREE.Quaternion().random();
  const spinAxis = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
    .normalize();
  const spinTurns = 2.2 + random() * 2.4;

  return {
    die,
    value,
    delay,
    duration: delay + VUELO_MS,
    rest,
    start,
    target,

    /**
     * Estado del dado en un instante. Antes de su retardo espera fuera de la
     * mesa; al llegar al final devuelve el reposo y la orientación exactos.
     */
    sample(elapsed) {
      const local = elapsed - delay;
      if (local <= 0) {
        return { position: start.clone(), quaternion: startQuaternion.clone(), settled: false, visible: false };
      }
      if (local >= VUELO_MS) {
        return { position: rest.clone(), quaternion: target.clone(), settled: true, visible: true };
      }

      const t = local / VUELO_MS;
      const eased = easeOutCubic(t);

      // Horizontal: llega a su sitio antes de dejar de rodar, como un dado que
      // se queda girando sobre la mesa.
      const position = new THREE.Vector3(
        THREE.MathUtils.lerp(start.x, rest.x, eased),
        0,
        THREE.MathUtils.lerp(start.z, rest.z, eased)
      );
      // Vertical: botes que se van apagando. El valor absoluto del seno da el
      // rebote y `(1 - t)²` le quita fuerza en cada uno.
      const bounce = Math.abs(Math.sin(Math.PI * BOTES * t)) * (1 - t) ** 2;
      position.y = rest.y + bounce * ALTURA_SALIDA * (1 - eased * 0.35);

      // Giro: interpola hacia la orientación final y encima le suma vueltas que
      // se desvanecen. En t = 1 el sobregiro vale 0 y queda el objetivo exacto.
      const quaternion = new THREE.Quaternion().slerpQuaternions(startQuaternion, target, eased);
      const overspin = new THREE.Quaternion().setFromAxisAngle(
        spinAxis,
        spinTurns * Math.PI * 2 * (1 - eased)
      );
      quaternion.premultiply(overspin);

      return { position, quaternion, settled: false, visible: true };
    },
  };
}

export { UP };
