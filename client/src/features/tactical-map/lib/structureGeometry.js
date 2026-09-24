import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellKey } from '../domain/cells.js';
import { ELEV_STEP } from '../domain/elevation.js';
import { buildTerrainSides, exposedTerrainSides } from './terrainGeometry.js';

// Sólo representación: estas mallas nunca intervienen en paso, visión o tiradas.
// La semilla depende de la posición, así que mover la cámara o recibir un
// evento de socket no cambia las piedras que está mirando el jugador.
//
// Dos estilos, a elección del DM por mapa (`terrainStyle`, cosmético):
// - 'construido': sillería de hiladas irregulares, columnas y muros de
//   contención; lo que se espera en una cripta, una fortaleza o una fundición.
// - 'natural': muro de piedra seca, peñascos con estratos y riscos; lo que se
//   espera en un desfiladero o un bosque.

export const TERRAIN_STYLES = ['construido', 'natural'];
export const DEFAULT_WALL_COLOR = '#9b8555';
const ROCK_COLOR = '#7d7568';

export function normalizeTerrainStyle(style) {
  return style === 'natural' ? 'natural' : 'construido';
}

export function noise(x, y, z = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

const smooth = (t) => t * t * (3 - 2 * t);

// Ruido de valor continuo: el relieve de una roca no tiene saltos.
function valueNoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const w = smooth(z - zi);
  const corner = (dx, dy, dz) => noise(xi + dx, yi + dy, zi + dz);
  const lerp = THREE.MathUtils.lerp;
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), u);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), u);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), u);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

export function fbm(x, y, z, octaves = 4) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, z * frequency);
    norm += amplitude;
    frequency *= 2.07;
    amplitude *= 0.5;
  }
  return sum / norm;
}

// El color que elige el DM se respeta, pero la piedra real nunca es un color
// plano: se apaga un poco hacia el gris y cada pieza varía de tono.
export function stonePalette(hex = DEFAULT_WALL_COLOR) {
  const base = new THREE.Color(DEFAULT_WALL_COLOR);
  if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) base.set(hex);
  const luminance = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
  return base.lerp(new THREE.Color(luminance, luminance, luminance), 0.38);
}

function variedColor(base, seed, spread = 0.18) {
  const value = 1 - spread / 2 + seed * spread;
  const warmth = (noise(seed * 13.7, 3.1) - 0.5) * 0.06;
  return new THREE.Color(
    Math.min(1, base.r * value * (1 + warmth)),
    Math.min(1, base.g * value),
    Math.min(1, base.b * value * (1 - warmth))
  );
}

// Los fosos dejan la superficie de apoyo en cero: nada se hunde bajo el suelo.
function groundLevels(room) {
  const levels = new Map();
  for (const [c, r, level] of room.elevationCells ?? []) {
    const key = cellKey(c, r);
    levels.set(key, Math.max(levels.get(key) ?? 0, Math.trunc(Number(level) || 0)));
  }
  return levels;
}

export function wallEdgeKey(room, c, r, side) {
  const x = room.col + c;
  const z = room.row + r;
  if (side === 'n') return `h:${x},${z}`;
  if (side === 's') return `h:${x},${z + 1}`;
  if (side === 'o') return `v:${x},${z}`;
  return `v:${x + 1},${z}`;
}

const cornerA = new THREE.Vector3();
const cornerB = new THREE.Vector3();
const cornerC = new THREE.Vector3();
const edgeA = new THREE.Vector3();
const edgeB = new THREE.Vector3();

