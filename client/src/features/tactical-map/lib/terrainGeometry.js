import { BufferGeometry, Float32BufferAttribute } from 'three';
import { cellKey, disabledCellsToSet } from '../domain/cells.js';
import { cellGroundY } from '../domain/elevation.js';

// Estas geometrías leen la elevación existente. Su relieve y sus colores no
// crean casillas transitables, costes de movimiento ni reglas nuevas.
function roomTerrain(room) {
  const disabled = disabledCellsToSet(room.disabledCells);
  const levels = new Map();
  for (const [col, row, level] of room.elevationCells ?? []) {
    const key = cellKey(col, row);
    const value = Math.trunc(Number(level) || 0);
    levels.set(key, Math.max(levels.get(key) ?? -Infinity, value));
  }
  const active = (col, row) => col >= 0 && row >= 0 && col < room.width && row < room.height
    && !disabled.has(cellKey(col, row));
  const ground = (col, row) => active(col, row) ? cellGroundY(levels, col, row) : 0;
  return { active, ground, levels };
}

function geometryFromBuffers({ positions, normals, uvs, colors, indices }) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const newBuffers = () => ({ positions: [], normals: [], uvs: [], colors: [], indices: [] });

// La imagen conserva exactamente su recorte por sala al elevar una casilla.
// Los fosos mantienen la superficie de apoyo en cero, igual que las fichas y
// los indicadores del tablero, y se distinguen por una sombra más profunda.
export function buildTerrainSurface(room, gridSize, stone = false) {
  const terrain = roomTerrain(room);
  const buffers = newBuffers();
  for (let row = 0; row < room.height; row += 1) {
    for (let col = 0; col < room.width; col += 1) {
      if (!terrain.active(col, row)) continue;
      const x0 = (room.col + col) * gridSize;
      const x1 = x0 + gridSize;
      const z0 = (room.row + row) * gridSize;
      const z1 = z0 + gridSize;
      const y = terrain.ground(col, row);
      const vertex = buffers.positions.length / 3;
      buffers.positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      buffers.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      if (stone) {
        const repeat = gridSize * 4;
        buffers.uvs.push(x0 / repeat, -z0 / repeat, x1 / repeat, -z0 / repeat,
          x1 / repeat, -z1 / repeat, x0 / repeat, -z1 / repeat);
      } else {
        const u0 = col / room.width;
        const u1 = (col + 1) / room.width;
        const v0 = 1 - row / room.height;
        const v1 = 1 - (row + 1) / room.height;
        buffers.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      }
      const level = terrain.levels.get(cellKey(col, row)) ?? 0;
      const shade = level < 0 ? Math.max(0.35, 0.64 - Math.abs(level) * 0.065) : 1;
      for (let corner = 0; corner < 4; corner += 1) buffers.colors.push(shade, shade, shade);
      // Vistas desde arriba, ambas caras miran hacia +Y.
      buffers.indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
    }
  }
  return geometryFromBuffers(buffers);
}

const SIDES = [
  { dc: 0, dr: -1, normal: [0, 0, -1], corners: (x0, x1, z0) => [[x0, z0], [x1, z0]], axis: 0 },
  { dc: 1, dr: 0, normal: [1, 0, 0], corners: (x0, x1, z0, z1) => [[x1, z0], [x1, z1]], axis: 1 },
  { dc: 0, dr: 1, normal: [0, 0, 1], corners: (x0, x1, z0, z1) => [[x1, z1], [x0, z1]], axis: 0 },
  { dc: -1, dr: 0, normal: [-1, 0, 0], corners: (x0, x1, z0, z1) => [[x0, z1], [x0, z0]], axis: 1 },
];

// Caras expuestas de los desniveles, en coordenadas de mundo: de dónde a dónde
// va cada frente, hacia dónde mira y qué altura salva. Entre casillas del
// mismo nivel no hay cara, y un escalón solo cubre la diferencia de altura.
export function exposedTerrainSides(room, gridSize) {
  const terrain = roomTerrain(room);
  const faces = [];
  for (let row = 0; row < room.height; row += 1) {
    for (let col = 0; col < room.width; col += 1) {
      if (!terrain.active(col, row)) continue;
      const top = terrain.ground(col, row);
      if (top <= 0) continue;
      const x0 = (room.col + col) * gridSize;
      const x1 = x0 + gridSize;
      const z0 = (room.row + row) * gridSize;
      const z1 = z0 + gridSize;
      for (const side of SIDES) {
        const bottom = terrain.ground(col + side.dc, row + side.dr);
        if (bottom >= top) continue;
        const [start, end] = side.corners(x0, x1, z0, z1);
        faces.push({ start, end, normal: side.normal, axis: side.axis, bottom, top });
      }
    }
  }
  return faces;
}

// Una sola malla contiene los cortes de la plataforma: es el trasdós de los
// riscos y los muros de contención, que se apoyan delante de ella.
// Las UV usan coordenadas de mundo en casillas: el material mantiene su tamaño
// al cambiar la altura y enlaza a lo largo de cada pared del terreno.
export function buildTerrainSides(room, gridSize) {
  const buffers = newBuffers();
  for (const { start, end, normal, axis, bottom, top } of exposedTerrainSides(room, gridSize)) {
    const vertex = buffers.positions.length / 3;
    const corners = [
      [start[0], bottom, start[1]], [start[0], top, start[1]],
      [end[0], top, end[1]], [end[0], bottom, end[1]],
    ];
    for (const [x, y, z] of corners) {
      buffers.positions.push(x, y, z);
      buffers.normals.push(...normal);
      buffers.uvs.push((axis === 0 ? x : z) / gridSize, y / gridSize);
      // Oscurecimiento suave de la base, continuo entre las casillas.
      const shade = 0.74 + Math.min(y, 2) * 0.07;
      buffers.colors.push(shade, shade * 0.97, shade * 0.91);
    }
    buffers.indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  return geometryFromBuffers(buffers);
}
