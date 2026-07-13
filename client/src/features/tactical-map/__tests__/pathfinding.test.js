import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardWalkable, findBoardPath, reachableWithin, buildBoardElevation } from '../domain/pathfinding.js';
import { buildBoardWalls, wallBlocksStep } from '../domain/walls.js';

// Tablero de una sala 5x3 en (0,0) con obstáculo en (2,1) y terreno
// difícil (coste 3) en (2,0) — el mismo escenario que valida el servidor.
const board = {
  rooms: [
    {
      col: 0,
      row: 0,
      width: 5,
      height: 3,
      disabledCells: [],
      obstacleCells: [[2, 1]],
      terrainCells: [[2, 0, 3]],
    },
  ],
};

test('el camino rodea obstáculos y elige la ruta más barata', () => {
  const walkable = buildBoardWalkable(board);
  // De (0,1) a (4,1): recto bloqueado por el obstáculo; por arriba pisa el
  // terreno difícil (coste 6), por abajo es normal (coste 4)
  const result = findBoardPath(walkable, { col: 0, row: 1 }, { col: 4, row: 1 });
  assert.equal(result.cost, 4);
  assert.equal(result.path.length, 4);
  assert.deepEqual(result.path.at(-1), { col: 4, row: 1 });
});

test('entrar en terreno difícil cuesta su coste, no 1', () => {
  const walkable = buildBoardWalkable(board);
  const result = findBoardPath(walkable, { col: 0, row: 0 }, { col: 2, row: 0 });
  assert.equal(result.cost, 4); // (1,0)=1 + (2,0)=3
});

test('sin camino hacia obstáculos o fuera del tablero', () => {
  const walkable = buildBoardWalkable(board);
  assert.equal(findBoardPath(walkable, { col: 0, row: 0 }, { col: 2, row: 1 }), null);
  assert.equal(findBoardPath(walkable, { col: 0, row: 0 }, { col: 9, row: 9 }), null);
});

test('mismo origen y destino cuesta 0 con camino vacío', () => {
  const walkable = buildBoardWalkable(board);
  assert.deepEqual(findBoardPath(walkable, { col: 1, row: 1 }, { col: 1, row: 1 }), { cost: 0, path: [] });
});

// Cuenta los cambios de dirección de un camino (incluido el primer paso
// desde el origen), para medir cuán "recta" es la ruta.
function countTurns(from, path) {
  const steps = [from, ...path];
  let turns = 0;
  let prevDir = null;
  for (let i = 1; i < steps.length; i += 1) {
    const dir = `${Math.sign(steps[i].col - steps[i - 1].col)},${Math.sign(steps[i].row - steps[i - 1].row)}`;
    if (prevDir !== null && dir !== prevDir) turns += 1;
    prevDir = dir;
  }
  return turns;
}

test('en terreno abierto la ruta sale recta, no en escalera', () => {
  const open = {
    rooms: [
      { col: 0, row: 0, width: 8, height: 8, disabledCells: [], obstacleCells: [], terrainCells: [], wallEdges: [] },
    ],
  };
  const walkable = buildBoardWalkable(open);
  const from = { col: 0, row: 0 };
  const result = findBoardPath(walkable, from, { col: 2, row: 6 });
  // Coste óptimo intacto (6 pasos: 2 diagonales + 4 rectos) y como mucho un
  // giro (tramo diagonal + tramo recto), nunca un zigzag de varios giros
  assert.equal(result.cost, 6);
  assert.equal(result.path.length, 6);
  assert.ok(countTurns(from, result.path) <= 1, `esperaba ≤1 giro, hubo ${countTurns(from, result.path)}`);
});

test('el área alcanzable respeta el coste del terreno', () => {
  const walkable = buildBoardWalkable(board);
  // Con presupuesto 1 desde (1,0): las adyacentes normales sí, la de
  // terreno difícil (2,0, coste 3) no, y el obstáculo (2,1) nunca
  const cells = reachableWithin(walkable, { col: 1, row: 0 }, 1);
  const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
  assert.ok(keys.has('0,0'));
  assert.ok(keys.has('0,1'));
  assert.ok(keys.has('1,1'));
  assert.ok(!keys.has('2,0'), 'terreno difícil fuera de presupuesto 1');
  assert.ok(!keys.has('2,1'), 'obstáculo nunca alcanzable');
  // Con presupuesto 3 sí llega al terreno difícil
  const cells3 = reachableWithin(walkable, { col: 1, row: 0 }, 3);
  assert.ok(cells3.some((c) => c.col === 2 && c.row === 0));
});

// Sala 4x2 con una pared vertical entre las columnas 1 y 2 que cubre solo
// la fila 0: por la fila 1 se puede rodear.
const walledBoard = {
  rooms: [
    {
      col: 0,
      row: 0,
      width: 4,
      height: 2,
      disabledCells: [],
      obstacleCells: [],
      terrainCells: [],
      wallEdges: [[2, 0, 'o']],
    },
  ],
};