// Proyección por triángulo en coordenadas de mundo: la veta no se estira al
// alargar un muro ni al escalar una roca, y ningún triángulo mezcla dos
// proyecciones (lo que dejaría rayas en los cantos redondeados). El color de
// vértice lleva el tono de la pieza, la suciedad del pie, el polvo de las
// caras que miran al cielo y, si la pieza lo trae, la sombra de sus grietas.
function dressGeometry(source, gridSize, color, { footY = null, grime = 0.3, dust = 0.06 } = {}) {
  if (!source.getAttribute('normal')) source.computeVertexNormals();
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const crevice = geometry.getAttribute('crevice');
  const uvs = new Float32Array(positions.count * 2);
  const colors = new Float32Array(positions.count * 3);
  const corners = [cornerA, cornerB, cornerC];
  for (let i = 0; i + 2 < positions.count; i += 3) {
    cornerA.fromBufferAttribute(positions, i);
    cornerB.fromBufferAttribute(positions, i + 1);
    cornerC.fromBufferAttribute(positions, i + 2);
    edgeA.subVectors(cornerC, cornerB).cross(edgeB.subVectors(cornerA, cornerB));
    const ax = Math.abs(edgeA.x);
    const ay = Math.abs(edgeA.y);
    const az = Math.abs(edgeA.z);
    for (let k = 0; k < 3; k += 1) {
      const point = corners[k];
      const index = i + k;
      const flat = ay >= ax && ay >= az;
      uvs[index * 2] = (flat ? point.x : ax >= az ? point.z : point.x) / gridSize;
      uvs[index * 2 + 1] = (flat ? -point.z : point.y) / gridSize;
      const rise = footY === null ? 1 : THREE.MathUtils.clamp((point.y - footY) / 0.32, 0, 1);
      const contact = 1 - grime * (1 - rise);
      const sky = normals.getY(index) > 0.6 ? 1 + dust : 1;
      const crack = crevice ? crevice.getX(index) : 1;
      const shade = contact * sky * crack;
      colors[index * 3] = Math.min(1, color.r * shade);
      colors[index * 3 + 1] = Math.min(1, color.g * shade);
      colors[index * 3 + 2] = Math.min(1, color.b * shade * 0.98);
    }
  }
  if (crevice) geometry.deleteAttribute('crevice');
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function finish(parts) {
  if (!parts.length) return new THREE.BufferGeometry();
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// Une aristas colineales antes de construir hiladas. En los cruces, el tramo
// vertical ocupa la esquina y el horizontal termina contra su cara: no hay
// dos tapas superpuestas parpadeando al orbitar la cámara.
export function wallRuns(room, doorEdges = new Set()) {
  const levels = groundLevels(room);
  const edges = new Map();
  for (const [c, r, side] of room.wallEdges ?? []) {
    const key = wallEdgeKey(room, c, r, side);
    if (doorEdges.has(key) || edges.has(key)) continue;
    const horizontal = side === 'n' || side === 's';
    const x = room.col + c + (side === 'e' ? 1 : 0);
    const z = room.row + r + (side === 's' ? 1 : 0);
    const dc = side === 'e' ? 1 : side === 'o' ? -1 : 0;
    const dr = side === 's' ? 1 : side === 'n' ? -1 : 0;
    const base = Math.max(0, levels.get(cellKey(c, r)) ?? 0, levels.get(cellKey(c + dc, r + dr)) ?? 0) * ELEV_STEP;
    edges.set(key, { horizontal, line: horizontal ? z : x, start: horizontal ? x : z, base });
  }
  const joints = new Set();
  for (const edge of edges.values()) {
    if (!edge.horizontal) {
      joints.add(cellKey(edge.line, edge.start));
      joints.add(cellKey(edge.line, edge.start + 1));
    }
  }
  const sorted = [...edges.values()].sort((a, b) => Number(a.horizontal) - Number(b.horizontal)
    || a.line - b.line || a.base - b.base || a.start - b.start);
  const runs = [];
  for (const edge of sorted) {
    const last = runs.at(-1);
    const joint = edge.horizontal && joints.has(cellKey(edge.start, edge.line));
    if (last && last.horizontal === edge.horizontal && last.line === edge.line
      && last.base === edge.base && last.end === edge.start && !joint) {
      last.end += 1;
    } else {
      runs.push({ ...edge, end: edge.start + 1 });
    }
  }
  return runs.map((run) => {
    const prefix = run.horizontal ? 'h' : 'v';
    const keyAt = (at) => run.horizontal ? `${prefix}:${at},${run.line}` : `${prefix}:${run.line},${at}`;
    const startJoint = run.horizontal && joints.has(cellKey(run.start, run.line));
    const endJoint = run.horizontal && joints.has(cellKey(run.end, run.line));
    return {
      ...run,
      start: run.start + (startJoint ? 0.11 : doorEdges.has(keyAt(run.start - 1)) ? 0 : -0.11),
      end: run.end + (endJoint ? -0.11 : doorEdges.has(keyAt(run.end)) ? 0 : 0.11),
    };
  });
}

// Una hilera (tramo de muro o frente de desnivel) sobre la que se apoyan las
// piezas: `along` recorre la hilera, `out` se separa de su plano hacia `sign`.
function placeOnLine(geometry, line, { along, y, out = 0, yaw = 0 }) {
  if (yaw) geometry.rotateY(yaw);
  const offset = out * (line.sign ?? 1);
  if (line.horizontal) geometry.translate(along, y, line.at + offset);
  else geometry.translate(line.at + offset, y, along);
  return geometry;
}

function piece(geometry, line, { length, height, depth, ...placement }) {
  geometry.scale(line.horizontal ? length : depth, height, line.horizontal ? depth : length);
  return placeOnLine(geometry, line, placement);
}

// Sillar con los cantos achaflanados a medida: el bisel es igual en todas las
// aristas aunque la pieza sea larga y baja, y cuesta 44 triángulos (una caja
// redondeada escalada cuesta más del doble y deforma el canto).
export function chamferBox(width, height, depth, bevel) {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const b = Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45);
  const point = (i, j, k, axis) => new THREE.Vector3(
    i * (axis === 0 ? hx : hx - b),
    j * (axis === 1 ? hy : hy - b),
    k * (axis === 2 ? hz : hz - b)
  );
  const triangles = [];
  const quad = (p, q, r, s) => triangles.push([p, q, r], [p, r, s]);
  const signs = [-1, 1];
  for (const s of signs) {
    quad(point(s, -1, -1, 0), point(s, 1, -1, 0), point(s, 1, 1, 0), point(s, -1, 1, 0));
    quad(point(-1, s, -1, 1), point(1, s, -1, 1), point(1, s, 1, 1), point(-1, s, 1, 1));
    quad(point(-1, -1, s, 2), point(1, -1, s, 2), point(1, 1, s, 2), point(-1, 1, s, 2));
  }
  for (const u of signs) {
    for (const v of signs) {
      quad(point(-1, u, v, 1), point(1, u, v, 1), point(1, u, v, 2), point(-1, u, v, 2));
      quad(point(u, -1, v, 0), point(u, 1, v, 0), point(u, 1, v, 2), point(u, -1, v, 2));
      quad(point(u, v, -1, 0), point(u, v, 1, 0), point(u, v, 1, 1), point(u, v, -1, 1));
      for (const w of signs) triangles.push([point(u, v, w, 0), point(u, v, w, 1), point(u, v, w, 2)]);
    }
  }
  const positions = [];
  const normal = new THREE.Vector3();
  const other = new THREE.Vector3();
  for (const [p, q, r] of triangles) {
    // Caja convexa centrada: cada cara mira hacia fuera si su normal se aleja
    // del centro.
    normal.subVectors(q, p).cross(other.subVectors(r, p));
    const outward = normal.dot(other.copy(p).add(q).add(r)) > 0;
    for (const corner of outward ? [p, q, r] : [p, r, q]) positions.push(corner.x, corner.y, corner.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function boxPiece(line, { length, height, depth, bevel, ...placement }) {
  const geometry = line.horizontal
    ? chamferBox(length, height, depth, bevel)
    : chamferBox(depth, height, length, bevel);
  return placeOnLine(geometry, line, placement);
}

// Mampuesto: el mismo sillar con un bisel ancho y cada esquina desplazada por
// ruido. Queda una piedra de cantera de caras planas y aristas vivas, que es
// lo que se ve en un muro de piedra seca o en los estratos de un risco. Los
// vértices repetidos se mueven igual porque el ruido depende de su posición.
function rubblePiece(line, { length, height, depth, seed, rough = 0.16, ...placement }) {
  const width = line.horizontal ? length : depth;
  const deep = line.horizontal ? depth : length;
  const geometry = chamferBox(width, height, deep, Math.min(width, height, deep) * 0.3);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const px = positions.getX(i);
    const py = positions.getY(i);
    const pz = positions.getZ(i);
    const u = px / width;
    const v = py / height;
    const w = pz / deep;
    positions.setXYZ(i,
      px + (noise(u * 7.1 + seed, v * 3.3, w * 5.7) - 0.5) * rough * width,
      py + (noise(u * 4.3, v * 6.1 + seed, w * 2.9) - 0.5) * rough * height,
      pz + (noise(u * 2.7, v * 5.3, w * 6.7 + seed) - 0.5) * rough * deep);
  }
  geometry.computeVertexNormals();
  return placeOnLine(geometry, line, placement);
}

// Tableros muy grandes (mapas importados con cientos de aristas de muro) usan
// piezas más largas y menos hiladas: el aspecto se mantiene a la distancia a
// la que se ve un mapa así y la geometría no se dispara.
export const DENSE_WALL_EDGES = 240;

export function isDenseBoard(rooms = []) {
  let edges = 0;
  for (const room of rooms) edges += room.wallEdges?.length ?? 0;
  return edges > DENSE_WALL_EDGES;
}

// Piedra irregular: icosaedro deformado con ruido y aplanado arriba y abajo,
// para que asiente y reciba la hilada siguiente. Vértices compartidos para que
// el sombreado sea suave; el ruido pone la irregularidad, no las facetas.
function roughStone(seed, detail = 1, roughness = 0.2, flatten = 0.75) {
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geometry = mergeVertices(base);
  base.dispose();
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const px = positions.getX(i);
    const py = positions.getY(i);
    const pz = positions.getZ(i);
    const bump = 1 - roughness / 2 + fbm(px * 1.7 + seed * 11, py * 1.7, pz * 1.7 + seed * 5, 3) * roughness;
    positions.setXYZ(i, px * bump, THREE.MathUtils.clamp(py * bump, -flatten, flatten), pz * bump);
  }
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.computeVertexNormals();
  return geometry;
}

// Sillería: núcleo de mortero y cuatro hiladas de sillares de largo variable,
// cada uno con su leve desplome, su tono y el canto gastado; remata una
// albardilla. Los extremos libres los cubre la piedra, no el mortero.
function builtWall(run, gridSize, palette, dense, parts) {
  const line = { horizontal: run.horizontal, at: run.line * gridSize };
  const start = run.start * gridSize;
  const end = run.end * gridSize;
  const inset = gridSize * 0.03;
  parts.push(dressGeometry(boxPiece(line, {
    length: end - start - inset * 2, height: 0.9, depth: gridSize * 0.16, bevel: 0.004,
    along: (start + end) / 2, y: run.base + 0.46,
  }), gridSize, palette.clone().multiplyScalar(0.34), { footY: run.base }));

  const courses = dense ? 2 : 4;
  const stretch = dense ? 1.7 : 1;
  const courseHeight = 0.9 / courses;
  for (let course = 0; course < courses; course += 1) {
    let cursor = start;
    let index = 0;
    // Cada hilada arranca con una pieza de largo distinto: las llagas nunca
    // se alinean entre hiladas.
    const firstLength = gridSize * stretch * (0.25 + noise(run.line, course, start) * 0.4);
    while (cursor < end - 0.001) {
      const seed = noise(cursor * 3.1, run.line * 1.7 + course, index);
      const length = index === 0 ? firstLength : gridSize * stretch * (0.42 + seed * 0.42);
      let next = Math.min(end, cursor + length);
      if (end - next < gridSize * 0.2 * stretch) next = end;
      const a = cursor + (cursor === start ? 0 : gridSize * 0.009);
      const b = next - (next === end ? 0 : gridSize * 0.009);
      const height = courseHeight - 0.016 - seed * 0.012;
      parts.push(dressGeometry(boxPiece(line, {
        length: b - a,
        height,
        depth: gridSize * (0.2 + (noise(seed, course) - 0.5) * 0.022),
        bevel: 0.018,
        along: (a + b) / 2,
        y: run.base + course * courseHeight + 0.012 + height / 2 + (noise(seed, 7) - 0.5) * 0.008,
        out: (noise(seed, 11) - 0.5) * gridSize * 0.012,
        yaw: (noise(seed, 13) - 0.5) * 0.03,
      }), gridSize, variedColor(palette, noise(seed, 17), 0.3), { footY: run.base }));
      cursor = next;
      index += 1;
    }
  }
  // Albardilla: losas algo más anchas que el muro, con su propio tono
  const count = Math.max(1, Math.round((end - start) / (gridSize * 0.75 * stretch)));
  for (let i = 0; i < count; i += 1) {
    const a = start + ((end - start) * i) / count;
    const b = start + ((end - start) * (i + 1)) / count;
    const seed = noise(a, run.line, 21);
    parts.push(dressGeometry(boxPiece(line, {
      length: b - a - gridSize * 0.008, height: 0.085, depth: gridSize * 0.235, bevel: 0.016,
      along: (a + b) / 2, y: run.base + 0.9475, yaw: (seed - 0.5) * 0.02,
    }), gridSize, variedColor(palette.clone().multiplyScalar(1.08), seed, 0.18), { footY: run.base, dust: 0.1 }));
  }
}

// Piedra seca: mampuestos de cantera sin mortero visible, hiladas de alto
// decreciente y un remate de piedras puestas de canto, como los muros de campo.
function naturalWall(run, gridSize, palette, dense, parts) {
  const line = { horizontal: run.horizontal, at: run.line * gridSize };
  const start = run.start * gridSize;
  const end = run.end * gridSize;
  parts.push(dressGeometry(boxPiece(line, {
    length: end - start - gridSize * 0.06, height: 0.78, depth: gridSize * 0.15, bevel: 0.004,
    along: (start + end) / 2, y: run.base + 0.4,
  }), gridSize, palette.clone().multiplyScalar(0.2), { footY: run.base }));
  let y = run.base + 0.005;
  const courseHeights = dense ? [0.42, 0.36] : [0.3, 0.26, 0.22];
  const stretch = dense ? 1.5 : 1;
  for (const [course, courseHeight] of courseHeights.entries()) {
    let cursor = start + (noise(run.line, course, start) - 0.5) * gridSize * 0.2;
    let index = 0;
    while (cursor < end - gridSize * 0.04) {
      const seed = noise(cursor * 2.3, run.line + course * 3.7, index + 31);
      const length = gridSize * stretch * (0.3 + seed * 0.3);
      const a = Math.max(start, cursor);
      const b = Math.min(end, cursor + length);
      parts.push(dressGeometry(rubblePiece(line, {
        length: b - a,
        height: courseHeight * (0.86 + noise(seed, 2) * 0.2),
        depth: gridSize * (0.21 + noise(seed, 4) * 0.04),
        seed: seed * 17,
        along: (a + b) / 2,
        y: y + courseHeight / 2,
        out: (noise(seed, 5) - 0.5) * gridSize * 0.035,
        yaw: (noise(seed, 9) - 0.5) * 0.12,
      }), gridSize, variedColor(palette, noise(seed, 19), 0.4), { footY: run.base, grime: 0.4 }));
      cursor += length * 0.98;
      index += 1;
    }
    y += courseHeight;
  }
  if (dense) return;
  let cursor = start;
  let index = 0;
  while (cursor < end - gridSize * 0.04) {
    const seed = noise(cursor * 4.1, run.line, index + 53);
    const width = gridSize * (0.16 + seed * 0.1);
    const height = 0.15 + noise(seed, 2) * 0.05;
    parts.push(dressGeometry(rubblePiece(line, {
      length: Math.min(width, end - cursor),
      height,
      depth: gridSize * 0.24,
      seed: seed * 29,
      rough: 0.22,
      along: cursor + Math.min(width, end - cursor) / 2,
      y: y - 0.015 + height / 2,
      yaw: (noise(seed, 3) - 0.5) * 0.14,
    }), gridSize, variedColor(palette.clone().multiplyScalar(0.96), noise(seed, 23), 0.34), { footY: run.base, dust: 0.1 }));
    cursor += width * 1.03;
    index += 1;
  }
}

export function buildWallGeometry(room, gridSize, doorEdges = new Set(), { style, color, dense = false } = {}) {
  const parts = [];
  const palette = stonePalette(color);
  const natural = normalizeTerrainStyle(style) === 'natural';
  for (const run of wallRuns(room, doorEdges)) {
    if (natural) naturalWall(run, gridSize, palette, dense, parts);
    else builtWall(run, gridSize, palette, dense, parts);
  }
  return finish(parts);
}

// Peñasco: icosaedro fino deformado por ruido fractal y cortado por unos
// cuantos planos de fractura, con base aplanada. Los vértices hundidos quedan
// más oscuros (grietas).
function boulder(seed, { width, depth, height }, gridSize, detail) {
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geometry = mergeVertices(base);
  base.dispose();
  const positions = geometry.getAttribute('position');
  const crevice = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i += 1) {
    const px = positions.getX(i);
    const py = positions.getY(i);
    const pz = positions.getZ(i);
    const field = fbm(px * 1.6 + seed * 7.3, py * 1.6 + seed * 1.9, pz * 1.6 + seed * 3.1, 4);
    const strata = Math.sin(py * 9 + field * 4) * 0.035;
    const scale = 0.72 + field * 0.5 + strata;
    crevice[i] = 0.7 + THREE.MathUtils.clamp((field - 0.32) * 2.2, 0, 1) * 0.34;
    positions.setXYZ(i, px * scale, py * scale, pz * scale);
  }
  const point = new THREE.Vector3();
  const plane = new THREE.Vector3();
  for (let cut = 0; cut < 4; cut += 1) {
    const theta = noise(seed, cut, 1) * Math.PI * 2;
    const phi = (noise(seed, cut, 2) - 0.25) * Math.PI * 0.55;
    plane.set(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta));
    const distance = 0.62 + noise(seed, cut, 3) * 0.22;
    for (let i = 0; i < positions.count; i += 1) {
      point.fromBufferAttribute(positions, i);
      const beyond = point.dot(plane) - distance;
      if (beyond > 0) point.addScaledVector(plane, -beyond * 0.92);
      positions.setXYZ(i, point.x, Math.max(-0.42, point.y), point.z);
    }
  }
  geometry.setAttribute('crevice', new THREE.BufferAttribute(crevice, 1));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -bounds.min.y, -center.z);
  geometry.scale((width * gridSize) / size.x, height / size.y, (depth * gridSize) / size.z);
  geometry.rotateY(seed * Math.PI * 2);
  geometry.computeVertexNormals();
  return geometry;
}

