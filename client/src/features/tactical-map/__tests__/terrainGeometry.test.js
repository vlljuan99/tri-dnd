import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ELEV_STEP } from '../domain/elevation.js';
import { buildTerrainSides, buildTerrainSurface } from '../lib/terrainGeometry.js';

const room = (overrides = {}) => ({ col: 3, row: 5, width: 2, height: 1, ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} ≈ ${expected}`);

function assertFaceOrientation(geometry) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const indices = geometry.getIndex();
  for (let index = 0; index < indices.count; index += 3) {
    const a = new Vector3().fromBufferAttribute(positions, indices.getX(index));
    const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1));
    const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2));
    const normal = new Vector3().fromBufferAttribute(normals, indices.getX(index));
    assert.ok(b.sub(a).cross(c.sub(a)).dot(normal) > 0, 'el orden de vértices sigue la normal exterior');
  }
}

test('el suelo respeta el apoyo de cornisas y fosos y mantiene las UV de la imagen', () => {
  const geometry = buildTerrainSurface(room({ elevationCells: [[0, 0, 3], [1, 0, -2]] }), 2);
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  for (let index = 0; index < 4; index += 1) close(positions.getY(index), 3 * ELEV_STEP);
  for (let index = 4; index < 8; index += 1) close(positions.getY(index), 0);
  assert.deepEqual(Array.from(geometry.getAttribute('uv').array), [0, 1, 0.5, 1, 0.5, 0, 0, 0, 0.5, 1, 1, 1, 1, 0, 0.5, 0]);
  close(colors.getX(0), 1);
  assert.ok(colors.getX(4) < 0.6, 'el foso sigue siendo legible como depresión');
  assertFaceOrientation(geometry);
  geometry.dispose();
});

test('la textura de piedra conserva escala y coordenadas entre casillas elevadas', () => {
  const geometry = buildTerrainSurface(room({ elevationCells: [[1, 0, 2]] }), 2, true);
  const uv = geometry.getAttribute('uv');
  close(uv.getX(0), 3 / 4);
  close(uv.getY(0), -5 / 4);
  close(uv.getX(1), uv.getX(4));
  close(uv.getY(1), uv.getY(4));
  geometry.dispose();
});

test('las casillas desactivadas no generan superficie ni elevaciones fantasma', () => {
  const fixture = room({ disabledCells: [[1, 0]], elevationCells: [[0, 0, 1], [1, 0, 4]] });
  const surface = buildTerrainSurface(fixture, 1);
  const sides = buildTerrainSides(fixture, 1);
  assert.equal(surface.getAttribute('position').count, 4);
  assert.equal(sides.getAttribute('position').count, 16, 'la cornisa limita con el vacío de la casilla desactivada');
  close(sides.boundingBox.max.y, ELEV_STEP);
  assertFaceOrientation(sides);
  surface.dispose();
  sides.dispose();
});

test('una plataforma continua omite la cara compartida entre dos casillas iguales', () => {
  const geometry = buildTerrainSides(room({ elevationCells: [[0, 0, 2], [1, 0, 2]] }), 1);
  assert.equal(geometry.getAttribute('position').count, 24, 'seis caras exteriores, ninguna interior');
  assert.equal(geometry.getIndex().count, 36);
  assertFaceOrientation(geometry);
  geometry.dispose();
});

test('el desnivel solo cubre la diferencia entre plataformas y lleva UV a escala de mundo', () => {
  const geometry = buildTerrainSides(room({ elevationCells: [[0, 0, 1], [1, 0, 3]] }), 2);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const shared = [];
  for (let index = 0; index < positions.count; index += 1) {
    if (positions.getX(index) === 8 && normals.getX(index) === -1) shared.push(index);
    close(uv.getY(index), positions.getY(index) / 2);
  }
  assert.equal(positions.count, 28, 'seis caras exteriores y un frente de escalón');
  assert.equal(shared.length, 4);
  close(Math.min(...shared.map((index) => positions.getY(index))), ELEV_STEP);
  close(Math.max(...shared.map((index) => positions.getY(index))), 3 * ELEV_STEP);
  assertFaceOrientation(geometry);
  geometry.dispose();
});

test('el terreno llano y los fosos no fabrican paredes por encima del apoyo', () => {
  const geometry = buildTerrainSides(room({ elevationCells: [[1, 0, -3]] }), 1);
  assert.equal(geometry.getAttribute('position').count, 0);
  assert.equal(geometry.getIndex().count, 0);
  geometry.dispose();
});

test('la geometría no modifica las capas y resuelve duplicados con la altura más alta', () => {
  const fixture = room({ elevationCells: [[0, 0, 3], [0, 0, 1]] });
  const before = structuredClone(fixture);
  const geometry = buildTerrainSurface(fixture, 1);
  close(geometry.getAttribute('position').getY(0), 3 * ELEV_STEP);
  assert.deepEqual(fixture, before);
  geometry.dispose();
});
