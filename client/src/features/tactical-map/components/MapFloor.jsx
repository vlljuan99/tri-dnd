import { Suspense, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { disabledCellsToSet, cellKey } from '../domain/cells.js';

// Construye la geometría del suelo de una sala: un cuadrado por casilla
// activa (las desactivadas se omiten, quedando como vacío/oscuro). Las UV de
// cada casilla apuntan a su porción de la textura de la sala, para que una
// imagen rectangular se "recorte" a la forma de la sala.
function buildRoomGeometry({ col, row, width, height, gridSize, disabledCells }) {
  const disabled = disabledCellsToSet(disabledCells);
  const positions = [];
  const uvs = [];
  const indices = [];
  let vertex = 0;

  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      if (disabled.has(cellKey(c, r))) continue;

      const x0 = (col + c) * gridSize;
      const x1 = (col + c + 1) * gridSize;
      const z0 = (row + r) * gridSize;
      const z1 = (row + r + 1) * gridSize;
      const u0 = c / width;
      const u1 = (c + 1) / width;
      const v0 = 1 - r / height;
      const v1 = 1 - (r + 1) / height;

      positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      // Orden de índices invertido para que la cara quede orientada hacia
      // +Y (la cámara cenital mira hacia abajo): si no, el culling por
      // defecto de FrontSide oculta el suelo entero.
      indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
      vertex += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function useRoomGeometry(room, gridSize) {
  return useMemo(
    () => buildRoomGeometry({ ...room, gridSize }),
    [room.col, room.row, room.width, room.height, room.disabledCells, gridSize]
  );
}

// Las salas sin revelar solo llegan al DM: se pintan atenuadas para que
// sepa qué parte del mapa no están viendo los jugadores
function dimmedProps(room) {
  return room.revealed === false ? { transparent: true, opacity: 0.4 } : {};
}

function roomWallKey(room, col, row, side) {
  const x = room.col + col;
  const y = room.row + row;
  if (side === 'n') return `h:${x},${y}`;
  if (side === 's') return `h:${x},${y + 1}`;
  if (side === 'o') return `v:${x},${y}`;
  return `v:${x + 1},${y}`;
}

function boardDoorEdges(doors = []) {
  const edges = new Set();
  for (const door of doors) {
    if (!door.isOpen || door.kind !== 'puerta' || !door.edge || (!door.dirX && !door.dirY)) continue;
    edges.add(
      door.dirX
        ? `v:${door.col + (door.dirX > 0 ? 1 : 0)},${door.row}`
        : `h:${door.col},${door.row + (door.dirY > 0 ? 1 : 0)}`
    );
  }
  return edges;
}

function RoomImageFloor({ room, gridSize }) {
  const texture = useLoader(THREE.TextureLoader, room.backgroundUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const geometry = useRoomGeometry(room, gridSize);

  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial map={texture} roughness={1} {...dimmedProps(room)} />
    </mesh>
  );
}

function RoomPlainFloor({ room, gridSize }) {
  const geometry = useRoomGeometry(room, gridSize);
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial color="#2b241d" roughness={1} metalness={0} {...dimmedProps(room)} />
    </mesh>
  );
}

// Obstáculos de la sala: bloques bajos que no se pueden pisar (columnas,
// rocas, muebles). Bloquearán la línea de visión en la niebla de guerra.
function RoomObstacles({ room, gridSize }) {
  const cells = room.obstacleCells ?? [];
  if (!cells.length) return null;
  return (
    <group>
      {cells.map(([c, r]) => (
        <mesh
          key={`${c},${r}`}
          position={[(room.col + c + 0.5) * gridSize, 0.2, (room.row + r + 0.5) * gridSize]}
          raycast={() => null}
        >
          <boxGeometry args={[gridSize * 0.86, 0.4, gridSize * 0.86]} />
          <meshStandardMaterial color="#463526" roughness={0.95} {...dimmedProps(room)} />
        </mesh>
      ))}
    </group>
  );
}

// Paredes por arista de la sala: muros gruesos y altos sobre el borde de la
// casilla. Bloquean paso y visión (validado en servidor); aquí solo se pintan.
// El color lo elige el DM por mapa (wallColor).
function RoomWalls({ room, gridSize, wallColor, doorEdges }) {
  const edges = room.wallEdges ?? [];
  if (!edges.length) return null;
  const thickness = gridSize * 0.22;
  const height = 1;
  return (
    <group>
      {edges.map(([c, r, side]) => {
        if (doorEdges.has(roomWallKey(room, c, r, side))) return null;
        const horizontal = side === 'n' || side === 's';
        // Punto medio de la arista en coordenadas de mundo
        const x = (room.col + c + (side === 'e' ? 1 : horizontal ? 0.5 : 0)) * gridSize;
        const z = (room.row + r + (side === 's' ? 1 : horizontal ? 0 : 0.5)) * gridSize;
        return (
          <mesh key={`${c},${r},${side}`} position={[x, height / 2, z]} raycast={() => null}>
            <boxGeometry
              args={horizontal ? [gridSize + thickness, height, thickness] : [thickness, height, gridSize + thickness]}
            />
            <meshStandardMaterial color={wallColor || '#9b8555'} roughness={0.9} {...dimmedProps(room)} />
          </mesh>
        );
      })}
    </group>
  );
}

// Elevación de la sala: cada casilla con nivel ≠ 0 se pinta como una
// plataforma (positiva) o un foso (negativo) sobre el suelo plano. Con la luz
// direccional, las caras superiores quedan más iluminadas que las laterales,
// dando sensación de relieve incluso en vista cenital. Subir cuesta
// movimiento extra (validado en servidor); aquí solo se pinta.
const ELEV_STEP = 0.4; // altura de mundo por nivel (5 pies)

function RoomElevation({ room, gridSize }) {
  const cells = room.elevationCells ?? [];
  if (!cells.length) return null;
  return (
    <group>
      {cells.map(([c, r, level]) => {
        const h = Math.abs(level) * ELEV_STEP;
        // Positivo: bloque desde el suelo hacia arriba. Negativo: hacia abajo.
        const yCenter = level > 0 ? h / 2 : -h / 2;
        const color = level > 0 ? '#7a6446' : '#241c14';
        return (
          <mesh
            key={`${c},${r}`}
            position={[(room.col + c + 0.5) * gridSize, yCenter, (room.row + r + 0.5) * gridSize]}
            raycast={() => null}
          >
            <boxGeometry args={[gridSize, h, gridSize]} />
            <meshStandardMaterial color={color} roughness={0.95} {...dimmedProps(room)} />
          </mesh>
        );
      })}
    </group>
  );
}

// Luces del tablero: antorchas automáticas en las paredes (una cada
// `wallLightEvery` casillas, determinista por posición) más las fuentes
// manuales del DM (braseros/velas en lightCells). Cada luz es una brasa
// emisiva; solo las primeras llevan una pointLight REAL, porque el coste de
// render de three.js crece con cada luz — el resto queda como brasa
// decorativa. La niebla por niveles de luz llegará en la fase 12.
const MAX_REAL_LIGHTS = 16;

function collectBoardLights(map) {
  const lights = [];
  const every = map.wallLightEvery ?? 0;
  const doorEdges = boardDoorEdges(map.doors);
  for (const room of map.rooms ?? []) {
    if (every > 0) {
      for (const [c, r, side] of room.wallEdges ?? []) {
        if (doorEdges.has(roomWallKey(room, c, r, side))) continue;
        const x = room.col + c;
        const y = room.row + r;
        // Determinista y ~1 por cada `every` casillas a lo largo de un muro
        // recto: sobre una pared horizontal varía x, sobre una vertical varía y
        if ((x + y) % every !== 0) continue;
        const horizontal = side === 'n' || side === 's';
        // En el punto medio de la arista, un pelín hacia dentro de la casilla
        const inset = 0.16;
        const px = horizontal ? x + 0.5 : side === 'o' ? x + inset : x + 1 - inset;
        const pz = horizontal ? (side === 'n' ? y + inset : y + 1 - inset) : y + 0.5;
        lights.push({ x: px * map.gridSize, y: 0.62, z: pz * map.gridSize, dim: room.revealed === false });
      }
    }
    for (const [c, r] of room.lightCells ?? []) {
      lights.push({
        x: (room.col + c + 0.5) * map.gridSize,
        y: 0.3,
        z: (room.row + r + 0.5) * map.gridSize,
        dim: room.revealed === false,
      });
    }
  }
  return lights;
}

function BoardLights({ map }) {
  const lights = useMemo(() => collectBoardLights(map), [map]);
  if (!lights.length) return null;
  return (
    <group>
      {lights.map((light, index) => (
        <group key={`${light.x},${light.z}`} position={[light.x, light.y, light.z]}>
          <mesh raycast={() => null}>
            <sphereGeometry args={[map.gridSize * 0.08, 8, 8]} />
            <meshStandardMaterial
              color="#ffcf6e"
              emissive="#ff8c1a"
              emissiveIntensity={light.dim ? 0.6 : 2.4}
            />
          </mesh>
          {index < MAX_REAL_LIGHTS && !light.dim && (
            <pointLight color="#ff9a3c" intensity={2.4} distance={map.gridSize * 4.5} decay={1.7} />
          )}
        </group>
      ))}
    </group>
  );
}

// Suelo del tablero compuesto: cada sala visible se pinta por separado, con
// su imagen (subida o generada en el editor) o con piedra lisa si no tiene.
export default function MapFloor({ map }) {
  // Compatibilidad con mapas sin salas (datos de prueba): un solo rectángulo
  const rooms = map.rooms?.length
    ? map.rooms
    : [
        {
          id: 'board',
          col: 0,
          row: 0,
          width: Math.ceil(map.width / map.gridSize),
          height: Math.ceil(map.height / map.gridSize),
          backgroundUrl: map.backgroundUrl || null,
          disabledCells: map.disabledCells ?? [],
        },
      ];
  const doorEdges = useMemo(() => boardDoorEdges(map.doors), [map.doors]);

  return (
    <group>
      {rooms.map((room) => (
        <group key={room.id}>
          {room.backgroundUrl ? (
            <Suspense fallback={<RoomPlainFloor room={room} gridSize={map.gridSize} />}>
              <RoomImageFloor room={room} gridSize={map.gridSize} />
            </Suspense>
          ) : (
            <RoomPlainFloor room={room} gridSize={map.gridSize} />
          )}
          <RoomObstacles room={room} gridSize={map.gridSize} />
          <RoomWalls room={room} gridSize={map.gridSize} wallColor={map.wallColor} doorEdges={doorEdges} />
          <RoomElevation room={room} gridSize={map.gridSize} />
        </group>
      ))}
      <BoardLights map={map} />
    </group>
  );
}