function naturalObstacle(x, z, base, gridSize, palette, parts) {
  const seed = noise(x, z);
  const rocks = [{ dx: (noise(x, z, 5) - 0.5) * 0.08, dz: (noise(x, z, 6) - 0.5) * 0.08,
    width: 0.66 + seed * 0.12, depth: 0.6 + noise(x, z, 7) * 0.12, height: 0.44 + seed * 0.26, detail: 2 }];
  // Piedras sueltas alrededor, en ángulos y tamaños distintos por casilla
  for (let n = 0; n < 2; n += 1) {
    const angle = noise(x, z, 11 + n) * Math.PI * 2 + n * 2.4;
    const distance = 0.27 + noise(x, z, 13 + n) * 0.05;
    const size = 0.14 + noise(x, z, 15 + n) * 0.12;
    rocks.push({ dx: Math.cos(angle) * distance, dz: Math.sin(angle) * distance,
      width: size * 1.3, depth: size * 1.1, height: size * (0.7 + noise(x, z, 17 + n) * 0.4), detail: 1 });
  }
  rocks.forEach((rock, n) => {
    const geometry = boulder(noise(x, z, n + 3) * 10 + n, rock, gridSize, rock.detail);
    geometry.translate((x + 0.5 + rock.dx) * gridSize, base, (z + 0.5 + rock.dz) * gridSize);
    parts.push(dressGeometry(geometry, gridSize, variedColor(palette, noise(x, z, n + 40), 0.24),
      { footY: base, grime: 0.45, dust: 0.12 }));
  });
}