test('una pared por arista corta el paso directo pero se puede rodear', () => {
  const walkable = buildBoardWalkable(walledBoard);
  const walls = buildBoardWalls(walledBoard);
  // Sin paredes el paso directo cuesta 1; con la pared hay que bajar a la
  // fila 1 y volver a subir (la diagonal que roza la esquina también se
  // bloquea: no se recortan esquinas de muro)
  assert.equal(findBoardPath(walkable, { col: 1, row: 0 }, { col: 2, row: 0 }).cost, 1);
  const result = findBoardPath(walkable, { col: 1, row: 0 }, { col: 2, row: 0 }, 150, walls);
  assert.equal(result.cost, 3);
});

test('una sala cerrada del todo por paredes queda inalcanzable', () => {
  const sealed = {
    rooms: [
      {
        col: 0,
        row: 0,
        width: 3,
        height: 1,
        disabledCells: [],
        obstacleCells: [],
        terrainCells: [],
        // La casilla (2,0) cerrada por su lado oeste (única entrada posible)
        wallEdges: [[2, 0, 'o']],
      },
    ],
  };
  const walkable = buildBoardWalkable(sealed);
  const walls = buildBoardWalls(sealed);
  assert.equal(findBoardPath(walkable, { col: 0, row: 0 }, { col: 2, row: 0 }, 150, walls), null);
});

test('el área alcanzable respeta las paredes', () => {
  const walkable = buildBoardWalkable(walledBoard);
  const walls = buildBoardWalls(walledBoard);
  const cells = reachableWithin(walkable, { col: 1, row: 0 }, 1, walls);
  const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
  assert.ok(!keys.has('2,0'), 'la pared corta el paso directo');
  assert.ok(!keys.has('2,1'), 'la diagonal que roza la esquina de la pared también');
  assert.ok(keys.has('1,1'));
});

// Sala 5x1 plana salvo la casilla (3,0) elevada 2 niveles.
const elevatedBoard = {
  rooms: [
    {
      col: 0,
      row: 0,
      width: 5,
      height: 1,
      disabledCells: [],
      obstacleCells: [],
      terrainCells: [],
      wallEdges: [],
      elevationCells: [[3, 0, 2]],
    },
  ],
};

test('subir de nivel cuesta movimiento extra; bajar no', () => {
  const walkable = buildBoardWalkable(elevatedBoard);
  const elevation = buildBoardElevation(elevatedBoard);
  // De (2,0) a (3,0): sube 2 niveles → 1 (entrar) + 2 (escalar) = 3
  const up = findBoardPath(walkable, { col: 2, row: 0 }, { col: 3, row: 0 }, 150, null, elevation);
  assert.equal(up.cost, 3);
  // De (3,0) a (4,0): baja 2 niveles → solo 1 (entrar), sin extra
  const down = findBoardPath(walkable, { col: 3, row: 0 }, { col: 4, row: 0 }, 150, null, elevation);
  assert.equal(down.cost, 1);
  // Sin elevación (control) el mismo paso cuesta 1
  const flat = findBoardPath(walkable, { col: 2, row: 0 }, { col: 3, row: 0 });
  assert.equal(flat.cost, 1);
});

test('el área alcanzable descuenta el coste de escalar', () => {
  const walkable = buildBoardWalkable(elevatedBoard);
  const elevation = buildBoardElevation(elevatedBoard);
  // Desde (2,0) con presupuesto 2: la plataforma (3,0) cuesta 3, no llega
  const cells = reachableWithin(walkable, { col: 2, row: 0 }, 2, null, elevation);
  const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
  assert.ok(!keys.has('3,0'), 'la plataforma queda fuera de presupuesto 2');
  // Con presupuesto 3 sí alcanza la plataforma
  const cells3 = reachableWithin(walkable, { col: 2, row: 0 }, 3, null, elevation);
  assert.ok(cells3.some((c) => c.col === 3 && c.row === 0));
});

test('wallBlocksStep: ortogonales y diagonales alrededor de una pared', () => {
  const walls = buildBoardWalls(walledBoard); // pared v entre (1,0) y (2,0)
  assert.ok(wallBlocksStep(walls, 1, 0, 2, 0), 'este-oeste bloqueado');
  assert.ok(wallBlocksStep(walls, 2, 0, 1, 0), 'simétrico');
  assert.ok(wallBlocksStep(walls, 1, 1, 2, 0), 'diagonal por la esquina inferior de la pared');
  assert.ok(wallBlocksStep(walls, 2, 1, 1, 0), 'la otra diagonal también');
  assert.ok(!wallBlocksStep(walls, 1, 1, 2, 1), 'por la fila de abajo se pasa');
  assert.ok(!wallBlocksStep(walls, 0, 0, 1, 0), 'lejos de la pared no bloquea');
});
