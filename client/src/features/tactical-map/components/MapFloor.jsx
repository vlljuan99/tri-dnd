import { Suspense, useEffect, useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { disabledCellsToSet, cellKey } from '../domain/cells.js';
import { ELEV_STEP } from '../domain/elevation.js';
import { FLUID_TYPE_KEYS } from '../domain/fluids.js';
import { BoardMaterials, StoneBlock, StoneMaterial } from './BoardMaterials.jsx';

// Construye la geometría del suelo de una sala: un cuadrado por casilla
// activa (las desactivadas se omiten, quedando como vacío/oscuro). Las UV de
// cada casilla apuntan a su porción de la textura de la sala, para que una
// imagen rectangular se "recorte" a la forma de la sala.
function buildRoomGeometry({ col, row, width, height, gridSize, disabledCells, stone = false }) {
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
      if (stone) {
        uvs.push(x0 / gridSize / 4, -z0 / gridSize / 4, x1 / gridSize / 4, -z0 / gridSize / 4,
          x1 / gridSize / 4, -z1 / gridSize / 4, x0 / gridSize / 4, -z1 / gridSize / 4);
      } else {
        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      }
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

function useRoomGeometry(room, gridSize, stone = false) {
  const geometry = useMemo(
    () => buildRoomGeometry({ ...room, gridSize, stone }),
    [room.col, room.row, room.width, room.height, room.disabledCells, gridSize, stone]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
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
    <mesh geometry={geometry} receiveShadow raycast={() => null}>
      {/* Conservamos StandardMaterial para que antorchas y relieve sigan
          afectando al arte, pero la misma textura emite un 20 % de sí: así la
          ilustración mantiene detalle mínimo sin convertirse en un plano sin luz. */}
      <meshStandardMaterial
        map={texture}
        emissive="#ffffff"
        emissiveMap={texture}
        emissiveIntensity={0.25}
        roughness={1}
        {...dimmedProps(room)}
      />
    </mesh>
  );
}

function RoomPlainFloor({ room, gridSize }) {
  const geometry = useRoomGeometry(room, gridSize, true);
  return (
    <mesh geometry={geometry} receiveShadow raycast={() => null}>
      <StoneMaterial {...dimmedProps(room)} />
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
        <StoneBlock
          key={`${c},${r}`}
          position={[(room.col + c + 0.5) * gridSize, 0.2, (room.row + r + 0.5) * gridSize]}
          dimensions={[gridSize * 0.86, 0.4, gridSize * 0.86]}
          castShadow={room.revealed !== false} receiveShadow
          raycast={() => null}
        >
          <StoneMaterial color="#8b8270" {...dimmedProps(room)} />
        </StoneBlock>
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
          <StoneBlock key={`${c},${r},${side}`} position={[x, height / 2, z]} raycast={() => null}
            dimensions={horizontal ? [gridSize + thickness, height, thickness] : [thickness, height, gridSize + thickness]}
            castShadow={room.revealed !== false} receiveShadow>
            <StoneMaterial color={wallColor || '#b0aa96'} {...dimmedProps(room)} />
          </StoneBlock>
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
function RoomElevation({ room, gridSize }) {
  const cells = room.elevationCells ?? [];
  if (!cells.length) return null;
  return (
    <group>
      {cells.map(([c, r, level]) => {
        const h = Math.abs(level) * ELEV_STEP;
        // Positivo: bloque desde el suelo hacia arriba. Negativo: hacia abajo.
        const yCenter = level > 0 ? h / 2 : -h / 2;
        const color = level > 0 ? '#aba28c' : '#544f46';
        return (
          <mesh
            key={`${c},${r}`}
            position={[(room.col + c + 0.5) * gridSize, yCenter, (room.row + r + 0.5) * gridSize]}
            raycast={() => null}
            castShadow={room.revealed !== false} receiveShadow
          >
            <boxGeometry args={[gridSize, h, gridSize]} />
            <StoneMaterial color={color} {...dimmedProps(room)} />
          </mesh>
        );
      })}
    </group>
  );
}

// Los fluidos comparten un único shader barato. Cada tipo presente construye
// una sola geometría fusionada para todo el tablero: cuatro vértices por
// casilla, pero solo un draw-call por tipo y sin texturas, luces ni ruido.
const FLUID_LAYER_Y = 0.045;
const FLUID_CONFIG = {
  agua: { kind: 0, colorA: '#1c3e45', colorB: '#789b9c', opacity: 0.52 },
  lava: { kind: 1, colorA: '#5e0e08', colorB: '#ff7a18', opacity: 0.82 },
  niebla: { kind: 2, colorA: '#315b32', colorB: '#a4cf68', opacity: 0.3 },
  veneno: { kind: 3, colorA: '#26351d', colorB: '#71823b', opacity: 0.64 },
  arcana: { kind: 4, colorA: '#155da0', colorB: '#d5f8ff', opacity: 0.68 },
};

const fluidVertexShader = `
  attribute float aOpacity;
  varying vec2 vCoord;
  varying float vOpacity;

  void main() {
    vCoord = uv;
    vOpacity = aOpacity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fluidFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uKind;
  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vCoord;
  varying float vOpacity;

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 blend = fract(p);
    blend = blend * blend * (3.0 - 2.0 * blend);
    float a = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(cell + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  }

  void main() {
    float waveA = sin(vCoord.x * 3.7 + uTime * 0.75);
    float waveB = sin(vCoord.y * 4.3 - uTime * 0.58);
    float waveC = sin((vCoord.x + vCoord.y) * 2.8 + uTime * 0.34);
    float crossed = (waveA + waveB + waveC) / 3.0;
    float mixValue = 0.5 + crossed * 0.24;
    float alphaFactor = 1.0;
    vec3 color = mix(uColorA, uColorB, mixValue);

    if (uKind < 0.5) {
      // Ondas irregulares y reflejos cortos: el agua deja ver el arte bajo
      // su superficie sin bandas diagonales uniformes sobre cada casilla.
      float drift = noise(vCoord * 2.6 + vec2(uTime * 0.07, -uTime * 0.04));
      float detail = noise(vCoord * 8.0 - vec2(uTime * 0.1, uTime * 0.03));
      float glint = smoothstep(0.72, 0.94, drift * 0.65 + detail * 0.35);
      color = mix(uColorA, uColorB, 0.2 + drift * 0.42);
      color += vec3(0.18, 0.22, 0.22) * glint;
      alphaFactor = 0.76 + drift * 0.2;
    } else if (uKind < 1.5) {
      // Lava: base naranja-roja con vetas oscuras de flujo lento.
      float vein = abs(sin(vCoord.x * 3.2 + vCoord.y * 5.4 - uTime * 0.28) + waveC * 0.38);
      float darkVein = 1.0 - smoothstep(0.08, 0.42, vein);
      color = mix(color, vec3(0.12, 0.015, 0.005), darkVein * 0.82);
      color += vec3(0.2, 0.035, 0.0) * (1.0 - darkVein);
    } else if (uKind < 2.5) {
      // Niebla tóxica: humo lento, difuso y deliberadamente tenue.
      float smoke = 0.5 + 0.5 * sin(vCoord.x * 2.1 - vCoord.y * 2.7 + uTime * 0.2 + waveB * 0.7);
      color = mix(uColorA, uColorB, 0.2 + smoke * 0.5);
      alphaFactor = 0.55 + smoke * 0.35;
    } else if (uKind < 3.5) {
      // Veneno/cieno: desplazamiento viscoso con burbujas que ascienden.
      float bubbleBand = sin(vCoord.x * 8.0 + sin(vCoord.y * 3.0) - uTime * 0.38);
      float bubbles = smoothstep(0.92, 1.0, bubbleBand) * (0.5 + 0.5 * sin(vCoord.y * 7.0 - uTime * 0.55));
      color = mix(color, uColorB * 1.25, bubbles * 0.75);
      alphaFactor = 0.88 + bubbles * 0.12;
    } else {
      // Agua arcana: pulso azul-blanco emisivo sin consumir luces reales.
      float pulse = 0.5 + 0.5 * sin(uTime * 1.15 + (vCoord.x + vCoord.y) * 1.7);
      color = mix(color, uColorB * 1.35, pulse * 0.35);
      alphaFactor = 0.85 + pulse * 0.15;
    }

    gl_FragColor = vec4(color, uOpacity * vOpacity * alphaFactor);
  }
`;

function buildFluidGeometries(rooms, gridSize) {
  const buffers = new Map();
  for (const type of FLUID_TYPE_KEYS) {
    buffers.set(type, { positions: [], uvs: [], opacities: [], indices: [], vertex: 0, seen: new Set() });
  }

  for (const room of rooms) {
    const disabled = disabledCellsToSet(room.disabledCells);
    const opacity = room.revealed === false ? 0.4 : 1;
    for (const [c, r, type] of room.fluidCells ?? []) {
      if (!FLUID_TYPE_KEYS.has(type) || c < 0 || r < 0 || c >= room.width || r >= room.height) continue;
      if (disabled.has(cellKey(c, r))) continue;
      const buffer = buffers.get(type);
      const worldCellKey = cellKey(room.col + c, room.row + r);
      if (buffer.seen.has(worldCellKey)) continue;
      buffer.seen.add(worldCellKey);

      const x0 = (room.col + c) * gridSize;
      const x1 = (room.col + c + 1) * gridSize;
      const z0 = (room.row + r) * gridSize;
      const z1 = (room.row + r + 1) * gridSize;
      buffer.positions.push(
        x0, FLUID_LAYER_Y, z0,
        x1, FLUID_LAYER_Y, z0,
        x1, FLUID_LAYER_Y, z1,
        x0, FLUID_LAYER_Y, z1
      );
      // Coordenadas en unidades de casilla: el patrón cruza sus bordes sin
      // costuras y conserva la misma escala aunque cambie gridSize.
      buffer.uvs.push(
        room.col + c, room.row + r,
        room.col + c + 1, room.row + r,
        room.col + c + 1, room.row + r + 1,
        room.col + c, room.row + r + 1
      );
      buffer.opacities.push(opacity, opacity, opacity, opacity);
      buffer.indices.push(
        buffer.vertex,
        buffer.vertex + 2,
        buffer.vertex + 1,
        buffer.vertex,
        buffer.vertex + 3,
        buffer.vertex + 2
      );
      buffer.vertex += 4;
    }
  }

  const geometries = [];
  for (const [type, buffer] of buffers) {
    if (!buffer.vertex) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
    geometry.setAttribute('aOpacity', new THREE.Float32BufferAttribute(buffer.opacities, 1));
    geometry.setIndex(buffer.indices);
    geometry.computeBoundingSphere();
    geometries.push({ type, geometry });
  }
  return geometries;
}

function FluidMesh({ type, geometry }) {
  const material = useMemo(() => {
    const config = FLUID_CONFIG[type];
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uKind: { value: config.kind },
        uOpacity: { value: config.opacity },
        uColorA: { value: new THREE.Color(config.colorA) },
        uColorB: { value: new THREE.Color(config.colorB) },
      },
      vertexShader: fluidVertexShader,
      fragmentShader: fluidFragmentShader,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
  }, [type]);

  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return <mesh geometry={geometry} material={material} raycast={() => null} renderOrder={1} />;
}

function BoardFluids({ rooms, gridSize }) {
  const geometries = useMemo(() => buildFluidGeometries(rooms, gridSize), [rooms, gridSize]);
  useEffect(
    () => () => {
      for (const { geometry } of geometries) geometry.dispose();
    },
    [geometries]
  );
  if (!geometries.length) return null;
  return geometries.map(({ type, geometry }) => (
    <FluidMesh key={type} type={type} geometry={geometry} />
  ));
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
          {/* Cazoleta de hierro: ancla la brasa al escenario. Las fuentes
              decorativas lejanas conservan una sola malla. */}
          {index < MAX_REAL_LIGHTS && (
            <mesh position={[0, -0.095, 0]} raycast={() => null}>
              <cylinderGeometry args={[map.gridSize * 0.1, map.gridSize * 0.06, 0.1, 10]} />
              <meshStandardMaterial color="#39352e" metalness={0.62} roughness={0.65} />
            </mesh>
          )}
          <mesh scale={[0.75, 1.45, 0.75]} raycast={() => null}>
            <sphereGeometry args={[map.gridSize * 0.08, 8, 8]} />
            <meshStandardMaterial
              color="#ffcf6e"
              emissive="#ff8c1a"
              emissiveIntensity={light.dim ? 0.6 : 2.4}
            />
          </mesh>
          {index < MAX_REAL_LIGHTS && !light.dim && (
            <pointLight color="#ffb668" intensity={2.8} distance={map.gridSize * 4.5} decay={1.7} />
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
    <BoardMaterials>
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
      <BoardFluids rooms={rooms} gridSize={map.gridSize} />
      <BoardLights map={map} />
    </BoardMaterials>
  );
}
