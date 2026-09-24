import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ELEV_STEP } from '../domain/elevation.js';
import {
  DENSE_WALL_EDGES,
  buildElevationGeometry,
  buildObstacleGeometry,
  buildWallGeometry,
  chamferBox,
  isDenseBoard,
  normalizeTerrainStyle,
  stonePalette,
  terrainFaceRuns,
  wallRuns,
} from '../lib/structureGeometry.js';

const STYLES = ['construido', 'natural'];
const room = (overrides = {}) => ({ col: 2, row: 3, width: 4, height: 3, ...overrides });
// Perímetro completo de una sala de 4×3
const perimeter = () => {
  const edges = [];
  for (let c = 0; c < 4; c += 1) edges.push([c, 0, 'n'], [c, 2, 's']);
  for (let r = 0; r < 3; r += 1) edges.push([0, r, 'o'], [3, r, 'e']);
  return edges;
};

function assertWellFormed(geometry) {
  const names = Object.keys(geometry.attributes).sort();
  assert.deepEqual(names, ['color', 'normal', 'position', 'uv']);
  const count = geometry.getAttribute('position').count;
  assert.ok(count > 0 && count % 3 === 0, 'triángulos sueltos y completos');
  for (const name of names) {
    for (const value of geometry.getAttribute(name).array) assert.ok(Number.isFinite(value), `${name} finito`);
  }
  for (const value of geometry.getAttribute('color').array) assert.ok(value >= 0 && value <= 1, 'color en rango');
}

const positionsOf = (geometry) => Array.from(geometry.getAttribute('position').array);

test('el estilo desconocido cae en construido y el color no válido en el de serie', () => {
  assert.equal(normalizeTerrainStyle('natural'), 'natural');
  assert.equal(normalizeTerrainStyle('marmol'), 'construido');
  assert.equal(normalizeTerrainStyle(undefined), 'construido');
  assert.deepEqual(stonePalette('rojo'), stonePalette());
  const vivid = stonePalette('#ff0000');
  assert.ok(vivid.g > 0 && vivid.r < 1, 'la piedra se apaga hacia el gris, nunca es un color puro');
});

test('el sillar achaflanado es cerrado y todas sus caras miran hacia fuera', () => {
  const geometry = chamferBox(0.6, 0.2, 0.2, 0.02);
  const positions = geometry.getAttribute('position');
  assert.equal(positions.count, 44 * 3);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    assert.ok(normal.dot(a.clone().add(b).add(c)) > 0);
  }
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.max.x - 0.3) < 1e-6);
  assert.ok(Math.abs(geometry.boundingBox.min.y + 0.1) < 1e-6);
  geometry.dispose();
});

test('las aristas colineales forman un tramo y la puerta abierta lo corta', () => {
  const fixture = room({ wallEdges: [[0, 0, 'n'], [1, 0, 'n'], [2, 0, 'n'], [3, 0, 'n']] });
  const whole = wallRuns(fixture);
  assert.equal(whole.length, 1);
  assert.ok(Math.abs(whole[0].start - (2 - 0.11)) < 1e-9 && Math.abs(whole[0].end - (6 + 0.11)) < 1e-9);
  const split = wallRuns(fixture, new Set(['h:4,3']));
  assert.equal(split.length, 2);
  assert.equal(split[0].end, 4, 'el tramo termina a ras del hueco de la puerta');
  assert.equal(split[1].start, 5);
});

test('los muros de ambos estilos se construyen, son deterministas y no superan la altura de pared', () => {
  for (const style of STYLES) {
    const fixture = room({ wallEdges: perimeter() });
    const geometry = buildWallGeometry(fixture, 1, new Set(), { style, color: '#7a6a52' });
    assertWellFormed(geometry);
    assert.ok(geometry.boundingBox.min.y > -0.05, `${style}: nada se hunde bajo el suelo`);
    assert.ok(geometry.boundingBox.max.y < 1.05, `${style}: la pared no crece por encima de su altura`);
    const again = buildWallGeometry(fixture, 1, new Set(), { style, color: '#7a6a52' });
    assert.deepEqual(positionsOf(again), positionsOf(geometry), `${style}: la misma sala pinta las mismas piedras`);
    geometry.dispose();
    again.dispose();
  }
});

test('un muro sobre una plataforma arranca en su altura', () => {
  const fixture = room({ wallEdges: [[1, 1, 'n']], elevationCells: [[1, 1, 2]] });
  const geometry = buildWallGeometry(fixture, 1);
  assert.ok(Math.abs(geometry.boundingBox.min.y - 2 * ELEV_STEP) < 0.02);
  geometry.dispose();
});

