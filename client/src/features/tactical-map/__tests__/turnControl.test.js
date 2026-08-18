import test from 'node:test';
import assert from 'node:assert/strict';
import { isOutOfCombat, movementBudget, turnControl } from '../domain/turnControl.js';

const vivo = { id: 7, kind: 'pj', speed: 30, movedSquares: 0, conditions: [] };

test('el presupuesto sale de la velocidad y Correr lo dobla', () => {
  assert.equal(movementBudget({ speed: 30 }), 6);
  assert.equal(movementBudget({ speed: 30, dashed: true }), 12);
  assert.equal(movementBudget({}, 25), 5, 'la velocidad del token vale de respaldo');
  assert.equal(movementBudget({}, null), null, 'sin velocidad no se inventa presupuesto');
});

test('en tu turno y entero puedes moverte y actuar', () => {
  const gate = turnControl({ combatant: vivo, combatActive: true, turnId: 7 });
  assert.equal(gate.move.allowed, true);
  assert.equal(gate.act.allowed, true);
  assert.deepEqual([gate.budget, gate.remaining, gate.spent], [6, 6, 0]);
});

test('un personaje inconsciente no se mueve ni actúa, ni siquiera en modo libre', () => {
  const agonizando = { ...vivo, downed: true, dying: true };
  for (const combatActive of [true, false]) {
    const gate = turnControl({ combatant: agonizando, combatActive, turnId: 7 });
    assert.equal(gate.move.allowed, false);
    assert.equal(gate.act.allowed, false);
    assert.equal(gate.move.reason, 'inconsciente');
  }
});

test('el muerto se explica como muerto, no como inconsciente', () => {
  const gate = turnControl({ combatant: { ...vivo, downed: true, dead: true }, combatActive: true, turnId: 7 });
  assert.match(gate.move.message, /ha muerto/);
});

test('gastar todo el movimiento bloquea el movimiento pero no la acción', () => {
  const gate = turnControl({ combatant: { ...vivo, movedSquares: 6 }, combatActive: true, turnId: 7 });
  assert.equal(gate.remaining, 0);
  assert.equal(gate.move.allowed, false);
  assert.equal(gate.move.reason, 'sin-movimiento');
  assert.equal(gate.act.allowed, true);
});

test('las casillas de más no dejan el gasto por encima del presupuesto', () => {
  // Correr y luego perder el efecto puede dejar `movedSquares` por encima del
  // presupuesto vigente: el HUD debe seguir pintando 6 de 6, nunca 9 de 6.
  const gate = turnControl({ combatant: { ...vivo, movedSquares: 9 }, combatActive: true, turnId: 7 });
  assert.deepEqual([gate.budget, gate.remaining, gate.spent], [6, 0, 6]);
});

test('fuera de tu turno se bloquean las dos cosas', () => {
  const gate = turnControl({ combatant: vivo, combatActive: true, turnId: 99 });
  assert.equal(gate.move.reason, 'turno');
  assert.equal(gate.act.reason, 'turno');
});

test('la acción gastada solo bloquea la acción', () => {
  const gate = turnControl({ combatant: { ...vivo, actionUsed: true }, combatActive: true, turnId: 7 });
  assert.equal(gate.move.allowed, true);
  assert.equal(gate.act.reason, 'accion-gastada');
});

test('las condiciones bloquean por separado movimiento y acción', () => {
  const apresado = turnControl({ combatant: { ...vivo, conditions: ['apresado'] }, combatActive: true, turnId: 7 });
  assert.equal(apresado.move.reason, 'condiciones');
  assert.equal(apresado.act.allowed, true, 'apresado impide moverse, no actuar');

  const aturdido = turnControl({ combatant: { ...vivo, conditions: ['aturdido'] }, combatActive: true, turnId: 7 });
  assert.equal(aturdido.move.reason, 'condiciones');
  assert.equal(aturdido.act.reason, 'condiciones');
});

test('en modo libre solo mandan las condiciones', () => {
  const libre = turnControl({ combatant: { ...vivo, movedSquares: 99 }, combatActive: false, turnId: null });
  assert.equal(libre.move.allowed, true);

  const paralizado = turnControl({ combatant: { ...vivo, conditions: ['paralizado'] }, combatActive: false });
  assert.equal(paralizado.move.allowed, false);
  assert.equal(paralizado.act.allowed, false);
});

test('el DM coloca fichas de personaje sin restricción, incluso cuerpos', () => {
  // La ruta de mover personajes se salta camino y presupuesto para el DM.
  const gate = turnControl({
    combatant: { ...vivo, downed: true, dead: true, movedSquares: 30 },
    combatActive: true,
    turnId: 99,
    freeMovement: true,
  });
  assert.equal(gate.move.allowed, true);
});

test('pero jugar un enemigo pasa por las mismas reglas que cualquiera', () => {
  // `trySpecialAction` y `trySpendEnemyMovement` no tienen excepción para el
  // DM: un enemigo aturdido no corre ni esquiva aunque lo mueva él.
  const aturdido = { id: 3, kind: 'enemigo', speed: 30, movedSquares: 0, conditions: ['aturdido'] };
  const gate = turnControl({ combatant: aturdido, combatActive: true, turnId: 3, freeMovement: false });
  assert.equal(gate.act.reason, 'condiciones');
  assert.equal(gate.move.reason, 'condiciones');

  const fueraDeTurno = turnControl({ combatant: { ...aturdido, conditions: [] }, combatActive: true, turnId: 99 });
  assert.equal(fueraDeTurno.act.reason, 'turno');
});

test('un enemigo a 0 PG está fuera de combate sin salvaciones de muerte', () => {
  const caido = { id: 3, kind: 'enemigo', speed: 30, hpCurrent: 0, hpMax: 13, conditions: [] };
  assert.equal(isOutOfCombat(caido), true);
  assert.equal(isOutOfCombat({ ...caido, hpCurrent: 4 }), false);
  const gate = turnControl({ combatant: caido, combatActive: true, turnId: 3 });
  assert.equal(gate.move.reason, 'inconsciente');
  assert.match(gate.move.message, /fuera de combate/);
});

test('sin combatiente en el tracker no se bloquea el tablero', () => {
  const gate = turnControl({ combatant: null, speed: 30, combatActive: true, turnId: 7 });
  assert.equal(gate.move.allowed, true);
  assert.equal(gate.budget, 6);
});