// Columna: plinto, basa, fuste con leve éntasis y desgaste, equino y ábaco.
// Una de cada cuatro (según la casilla) está rota, con cascotes al pie.
function builtObstacle(x, z, base, gridSize, palette, parts) {
  const seed = noise(x, z);
  const broken = noise(x, z, 9) < 0.25;
  const cx = (x + 0.5) * gridSize;
  const cz = (z + 0.5) * gridSize;
  const tone = (value, shade = 1) => variedColor(palette.clone().multiplyScalar(shade), value, 0.16);
  const add = (geometry, color, options) => parts.push(dressGeometry(geometry, gridSize, color, { footY: base, ...options }));

  const plinth = chamferBox(gridSize * 0.78, 0.14, gridSize * 0.78, 0.02);
  plinth.translate(cx, base + 0.07, cz);
  add(plinth, tone(noise(seed, 1), 0.92), { grime: 0.4 });

  const torus = new THREE.CylinderGeometry(gridSize * 0.3, gridSize * 0.33, 0.07, 18, 1);
  torus.translate(cx, base + 0.175, cz);
  add(torus, tone(noise(seed, 2), 1.02));

  const shaftHeight = broken ? 0.34 + noise(x, z, 4) * 0.3 : 0.8;
  const shaft = new THREE.CylinderGeometry(gridSize * 0.235, gridSize * 0.265, shaftHeight, 18, 4, !broken);
  const positions = shaft.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const px = positions.getX(i);
    const py = positions.getY(i);
    const pz = positions.getZ(i);
    const angle = Math.atan2(pz, px);
    // Estrías muy suaves y desgaste irregular del canto
    const flute = 1 - Math.pow(Math.abs(Math.sin(angle * 8)), 6) * 0.03;
    const wear = 1 - fbm(px * 6 + seed * 9, py * 3, pz * 6, 3) * 0.05;
    const top = broken && py > shaftHeight / 2 - 0.001 ? py - fbm(px * 5 + seed, 0, pz * 5, 2) * 0.16 : py;
    positions.setXYZ(i, px * flute * wear, top, pz * flute * wear);
  }
  shaft.computeVertexNormals();
  shaft.translate(cx, base + 0.21 + shaftHeight / 2, cz);
  add(shaft, tone(noise(seed, 3)), { grime: 0.35 });

  if (!broken) {
    const echinus = new THREE.CylinderGeometry(gridSize * 0.29, gridSize * 0.235, 0.08, 18, 1, true);
    echinus.translate(cx, base + 0.21 + shaftHeight + 0.04, cz);
    add(echinus, tone(noise(seed, 5), 1.04));
    const abacus = chamferBox(gridSize * 0.6, 0.08, gridSize * 0.6, 0.014);
    abacus.translate(cx, base + 0.21 + shaftHeight + 0.12, cz);
    add(abacus, tone(noise(seed, 6), 1.06), { dust: 0.12 });
    return;
  }
  // Cascotes del trozo caído, sin salir de la casilla
  for (let n = 0; n < 3; n += 1) {
    const size = 0.07 + noise(x, z, 33 + n) * 0.07;
    const chunk = roughStone(noise(x, z, 30 + n) * 50, 1, 0.3);
    chunk.scale(gridSize * size * 1.4, size, gridSize * size);
    const angle = noise(x, z, 36 + n) * Math.PI * 2;
    chunk.rotateY(angle);
    chunk.translate(cx + Math.cos(angle) * gridSize * 0.33, base + size / 2, cz + Math.sin(angle) * gridSize * 0.33);
    add(chunk, tone(noise(x, z, 39 + n), 0.95));
  }
}

