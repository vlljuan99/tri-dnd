import * as THREE from 'three';
import { SUPPORTED_DICE, supportsDie } from './supported.js';

// Geometría de los dados físicos y, sobre todo, la respuesta a la única
// pregunta que puede salir mal: ¿cómo hay que girar este poliedro para que
// quede arriba la cara que YA salió?
//
// El resultado de una tirada lo decide `lib/dice.js` y se comparte por socket
// en el mismo instante. El dado que rueda por la pantalla es presentación: no
// decide nada, tiene que ATERRIZAR en el número que ya está dicho. Si la
// animación mostrara otra cara, el dado estaría mintiendo sobre la tirada.
//
// Solo se modelan los cinco sólidos platónicos, que son los dados de verdad:
// d4 (tetraedro), d6 (cubo), d8 (octaedro), d12 (dodecaedro) y d20 (icosaedro).
// El d10 es un trapezoedro pentagonal y el d100 un zocaedro: no son platónicos,
// sus caras no salen de una primitiva de three.js y necesitan su propia
// construcción. Hasta entonces esas dos tiradas se presentan solo con la
// tarjeta numérica de siempre (ver `supportsDie`).

const UP = new THREE.Vector3(0, 1, 0);

// Dos normales se consideran la misma cara si apuntan casi exactamente igual.
// Los sólidos platónicos tienen caras planas de verdad, así que la tolerancia
// solo absorbe el error de coma flotante.
const SAME_NORMAL = 0.999_9;
const OPPOSITE_NORMAL = -0.999;

/**
 * Trapezoedro pentagonal: el cuerpo del d10, que no es un sólido platónico y
 * por tanto no sale de ninguna primitiva de three.js.
 *
 * Son diez cometas. Su "ecuador" es un zigzag de diez vértices que alternan
 * entre dos alturas (±a) y dos polos (±h). La proporción entre a y h **no es
 * libre**: solo con la correcta las cometas son planas de verdad. Si no lo
 * fueran, cada una se partiría en dos triángulos con normales distintas y el
 * dado acabaría teniendo veinte caras de cinco valores imposibles.
 *
 * Imponiendo que el polo, el punto medio de los dos vértices altos y el vértice
 * bajo estén alineados sale h = a·(1+cos36°)/(1−cos36°).
 */
