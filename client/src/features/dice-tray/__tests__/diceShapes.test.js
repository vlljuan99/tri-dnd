import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SUPPORTED_DICE,
  dadosSinGeometria,
  dieFaces,
  faceUp,
  quaternionForValue,
  supportsDie,
} from '../lib/diceShapes.js';

const CARAS = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

test('cada dado declarado como soportado tiene geometría de verdad', () => {
  // La lista de dados soportados vive en `supported.js` (sin three.js, para que
  // el bundle principal pueda consultarla) y la geometría en `diceShapes.js`.
  // Si alguien añade un dado a la lista sin construirlo, la bandeja fallaría al
  // tirar: esto lo caza antes.
  assert.deepEqual(dadosSinGeometria(), []);
});

test('cada dado tiene exactamente las caras que le tocan', () => {
  for (const die of SUPPORTED_DICE) {
    assert.equal(dieFaces(die).length, CARAS[die], `${die} debe tener ${CARAS[die]} caras`);
  }
});

test('los valores de las caras son 1..N sin repetir ni saltarse ninguno', () => {
  for (const die of SUPPORTED_DICE) {
    const values = dieFaces(die)
      .map((face) => face.value)
      .sort((a, b) => a - b);
    const esperados = Array.from({ length: CARAS[die] }, (_, index) => index + 1);
    assert.deepEqual(values, esperados, `los valores del ${die} deben ser 1..${CARAS[die]}`);
  }
});

test('el d10 sale con diez cometas planas, no con veinte triángulos', () => {
  // Es la trampa del trapezoedro: sus caras solo son planas con la proporción
  // exacta entre altura y zigzag. Si no lo fueran, cada cometa se partiría en
  // dos y el dado tendría veinte caras con valores imposibles.
  const faces = dieFaces('d10');
  assert.equal(faces.length, 10);
  // Y todas del mismo tamaño: un trapezoedro es un dado justo, sus diez caras
  // son iguales. Se comprueba por la distancia del centro de cada cara al
  // origen, que debe ser la misma en todas.
  const distancias = faces.map((face) => face.centroid.length());
  const min = Math.min(...distancias);
  const max = Math.max(...distancias);
  assert.ok(max - min < 1e-6, `las caras no son iguales: entre ${min} y ${max}`);
});

test('las caras opuestas suman N+1, como en un dado de verdad', () => {
  // El d4 queda fuera a propósito: en un tetraedro cada cara tiene enfrente un
  // vértice, no otra cara, así que no hay pares que sumar.
  for (const die of ['d6', 'd8', 'd10', 'd12', 'd20']) {
    const faces = dieFaces(die);
    const total = faces.length;
    let pares = 0;
    for (const face of faces) {
      const opposite = faces.find((other) => other.normal.dot(face.normal) < -0.999);
      assert.ok(opposite, `cada cara del ${die} debe tener una opuesta`);
      assert.equal(
        face.value + opposite.value,
        total + 1,
        `en el ${die}, ${face.value} debería estar enfrente de ${total + 1 - face.value}`
      );
      pares += 1;
    }
    assert.equal(pares, total);
  }
});

// La prueba que de verdad importa: el número lo decide el motor de dados y se
// comparte por socket al instante. Si el giro dejara arriba otra cara, el dado
// estaría mintiendo sobre la tirada.
test('el dado aterriza mostrando el valor pedido, para todas las caras', () => {
  for (const die of SUPPORTED_DICE) {
    for (let value = 1; value <= CARAS[die]; value += 1) {
      const quaternion = quaternionForValue(die, value);
      assert.equal(faceUp(die, quaternion), value, `el ${die} debe quedarse en ${value}`);
    }
  }
});

test('la normal de la cara pedida acaba apuntando justo al cielo', () => {
  const face = dieFaces('d20').find((candidate) => candidate.value === 17);
  const arriba = face.normal.clone().applyQuaternion(quaternionForValue('d20', 17));
  assert.ok(Math.abs(arriba.x) < 1e-6, `x debería ser 0, es ${arriba.x}`);
  assert.ok(Math.abs(arriba.y - 1) < 1e-6, `y debería ser 1, es ${arriba.y}`);
  assert.ok(Math.abs(arriba.z) < 1e-6, `z debería ser 0, es ${arriba.z}`);
});

test('el giro sobre el eje vertical cambia la pose pero no el número', () => {
  for (const die of SUPPORTED_DICE) {
    for (const spin of [0.4, 1.9, Math.PI, 5.7]) {
      const value = Math.min(7, CARAS[die]);
      const girado = quaternionForValue(die, value, { spin });
      assert.equal(faceUp(die, girado), value, `${die} con giro ${spin} debe seguir en ${value}`);
      assert.notDeepEqual(
        girado.toArray().map((n) => Math.round(n * 1000)),
        quaternionForValue(die, value).toArray().map((n) => Math.round(n * 1000)),
        'un giro real debe cambiar la orientación'
      );
    }
  }
});

test('pedir una cara que no existe rompe en vez de dibujar cualquier cosa', () => {
  assert.throws(() => quaternionForValue('d6', 7), /no tiene cara 7/);
  assert.throws(() => quaternionForValue('d20', 0), /no tiene cara 0/);
});

test('el d100 no tiene cuerpo propio: se representa con dos d10', () => {
  // El dado real de cien caras es un zocaedro, una rareza que casi nadie usa;
  // en la mesa un percentil se tira con dos d10.
  assert.equal(supportsDie('d10'), true);
  assert.equal(supportsDie('d100'), false);
  assert.throws(() => quaternionForValue('d100', 37), /Dado sin geometría física|no tiene cara/);
});

test('las caras son unitarias y su centro sale del cuerpo del dado', () => {
  for (const die of SUPPORTED_DICE) {
    for (const face of dieFaces(die)) {
      assert.ok(Math.abs(face.normal.length() - 1) < 1e-6, `${die}: la normal debe ser unitaria`);
      // El centro de la cara tiene que caer en el mismo lado que su normal, o
      // los números se dibujarían dentro del dado.
      assert.ok(
        face.centroid.dot(face.normal) > 0,
        `${die}: el centro de la cara ${face.value} debe estar en el exterior`
      );
    }
  }
});

test('la geometría se reutiliza en vez de recalcularse en cada tirada', () => {
  assert.equal(dieFaces('d20'), dieFaces('d20'), 'las caras deben venir de la caché');
});

test('three.js compone bien el giro pedido a mano', () => {
  // Comprobación de cordura del propio cálculo: girar la normal de una cara
  // hasta +Y y volver, deja la normal donde estaba.
  const face = dieFaces('d8')[0];
  const quaternion = new THREE.Quaternion().setFromUnitVectors(face.normal, new THREE.Vector3(0, 1, 0));
  const ida = face.normal.clone().applyQuaternion(quaternion);
  const vuelta = ida.applyQuaternion(quaternion.clone().invert());
  assert.ok(vuelta.distanceTo(face.normal) < 1e-6);
});