export function buildObstacleGeometry(room, gridSize, { style, color } = {}) {
  const parts = [];
  const levels = groundLevels(room);
  const disabled = new Set((room.disabledCells ?? []).map(([c, r]) => cellKey(c, r)));
  const natural = normalizeTerrainStyle(style) === 'natural';
  // Las rocas tienen su propio tono mineral; las columnas son de la misma
  // piedra que los muros del mapa.
  const palette = natural ? stonePalette(ROCK_COLOR) : stonePalette(color).multiplyScalar(1.05);
  const seen = new Set();
  for (const [c, r] of room.obstacleCells ?? []) {
    const key = cellKey(c, r);
    if (disabled.has(key) || seen.has(key) || c < 0 || r < 0 || c >= room.width || r >= room.height) continue;
    seen.add(key);
    const x = room.col + c;
    const z = room.row + r;
    const base = (levels.get(key) ?? 0) * ELEV_STEP;
    if (natural) naturalObstacle(x, z, base, gridSize, palette, parts);
    else builtObstacle(x, z, base, gridSize, palette, parts);
  }
  return finish(parts);
}

// Frentes contiguos del mismo desnivel: la sillería y los estratos siguen de
// una casilla a la siguiente en vez de reiniciarse en cada borde.
export function terrainFaceRuns(room, gridSize) {
  const items = exposedTerrainSides(room, gridSize).map((face) => {
    const horizontal = face.axis === 0;
    const a = horizontal ? face.start[0] : face.start[1];
    const b = horizontal ? face.end[0] : face.end[1];
    return {
      horizontal,
      sign: horizontal ? face.normal[2] : face.normal[0],
      at: horizontal ? face.start[1] : face.start[0],
      from: Math.min(a, b),
      to: Math.max(a, b),
      bottom: face.bottom,
      top: face.top,
    };
  });
  items.sort((p, q) => Number(p.horizontal) - Number(q.horizontal) || p.sign - q.sign || p.at - q.at
    || p.bottom - q.bottom || p.top - q.top || p.from - q.from);
  const runs = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last && last.horizontal === item.horizontal && last.sign === item.sign && last.at === item.at
      && last.bottom === item.bottom && last.top === item.top && Math.abs(last.to - item.from) < 1e-6) {
      last.to = item.to;
    } else {
      runs.push({ ...item });
    }
  }
  return runs;
}