function pentagonalTrapezohedron(radius = 1, zigzag = 0.105) {
  const cos36 = Math.cos(Math.PI / 5);
  const height = (zigzag * (1 + cos36)) / (1 - cos36);
  const north = new THREE.Vector3(0, height, 0);
  const south = new THREE.Vector3(0, -height, 0);

  const upper = [];
  const lower = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i * 2 * Math.PI) / 5;
    upper.push(new THREE.Vector3(radius * Math.cos(angle), zigzag, radius * Math.sin(angle)));
    const offset = angle + Math.PI / 5;
    lower.push(new THREE.Vector3(radius * Math.cos(offset), -zigzag, radius * Math.sin(offset)));
  }

  const positions = [];
  const pushTriangle = (a, b, c) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  for (let i = 0; i < 5; i += 1) {
    const next = (i + 1) % 5;
    // Cometa del hemisferio norte: polo, alto, bajo, alto siguiente.
    pushTriangle(north, upper[i], lower[i]);
    pushTriangle(north, lower[i], upper[next]);
    // Cometa del sur: polo, bajo, alto siguiente, bajo siguiente.
    pushTriangle(south, lower[i], upper[next]);
    pushTriangle(south, upper[next], lower[next]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

const BUILDERS = {
  d4: () => new THREE.TetrahedronGeometry(1),
  d6: () => new THREE.BoxGeometry(1.25, 1.25, 1.25),
  d8: () => new THREE.OctahedronGeometry(1),
  d10: () => pentagonalTrapezohedron(),
  d12: () => new THREE.DodecahedronGeometry(1),
  d20: () => new THREE.IcosahedronGeometry(1),
};

// La lista de dados soportados vive en `supported.js`, que no arrastra three.js
// para poder consultarla desde el bundle principal. Aquí solo se comprueba que
// las dos mitades no se separen: cada dado declarado tiene que tener geometría.
export { SUPPORTED_DICE, supportsDie };

export function dadosSinGeometria() {
  return SUPPORTED_DICE.filter((die) => !BUILDERS[die]);
}

export function buildDieGeometry(die) {
  const build = BUILDERS[die];
  if (!build) throw new Error(`Dado sin geometría física: ${die}`);
  // Cada triángulo debe traer sus tres vértices para poder agruparlos por
  // normal sin resolver referencias. Los poliedros de three.js ya vienen así;
  // el cubo es el único indexado, y convertir uno que no lo está solo suelta un
  // aviso por consola.
  const geometry = build();
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

/**
 * Agrupa los triángulos de la geometría en caras reales. Una cara del cubo son
 * dos triángulos y una del dodecaedro son tres: lo que las une es compartir la
 * normal.
 */
function collectFaces(geometry) {
  const position = geometry.getAttribute('position');
  const faces = [];

  for (let i = 0; i < position.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    const normal = new THREE.Vector3()
      .subVectors(c, b)
      .cross(new THREE.Vector3().subVectors(a, b))
      .normalize();

    // Todos estos cuerpos son convexos y están centrados en el origen, así que
    // la normal de fuera siempre apunta al mismo lado que el centro del
    // triángulo. Corregirla aquí evita depender del sentido de giro con el que
    // se declararon los vértices, que en el d10 se construye a mano.
    const center = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    if (normal.dot(center) < 0) normal.negate();

    const existing = faces.find((face) => face.normal.dot(normal) > SAME_NORMAL);
    const target = existing ?? { normal, points: [] };
    target.points.push(a, b, c);
    if (!existing) faces.push(target);
  }

  return faces.map((face) => ({
    normal: face.normal,
    centroid: face.points
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .divideScalar(face.points.length),
  }));
}

/**
 * Numera las caras como un dado de verdad: **las caras opuestas suman N+1**
 * (en un d20, el 1 está enfrente del 20). Quien conozca los dados lo nota.
 *
 * El tetraedro es la excepción y no por capricho: en un tetraedro cada cara
 * tiene enfrente un vértice, no otra cara, así que no hay pares que emparejar
 * y los cuatro valores se asignan en orden.
 *
 * El orden de partida se fija a mano en vez de confiar en el que devuelva
 * three.js, para que la numeración sea la misma entre versiones y las pruebas
 * signifiquen algo.
 */
function numberFaces(faces) {
  const ordered = [...faces].sort((left, right) => {
    const round = (value) => Math.round(value * 1000) / 1000;
    return (
      round(right.normal.y) - round(left.normal.y) ||
      round(right.normal.x) - round(left.normal.x) ||
      round(right.normal.z) - round(left.normal.z)
    );
  });

  const total = ordered.length;
  const values = new Array(total).fill(null);
  let next = 1;

  for (let index = 0; index < total; index += 1) {
    if (values[index] != null) continue;
    values[index] = next;
    const opposite = ordered.findIndex(
      (face, other) =>
        other !== index && values[other] == null && face.normal.dot(ordered[index].normal) < OPPOSITE_NORMAL
    );
    if (opposite >= 0) values[opposite] = total + 1 - next;
    next += 1;
  }

  return ordered.map((face, index) => ({
    value: values[index],
    normal: face.normal,
    centroid: face.centroid,
  }));
}

const faceCache = new Map();

/** Caras numeradas de un tipo de dado: `[{ value, normal, centroid }]`. */
export function dieFaces(die) {
  if (!faceCache.has(die)) {
    faceCache.set(die, numberFaces(collectFaces(buildDieGeometry(die))));
  }
  return faceCache.get(die);
}

/**
 * Giro que deja la cara `value` mirando al cielo.
 *
 * `spin` añade vueltas alrededor del eje vertical: cambia cómo queda apoyado el
 * dado, nunca qué número se lee, así que dos tiradas del mismo número no se ven
 * calcadas.
 */
export function quaternionForValue(die, value, { spin = 0 } = {}) {
  const face = dieFaces(die).find((candidate) => candidate.value === value);
  if (!face) throw new Error(`El ${die} no tiene cara ${value}`);
  const settle = new THREE.Quaternion().setFromUnitVectors(face.normal, UP);
  if (!spin) return settle;
  return new THREE.Quaternion().setFromAxisAngle(UP, spin).multiply(settle);
}

/**
 * Cara que se lee con una orientación dada: la que más mira hacia arriba. Es la
 * inversa de `quaternionForValue` y existe para poder comprobarlo.
 */
export function faceUp(die, quaternion) {
  let best = null;
  for (const face of dieFaces(die)) {
    const height = face.normal.clone().applyQuaternion(quaternion).y;
    if (!best || height > best.height) best = { value: face.value, height };
  }
  return best?.value ?? null;
}
