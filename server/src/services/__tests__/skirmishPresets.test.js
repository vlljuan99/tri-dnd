import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIRMISH_PRESETS, getSkirmishPreset, listSkirmishPresets } from '../skirmishPresets.js';

// Los escenarios de fábrica se escriben a mano y su geometría se genera, así
// que es fácil dejar un enemigo sobre una casilla que no existe o dos
// marcadores en la misma. Estas comprobaciones recorren el catálogo entero con
// las mismas reglas que valida `routes/maps.js` al editar un mapa.

const ROOM_MAX_SIDE = 100;
const FLUID_TYPES = new Set(['agua', 'lava', 'niebla', 'veneno', 'arcana']);
const TOKEN_KINDS = new Set(['enemigo', 'aliado', 'objeto', 'trampa']);

function roomCells(room) {
  const disabled = new Set((room.disabledCells ?? []).map(([col, row]) => `${col},${row}`));
  return {
    inside: (col, row) => col >= 0 && row >= 0 && col < room.width && row < room.height,
    usable: (col, row) => !disabled.has(`${col},${row}`),
  };
}

test('el catálogo expone tres escaramuzas sin DM para un aventurero', () => {
  const list = listSkirmishPresets();
  assert.equal(list.length, 3);
  for (const entry of list) {
    assert.equal(entry.players, 1);
    assert.ok(entry.name && entry.summary && entry.suggestedLevel);
    assert.match(entry.previewUrl, /^\/skirmishes\/.+\.webp$/);
    assert.equal(entry.enemyAi, true);
    assert.equal(entry.soloMode, true);
    assert.ok(entry.enemies > 0, `${entry.id} no tiene enemigos`);
    assert.equal(getSkirmishPreset(entry.id)?.id, entry.id);
  }
  assert.equal(getSkirmishPreset('no-existe'), null);
});

test('cada sala tiene un tamaño válido y sus capas caen dentro', () => {
  for (const preset of SKIRMISH_PRESETS) {
    for (const floor of preset.map.floors) {
      for (const room of floor.rooms) {
        const label = `${preset.id}/${room.name}`;
        assert.ok(
          Number.isInteger(room.width) && room.width >= 1 && room.width <= ROOM_MAX_SIDE &&
          Number.isInteger(room.height) && room.height >= 1 && room.height <= ROOM_MAX_SIDE,
          `${label}: tamaño fuera de rango`
        );
        const { inside, usable } = roomCells(room);

        for (const [col, row] of room.disabledCells ?? []) {
          assert.ok(inside(col, row), `${label}: casilla desactivada (${col},${row}) fuera de la sala`);
        }
        for (const layer of ['obstacleCells', 'spawnCells', 'lightCells']) {
          for (const [col, row] of room[layer] ?? []) {
            assert.ok(inside(col, row), `${label}: ${layer} (${col},${row}) fuera de la sala`);
            assert.ok(usable(col, row), `${label}: ${layer} (${col},${row}) sobre una casilla desactivada`);
          }
        }
        for (const [col, row, cost] of room.terrainCells ?? []) {
          assert.ok(inside(col, row), `${label}: terreno (${col},${row}) fuera de la sala`);
          assert.ok(Number.isInteger(cost) && cost >= 2 && cost <= 10, `${label}: coste de terreno no válido`);
        }
        for (const [col, row, level] of room.elevationCells ?? []) {
          assert.ok(inside(col, row), `${label}: elevación (${col},${row}) fuera de la sala`);
          assert.ok(
            Number.isInteger(level) && level !== 0 && level >= -10 && level <= 10,
            `${label}: nivel de elevación no válido`
          );
        }
        for (const [col, row, type] of room.fluidCells ?? []) {
          assert.ok(inside(col, row), `${label}: fluido (${col},${row}) fuera de la sala`);
          assert.ok(FLUID_TYPES.has(type), `${label}: fluido «${type}» desconocido`);
        }
        for (const [col, row, side] of room.wallEdges ?? []) {
          assert.ok(inside(col, row), `${label}: pared (${col},${row}) fuera de la sala`);
          assert.ok(['n', 'e', 's', 'o'].includes(side), `${label}: lado de pared «${side}» no válido`);
        }
      }
    }
  }
});