// Muro de contención: hiladas de sillares apoyadas delante del corte y una
// cornisa que remata el borde de la plataforma.
function builtFacing(run, gridSize, palette, parts) {
  const height = run.top - run.bottom;
  const courses = Math.max(1, Math.round(height / 0.2));
  const courseHeight = height / courses;
  const depth = gridSize * 0.07;
  const reach = gridSize * 0.025;
  const from = run.from - reach;
  const to = run.to + reach;
  for (let course = 0; course < courses; course += 1) {
    let cursor = from;
    let index = 0;
    const firstLength = gridSize * (0.2 + noise(run.at, course + run.bottom * 7, run.from) * 0.35);
    while (cursor < to - 0.001) {
      const seed = noise(cursor * 3.3, run.at * 1.9 + course, index + run.bottom * 5);
      const length = index === 0 ? firstLength : gridSize * (0.38 + seed * 0.4);
      let next = Math.min(to, cursor + length);
      if (to - next < gridSize * 0.18) next = to;
      const a = cursor + (cursor === from ? 0 : gridSize * 0.008);
      const b = next - (next === to ? 0 : gridSize * 0.008);
      const blockHeight = courseHeight - 0.014;
      parts.push(dressGeometry(boxPiece(run, {
        length: b - a,
        height: blockHeight,
        depth,
        bevel: 0.014,
        along: (a + b) / 2,
        y: run.bottom + course * courseHeight + 0.007 + blockHeight / 2,
        out: reach - depth / 2 + (noise(seed, 3) - 0.5) * gridSize * 0.008,
      }), gridSize, variedColor(palette, noise(seed, 29), 0.28), { footY: run.bottom, grime: 0.35 }));
      cursor = next;
      index += 1;
    }
  }
  const count = Math.max(1, Math.round((to - from) / (gridSize * 0.7)));
  for (let i = 0; i < count; i += 1) {
    const a = from + ((to - from) * i) / count;
    const b = from + ((to - from) * (i + 1)) / count;
    const seed = noise(a, run.at, 41);
    parts.push(dressGeometry(boxPiece(run, {
      length: b - a - gridSize * 0.008,
      height: 0.05,
      depth: gridSize * 0.1,
      bevel: 0.012,
      along: (a + b) / 2,
      y: run.top - 0.012 + seed * 0.004,
      out: reach + gridSize * 0.01 - gridSize * 0.05,
    }), gridSize, variedColor(palette.clone().multiplyScalar(1.08), seed, 0.18), { dust: 0.1 }));
  }
}

