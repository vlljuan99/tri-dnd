import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeLabel,
  targetRangeState,
  unarmedSlot,
  weaponRangeCells,
  weaponSlots,
} from '../domain/weaponSlots.js';

const espada = {
  id: 1,
  name: 'Espada larga',
  slot: 'mano-principal',
  weapon: { damageDice: '1d8', weaponRange: 'Melee', properties: ['versatile'], ability: 'str' },
};
const arco = {
  id: 2,
  name: 'Arco corto',
  slot: 'mano-secundaria',
  weapon: {
    damageDice: '1d6',
    weaponRange: 'Ranged',
    properties: ['ammunition'],
    range: { normal: 80, long: 320 },
    ability: 'dex',
  },
};
const lanza = {
  id: 3,
  name: 'Jabalina',
  slot: 'mano-principal',
  weapon: { damageDice: '1d6', weaponRange: 'Melee', properties: ['thrown'], throwRange: { normal: 30, long: 120 } },
};
const guardada = { id: 4, name: 'Daga guardada', slot: null, weapon: { damageDice: '1d4' } };

const heroina = {
  level: 5,
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  proficiencies: { weapons: [] },
  inventory: [espada, arco, lanza, guardada],
};

// Escudo y mochila: ocupan inventario, pero no son armas con las que atacar.
const escudera = {
  ...heroina,
  inventory: [
    { id: 10, name: 'Maza', slot: 'mano-principal', weapon: { damageDice: '1d6', weaponRange: 'Melee', properties: [] } },
    { id: 11, name: 'Escudo', slot: 'escudo', armor: { category: 'Shield' } },
    { id: 12, name: 'Ballesta guardada', slot: null, weapon: { damageDice: '1d8', weaponRange: 'Ranged', properties: [] } },
  ],
};

test('solo entran al hotbar las armas equipadas, y el puño siempre cierra la fila', () => {
  const slots = weaponSlots(heroina);
  assert.deepEqual(slots.map((s) => s.name), ['Espada larga', 'Arco corto', 'Jabalina', 'Golpe desarmado']);
  assert.equal(slots.at(-1).unarmed, true);
});

test('solo llegan al hotbar las armas que llevas en las manos', () => {
  const nombres = weaponSlots(escudera).map((slot) => slot.name);
  assert.deepEqual(nombres, ['Maza', 'Golpe desarmado'], 'ni el escudo ni lo guardado son armas del hotbar');
});

test('cada slot sabe su geometría sin abrir el panel de ataque', () => {
  const [espadaSlot, arcoSlot, lanzaSlot] = weaponSlots(heroina);
  assert.equal(espadaSlot.geometry.ranged, false);
  assert.equal(espadaSlot.geometry.reach, 1);
  assert.equal(arcoSlot.geometry.ranged, true);
  assert.deepEqual([arcoSlot.geometry.normalRange, arcoSlot.geometry.longRange], [16, 64]);
  assert.equal(lanzaSlot.thrown, true, 'la arrojadiza se marca para ofrecer el modo lanzar');
});

test('el golpe desarmado sale de la ficha, no de una constante', () => {
  const slot = unarmedSlot(heroina);
  assert.equal(slot.attackBonus, 3 + 3, 'FUE +3 y competencia +3 a nivel 5');
  assert.equal(slot.damageLabel, '4 contundente');
});

test('la etiqueta de alcance se lee en pies, como en la ficha', () => {
  assert.equal(rangeLabel({ ranged: false, reach: 1 }), 'Cuerpo a cuerpo · 5 pies');
  assert.equal(rangeLabel({ ranged: false, reach: 2 }), 'Cuerpo a cuerpo · 10 pies');
  assert.equal(rangeLabel({ ranged: true, normalRange: 16, longRange: 64 }), 'A distancia · 80/320 pies');
  assert.equal(rangeLabel({ ranged: true, normalRange: 4, longRange: 4 }), 'A distancia · 20 pies');
});

