import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitiativeStrip } from '../domain/initiativeStrip.js';

const tokens = [
  { id: 'pj-3', characterId: 3, name: 'Elara', imageUrl: '/elara.webp', ownerUserId: 7, hp: 12, hpMax: 20 },
  { id: 'srv-9', serverId: 9, name: 'Goblin', hp: 4, hpMax: 7 },
];

test('empareja cada combatiente con su token por personaje o por marcador', () => {
  const strip = buildInitiativeStrip({
    combatants: [
      { id: 1, kind: 'pj', name: 'Elara', characterId: 3, hpCurrent: 12, hpMax: 20 },
      { id: 2, kind: 'enemigo', name: 'Goblin', mapTokenId: 9 },
    ],
    tokens,
    turnId: 1,
    userId: 7,
  });

  assert.equal(strip[0].tokenId, 'pj-3');
  assert.equal(strip[0].imageUrl, '/elara.webp');
  assert.equal(strip[1].tokenId, 'srv-9');
  // El orden llega ya resuelto por el servidor y no se reordena aquí
  assert.deepEqual(strip.map((c) => c.id), [1, 2]);
});

test('marca el turno activo y los personajes propios', () => {
  const strip = buildInitiativeStrip({
    combatants: [
      { id: 1, kind: 'pj', name: 'Elara', characterId: 3 },
      { id: 2, kind: 'enemigo', name: 'Goblin', mapTokenId: 9 },
    ],
    tokens,
    turnId: 2,
    userId: 7,
  });

  assert.deepEqual(strip.map((c) => c.active), [false, true]);
  assert.deepEqual(strip.map((c) => c.mine), [true, false]);
});

test('un PJ de otro jugador no se marca como propio', () => {
  const [entry] = buildInitiativeStrip({
    combatants: [{ id: 1, kind: 'pj', name: 'Elara', characterId: 3 }],
    tokens,
    userId: 99,
  });
  assert.equal(entry.mine, false);
});

test('sin PG en el combatiente se usan los del token visible', () => {
  // Un jugador no recibe los PG del enemigo en el tracker, pero sí la barra
  // del token que ya ve en el tablero: la tira enseña exactamente eso.
  const [entry] = buildInitiativeStrip({
    combatants: [{ id: 2, kind: 'enemigo', name: 'Goblin', mapTokenId: 9 }],
    tokens,
  });
  assert.deepEqual(entry.hp, { current: 4, max: 7, temp: 0, ratio: 4 / 7 });
});

test('sin PG por ningún lado no se inventa barra de vida', () => {
  const [entry] = buildInitiativeStrip({
    combatants: [{ id: 5, kind: 'enemigo', name: 'Sombra', mapTokenId: 44 }],
    tokens,
  });
  assert.equal(entry.hp, null);
  assert.equal(entry.tokenId, null, 'sin token no hay nada que seleccionar');
  assert.equal(entry.name, 'Sombra', 'el nombre sale del tracker, que sí es público');
});

test('los PG temporales viajan aparte para no falsear la proporción', () => {
  const [entry] = buildInitiativeStrip({
    combatants: [{ id: 1, kind: 'pj', name: 'Elara', characterId: 3, hpCurrent: 10, hpMax: 20, hpTemp: 5 }],
    tokens,
  });
  assert.equal(entry.hp.temp, 5);
  assert.equal(entry.hp.ratio, 0.5);
});

test('distingue agonizante, estable y muerto de verdad', () => {
  const strip = buildInitiativeStrip({
    combatants: [
      { id: 1, kind: 'pj', name: 'A', downed: true, dying: true, deathSaves: { successes: 1, failures: 2 } },
      { id: 2, kind: 'pj', name: 'B', downed: true, stable: true },
      { id: 3, kind: 'pj', name: 'C', downed: true, dead: true },
      { id: 4, kind: 'pj', name: 'D', hpCurrent: 8, hpMax: 8 },
    ],
    tokens: [],
  });
  assert.deepEqual(strip.map((c) => c.state), ['dying', 'stable', 'dead', 'normal']);
  assert.deepEqual(strip[0].deathSaves, { successes: 1, failures: 2 });
});

test('un enemigo a 0 PG cuenta como muerto sin salvaciones de por medio', () => {
  const [entry] = buildInitiativeStrip({
    combatants: [{ id: 2, kind: 'enemigo', name: 'Goblin', hpCurrent: 0, hpMax: 7 }],
    tokens: [],
  });
  assert.equal(entry.state, 'dead');
});

test('sin combatientes la tira queda vacía', () => {
  assert.deepEqual(buildInitiativeStrip({}), []);
  assert.deepEqual(buildInitiativeStrip(), []);
});