// Risco: estratos de roca, lajas anchas y bajas que se adelantan o se
// retraen por capas, y algo de pedregal al pie.
function naturalFacing(run, gridSize, palette, parts) {
  const height = run.top - run.bottom;
  const rows = Math.max(2, Math.round(height / 0.2));
  const rowHeight = height / rows;
  for (let row = 0; row < rows; row += 1) {
    // Cada estrato tiene su propio vuelo: unos sobresalen y otros se hunden
    const ledge = (noise(run.at, row + run.bottom * 3, 17) - 0.5) * gridSize * 0.05;
    let cursor = run.from - gridSize * 0.03 + noise(run.at, row, run.bottom) * gridSize * 0.12;
    let index = 0;
    while (cursor < run.to + gridSize * 0.02) {
      const seed = noise(cursor * 2.9, run.at * 1.3 + row, index + run.bottom * 11);
      const length = gridSize * (0.22 + seed * 0.26);
      const a = Math.max(run.from - gridSize * 0.03, cursor);
      const b = Math.min(run.to + gridSize * 0.03, cursor + length);
      const depth = gridSize * (0.13 + noise(seed, 2) * 0.07);
      const y = run.bottom + (row + 0.5) * rowHeight;
      // Ni asoma por encima del borde ni se hunde bajo el suelo de abajo
      const slab = Math.min(rowHeight * (1.05 + noise(seed, 4) * 0.35), 2 * (run.top + 0.012 - y), 2 * (y - run.bottom + 0.012));
      parts.push(dressGeometry(rubblePiece(run, {
        length: b - a,
        height: slab,
        depth,
        seed: seed * 23,
        rough: 0.3,
        along: (a + b) / 2,
        y,
        out: gridSize * 0.035 - depth / 2 + ledge + noise(seed, 6) * gridSize * 0.015,
        yaw: (noise(seed, 8) - 0.5) * 0.24,
      }), gridSize, variedColor(palette, noise(seed, 31), 0.42), { footY: run.bottom, grime: 0.3 }));
      cursor += length * 0.9;
      index += 1;
    }
  }
  const rubble = Math.round(((run.to - run.from) / gridSize) * 2);
  for (let n = 0; n < rubble; n += 1) {
    const seed = noise(run.at, run.from + n, 71);
    const size = 0.06 + seed * 0.07;
    parts.push(dressGeometry(rubblePiece(run, {
      length: gridSize * size * 1.2,
      height: size * 0.8,
      depth: gridSize * size * 1.1,
      seed: seed * 41,
      rough: 0.4,
      along: run.from + (run.to - run.from) * ((n + noise(seed, 1)) / rubble),
      y: run.bottom + size * 0.4,
      out: gridSize * (0.05 + noise(seed, 2) * 0.08),
      yaw: seed * Math.PI,
    }), gridSize, variedColor(palette.clone().multiplyScalar(0.9), noise(seed, 3), 0.3), { footY: run.bottom }));
  }
}

// El trasdós (las caras del corte) queda en sombra detrás de la piedra: hace
// de mortero en la sillería y de tierra en el risco.
export function buildElevationGeometry(room, gridSize, { style, color } = {}) {
  const natural = normalizeTerrainStyle(style) === 'natural';
  const palette = natural ? stonePalette(ROCK_COLOR) : stonePalette(color);
  const parts = [];
  const sides = buildTerrainSides(room, gridSize);
  if (sides.getAttribute('position').count) {
    const backing = sides.toNonIndexed();
    const colors = backing.getAttribute('color');
    const tone = palette.clone().multiplyScalar(natural ? 0.4 : 0.32);
    for (let i = 0; i < colors.count; i += 1) {
      colors.setXYZ(i, colors.getX(i) * tone.r, colors.getY(i) * tone.g, colors.getZ(i) * tone.b);
    }
    parts.push(backing);
  }
  sides.dispose();
  for (const run of terrainFaceRuns(room, gridSize)) {
    if (natural) naturalFacing(run, gridSize, palette, parts);
    else builtFacing(run, gridSize, palette, parts);
  }
  return finish(parts);
}