test('el arco distingue alcance, distancia larga y fuera de alcance', () => {
  const geometria = { ranged: true, reach: 0, normalRange: 16, longRange: 64 };
  assert.equal(targetRangeState(10, geometria).state, 'alcance');
  assert.equal(targetRangeState(30, geometria).state, 'larga');
  assert.match(targetRangeState(30, geometria).label, /desventaja/);
  assert.equal(targetRangeState(30, geometria).canAttack, true, 'a distancia larga se dispara, con desventaja');
  assert.equal(targetRangeState(70, geometria).state, 'fuera');
  assert.equal(targetRangeState(70, geometria).canAttack, false);
});

test('el arma cuerpo a cuerpo dice que hay que acercarse', () => {
  const geometria = { ranged: false, reach: 1 };
  assert.equal(targetRangeState(1, geometria).label, 'Cuerpo a cuerpo');
  const lejos = targetRangeState(4, geometria);
  assert.equal(lejos.state, 'fuera');
  assert.match(lejos.label, /acércate/);
});

test('sin línea de visión no se ataca aunque sobre alcance', () => {
  const estado = targetRangeState(2, { ranged: true, normalRange: 16, longRange: 64 }, { lineOfSight: false });
  assert.equal(estado.state, 'sin-vision');
  assert.equal(estado.canAttack, false);
});

// Sala 9x5 con una columna en (4,2): el tablero mínimo para comprobar que el
// alcance se recorta por lo que hay en medio y no por la distancia sola.
const sala = {
  width: 9,
  height: 5,
  gridSize: 1,
  disabledCells: [],
  rooms: [{ col: 0, row: 0, width: 9, height: 5, obstacleCells: [[4, 2]] }],
};

test('el alcance cuerpo a cuerpo son las casillas de alrededor', () => {
  const { normal, long } = weaponRangeCells(sala, { col: 1, row: 2 }, { ranged: false, reach: 1 });
  assert.equal(normal.length, 8, 'las ocho de alrededor, sin la propia');
  assert.equal(normal.some((c) => c.col === 1 && c.row === 2), false);
  assert.deepEqual(long, [], 'un arma cuerpo a cuerpo no tiene distancia larga');
});

test('el arma de alcance largo llega dos casillas', () => {
  const { normal } = weaponRangeCells(sala, { col: 1, row: 2 }, { ranged: false, reach: 2 });
  assert.equal(normal.some((c) => c.col === 3 && c.row === 2), true);
});

test('el arco separa su alcance normal de la distancia larga', () => {
  const geometria = { ranged: true, reach: 0, normalRange: 2, longRange: 4 };
  const { normal, long } = weaponRangeCells(sala, { col: 0, row: 0 }, geometria);
  const en = (lista, col, row) => lista.some((c) => c.col === col && c.row === row);
  assert.equal(en(normal, 2, 0), true, 'a dos casillas, alcance normal');
  assert.equal(en(long, 4, 0), true, 'a cuatro, distancia larga');
  assert.equal(en(normal, 4, 0), false);
  assert.equal(en(long, 8, 0), false, 'más allá del alcance largo no se pinta nada');
});

test('una columna recorta el alcance y deja su sombra detrás', () => {
  // Tirando desde (2,2) contra la columna de (4,2): la casilla del obstáculo se
  // ve (le puedes disparar), pero la de detrás en la misma línea queda tapada.
  const geometria = { ranged: true, reach: 0, normalRange: 6, longRange: 6 };
  const { normal } = weaponRangeCells(sala, { col: 2, row: 2 }, geometria);
  const en = (col, row) => normal.some((c) => c.col === col && c.row === row);
  assert.equal(en(4, 2), true, 'la propia columna sí es alcanzable');
  assert.equal(en(5, 2), false, 'lo que queda justo detrás, no');
  assert.equal(en(5, 0), true, 'rodeando la columna sí hay tiro');
});

test('sin mapa, sin origen o sin arma no se pinta nada', () => {
  assert.deepEqual(weaponRangeCells(null, { col: 0, row: 0 }, { ranged: true, normalRange: 4 }), { normal: [], long: [] });
  assert.deepEqual(weaponRangeCells(sala, null, { ranged: true, normalRange: 4 }), { normal: [], long: [] });
  assert.deepEqual(weaponRangeCells(sala, { col: 0, row: 0 }, null), { normal: [], long: [] });
});