test('los marcadores están en casillas jugables y no se pisan entre sí', () => {
  for (const preset of SKIRMISH_PRESETS) {
    for (const floor of preset.map.floors) {
      for (const room of floor.rooms) {
        const label = `${preset.id}/${room.name}`;
        const { inside, usable } = roomCells(room);
        const obstacles = new Set((room.obstacleCells ?? []).map(([col, row]) => `${col},${row}`));
        const occupied = new Set();
        for (const token of room.tokens ?? []) {
          const key = `${token.x},${token.y}`;
          assert.ok(TOKEN_KINDS.has(token.kind ?? 'enemigo'), `${label}: tipo de marcador no válido`);
          assert.ok(inside(token.x, token.y), `${label}: «${token.name}» en (${key}) fuera de la sala`);
          assert.ok(usable(token.x, token.y), `${label}: «${token.name}» sobre una casilla desactivada`);
          assert.ok(!obstacles.has(key), `${label}: «${token.name}» sobre un obstáculo`);
          assert.ok(!occupied.has(key), `${label}: dos marcadores comparten la casilla ${key}`);
          occupied.add(key);
        }
        // Nadie aparece encima de un marcador ni sobre un obstáculo
        for (const [col, row] of room.spawnCells ?? []) {
          const key = `${col},${row}`;
          assert.ok(!occupied.has(key), `${label}: aparición ${key} ocupada por un marcador`);
          assert.ok(!obstacles.has(key), `${label}: aparición ${key} sobre un obstáculo`);
        }
      }
    }
  }
});

test('hay sitio de aparición para el aventurero en una sala revelada', () => {
  for (const preset of SKIRMISH_PRESETS) {
    const revealed = preset.map.floors.flatMap((floor) => floor.rooms).filter((room) => room.revealed);
    assert.ok(revealed.length > 0, `${preset.id}: ninguna sala empieza revelada`);
    assert.ok(
      revealed.every((room) => room.backgroundUrl === preset.previewUrl),
      `${preset.id}: la zona inicial debe mostrar la imagen del escenario`
    );
    const spawns = revealed.reduce((total, room) => total + (room.spawnCells ?? []).length, 0);
    assert.ok(spawns >= preset.players, `${preset.id}: solo ${spawns} puntos de aparición para ${preset.players}`);
  }
});

test('las puertas apuntan a salas reales y respetan sus reglas', () => {
  for (const preset of SKIRMISH_PRESETS) {
    for (const door of preset.map.doors ?? []) {
      const fromRoom = preset.map.floors[door.from?.[0]]?.rooms[door.from?.[1]];
      const toRoom = preset.map.floors[door.to?.[0]]?.rooms[door.to?.[1]];
      assert.ok(fromRoom && toRoom, `${preset.id}: puerta con salas inexistentes`);
      const label = `${preset.id}: ${fromRoom.name} → ${toRoom.name}`;

      // Las coordenadas de la puerta son absolutas del lienzo de la planta
      const insideRoom = (room, x, y) =>
        x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height;
      assert.ok(insideRoom(fromRoom, door.fromX, door.fromY), `${label}: origen fuera de la sala`);
      assert.ok(insideRoom(toRoom, door.toX, door.toY), `${label}: destino fuera de la sala`);

      if (door.kind === 'puerta') {
        const dx = door.toX - door.fromX;
        const dy = door.toY - door.fromY;
        assert.ok(
          (Math.abs(dx) === 1 && dy === 0) || (Math.abs(dy) === 1 && dx === 0),
          `${label}: una puerta necesita casillas contiguas`
        );
        assert.equal(door.from[0], door.to[0], `${label}: una puerta no cruza plantas`);
      } else {
        assert.notDeepEqual(door.from, door.to, `${label}: una escalera debe unir salas distintas`);
      }
    }
  }
});