test('el color de pared tiñe la piedra: el material queda en blanco', () => {
  const fixture = room({ wallEdges: [[0, 0, 'n']] });
  const warm = buildWallGeometry(fixture, 1, new Set(), { color: '#b07040' });
  const cold = buildWallGeometry(fixture, 1, new Set(), { color: '#4070b0' });
  const average = (geometry, channel) => {
    const colors = geometry.getAttribute('color');
    let sum = 0;
    for (let i = 0; i < colors.count; i += 1) sum += channel === 'r' ? colors.getX(i) : colors.getZ(i);
    return sum / colors.count;
  };
  assert.ok(average(warm, 'r') > average(cold, 'r'));
  assert.ok(average(warm, 'b') < average(cold, 'b'));
  warm.dispose();
  cold.dispose();
});

test('un tablero enorme usa menos piezas por arista', () => {
  const fixture = room({ wallEdges: perimeter() });
  for (const style of STYLES) {
    const detailed = buildWallGeometry(fixture, 1, new Set(), { style });
    const dense = buildWallGeometry(fixture, 1, new Set(), { style, dense: true });
    assert.ok(dense.getAttribute('position').count < detailed.getAttribute('position').count * 0.75, style);
    detailed.dispose();
    dense.dispose();
  }
  const edges = Array.from({ length: DENSE_WALL_EDGES + 1 }, (_, i) => [i, 0, 'n']);
  assert.equal(isDenseBoard([{ wallEdges: edges.slice(0, DENSE_WALL_EDGES) }]), false);
  assert.equal(isDenseBoard([{ wallEdges: edges.slice(0, 200) }, { wallEdges: edges.slice(200) }]), true);
  assert.equal(isDenseBoard(), false);
});

test('los obstáculos se quedan en su casilla, sobre su suelo y fuera de casillas no válidas', () => {
  const fixture = room({
    obstacleCells: [[0, 0], [0, 0], [3, 2], [1, 1], [9, 9], [2, 0]],
    disabledCells: [[2, 0]],
    elevationCells: [[3, 2, 1], [1, 1, -2]],
  });
  for (const style of STYLES) {
    const geometry = buildObstacleGeometry(fixture, 1, { style });
    assertWellFormed(geometry);
    const positions = geometry.getAttribute('position');
    const cells = new Set();
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const col = Math.floor(x) - fixture.col;
      const row = Math.floor(z) - fixture.row;
      cells.add(`${col},${row}`);
      assert.ok(positions.getY(i) > -0.01, `${style}: el foso no hunde la piedra`);
      if (col === 3 && row === 2) assert.ok(positions.getY(i) > ELEV_STEP - 0.01, `${style}: la piedra apoya en la plataforma`);
    }
    // Una piedra suelta puede asomar un pelo a la casilla vecina, pero nunca
    // aparece nada en la desactivada ni fuera de la sala.
    assert.ok(!cells.has('2,0'), `${style}: nada sobre la casilla desactivada`);
    assert.ok([...cells].every((key) => {
      const [col, row] = key.split(',').map(Number);
      return col >= -1 && row >= -1 && col <= fixture.width && row <= fixture.height;
    }));
    geometry.dispose();
  }
  const columns = buildObstacleGeometry(fixture, 1);
  const rocks = buildObstacleGeometry(fixture, 1, { style: 'natural' });
  assert.ok(columns.boundingBox.max.y > rocks.boundingBox.max.y, 'una columna es más alta que un peñasco');
  columns.dispose();
  rocks.dispose();
});

test('los frentes de un desnivel se agrupan por tramo y altura', () => {
  const fixture = room({ elevationCells: [[0, 0, 1], [1, 0, 1], [2, 0, 1], [1, 1, 2]] });
  const runs = terrainFaceRuns(fixture, 1);
  const northFront = runs.find((run) => run.horizontal && run.sign === -1 && run.at === 3);
  assert.deepEqual([northFront.from, northFront.to, northFront.bottom, northFront.top], [2, 5, 0, ELEV_STEP]);
  // La casilla más alta: un escalón de un nivel hacia la plataforma y tres
  // caídas de dos niveles hasta el suelo.
  const step = runs.filter((run) => run.bottom === ELEV_STEP && run.top === 2 * ELEV_STEP);
  assert.equal(step.length, 1);
  const drops = runs.filter((run) => run.bottom === 0 && run.top === 2 * ELEV_STEP);
  assert.equal(drops.length, 3);
});

test('los desniveles de ambos estilos cubren el corte sin pisar la plataforma', () => {
  const fixture = room({ elevationCells: [[1, 1, 2], [2, 1, 2]] });
  for (const style of STYLES) {
    const geometry = buildElevationGeometry(fixture, 1, { style });
    assertWellFormed(geometry);
    assert.ok(geometry.boundingBox.max.y < 2 * ELEV_STEP + 0.06, `${style}: nada tapa a quien está arriba`);
    assert.ok(geometry.boundingBox.min.y > -0.05, style);
    geometry.dispose();
  }
  const flat = buildElevationGeometry(room({ elevationCells: [[0, 0, -2]] }), 1);
  assert.equal(flat.getAttribute('position'), undefined, 'un foso no levanta paredes');
});
