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
        </group>
      ))}
    </group>
  );
}
