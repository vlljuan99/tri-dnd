import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentEdges, wallEntriesFromEdges, parseUvtt, lightCellsFromLights } from '../lib/uvtt.js';

test('un muro vertical sobre una línea de cuadrícula marca sus aristas', () => {
  const edges = segmentEdges({ x: 3, y: 1 }, { x: 3, y: 4 });
  assert.deepEqual([...edges].sort(), ['v:3,1', 'v:3,2', 'v:3,3']);
});

test('un muro horizontal con extremos casi en la línea también se ajusta', () => {
  const edges = segmentEdges({ x: 0.98, y: 2.02 }, { x: 4.01, y: 1.99 });
  assert.deepEqual([...edges].sort(), ['h:1,2', 'h:2,2', 'h:3,2']);
});

test('un muro diagonal se escalona marcando las aristas que cruza', () => {
  const edges = segmentEdges({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 });
  // Cruza de (0,0) a (2,2): cada cambio de casilla deja al menos una arista,
  // y los cruces de esquina marcan las dos para no dejar rendija
  assert.ok(edges.size >= 4);
  for (const key of edges) assert.match(key, /^[vh]:\d+,\d+$/);
});

test('las entradas de sala convierten los bordes exteriores a e/s', () => {
  const entries = wallEntriesFromEdges(new Set(['v:0,1', 'v:4,1', 'h:2,0', 'h:2,3']), 4, 3);
  assert.deepEqual(
    entries.sort((a, b) => String(a).localeCompare(String(b))),
    [
      [0, 1, 'o'],
      [2, 0, 'n'],
      [2, 2, 's'],
      [3, 1, 'e'],
    ].sort((a, b) => String(a).localeCompare(String(b)))
  );
});

test('wallEntriesFromEdges descarta aristas fuera del mapa', () => {
  const entries = wallEntriesFromEdges(new Set(['v:9,1', 'h:1,9', 'v:2,-1']), 4, 3);
  assert.deepEqual(entries, []);
});

test('parseUvtt extrae tamaño, muros y portales cerrados', () => {
  const uvtt = {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: 6, y: 4 },
      pixels_per_grid: 70,
    },
    line_of_sight: [
      [{ x: 2, y: 0 }, { x: 2, y: 2 }],
      [{ x: 2, y: 3 }, { x: 2, y: 4 }],
    ],
    objects_line_of_sight: [[{ x: 0, y: 1 }, { x: 1, y: 1 }]],
    portals: [
      {
        position: { x: 2, y: 2.5 },
        bounds: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        closed: true,
        freestanding: false,
      },
    ],
    lights: [{ position: { x: 1.7, y: 1.2 }, range: 3, color: 'ffaa00' }],
    image: 'aGVsbG8=',
  };
  const parsed = parseUvtt(JSON.stringify(uvtt));
  assert.equal(parsed.cols, 6);
  assert.equal(parsed.rows, 4);
  assert.equal(parsed.pixelsPerGrid, 70);
  assert.equal(parsed.lights, 1);
  // La luz en (1.7, 1.2) se encaja a la casilla [1, 1]
  assert.deepEqual(parsed.lightCells, [[1, 1]]);
  assert.equal(parsed.closedPortals, 1);
  const keys = new Set(parsed.wallEdges.map(([c, r, s]) => `${c},${r},${s}`));
  // Muro vertical en x=2, filas 0-1 y fila 3, y el portal cerrado tapa la fila 2
  assert.ok(keys.has('2,0,o'));
  assert.ok(keys.has('2,1,o'));
  assert.ok(keys.has('2,2,o'), 'el portal cerrado se importa como pared');
  assert.ok(keys.has('2,3,o'));
  // El muro de objetos va de (0,1) a (1,1): arista norte de la casilla (0,1)
  assert.ok(keys.has('0,1,n'), 'muro horizontal de objetos');
});

test('lightCellsFromLights encaja a casilla, recorta origen y deduplica', () => {
  const origin = { x: 0, y: 0 };
  const cells = lightCellsFromLights(
    [
      { position: { x: 0.5, y: 0.5 } }, // → [0, 0]
      { position: { x: 0.9, y: 0.1 } }, // misma casilla [0, 0], se ignora
      { position: { x: 3.4, y: 2.8 } }, // → [3, 2]
      { position: { x: 9, y: 1 } }, // fuera (col ≥ cols), se descarta
      { position: { x: 1, y: -1 } }, // fuera (fila < 0), se descarta
      { range: 3 }, // sin position, se descarta
    ],
    origin,
    4,
    3
  );
  assert.deepEqual(cells, [[0, 0], [3, 2]]);
});

test('lightCellsFromLights resta el origen del mapa', () => {
  const cells = lightCellsFromLights([{ position: { x: 6, y: 5 } }], { x: 4, y: 4 }, 4, 3);
  // (6-4, 5-4) = casilla [2, 1]
  assert.deepEqual(cells, [[2, 1]]);
});

test('lightCellsFromLights con lista vacía o ausente devuelve []', () => {
  assert.deepEqual(lightCellsFromLights([], { x: 0, y: 0 }, 4, 3), []);
  assert.deepEqual(lightCellsFromLights(undefined, { x: 0, y: 0 }, 4, 3), []);
});

test('parseUvtt rechaza archivos sin tamaño o sin imagen', () => {
  assert.throws(() => parseUvtt('esto no es json'), /JSON ilegible/);
  assert.throws(() => parseUvtt(JSON.stringify({ resolution: {} })), /sin tamaño/);
  assert.throws(
    () => parseUvtt(JSON.stringify({ resolution: { map_size: { x: 4, y: 4 } } })),
    /no incluye la imagen/
  );
});
