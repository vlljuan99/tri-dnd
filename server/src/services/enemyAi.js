// Decisiones tácticas de la IA enemiga. Este módulo no toca SQLite ni emite
// sockets: recibe un estado ya filtrado por el servidor y devuelve un plan
// determinista (objetivo, camino y ataque). Así se puede probar sin arrancar
// una mesa y la ejecución sensible sigue viviendo en sockets.js.

import { monsterAttackGeometry, rangeValidation } from './combatGeometry.js';
import { findPath } from './pathfinding.js';
import { parseDiceNotation } from './serverDice.js';
import { hasLineOfSight } from './vision.js';

function expectedDice(notation) {
  const parsed = parseDiceNotation(notation);
  if (!parsed) return 0;
  return parsed.number * ((parsed.sides + 1) / 2) + parsed.modifier;
}

export function normalizeEnemyAttacks(data, overrides = {}) {
  const attackDelta = Number.isInteger(overrides.attackBonus) ? overrides.attackBonus : 0;
  const damageDelta = Number.isInteger(overrides.damageBonus) ? overrides.damageBonus : 0;
  return (data?.actions ?? [])
    .filter((action) => Number.isInteger(action.attack_bonus))
    .map((action) => {
      const damage = (action.damage ?? [])
        .filter((component) => parseDiceNotation(component.damage_dice))
        .map((component, index) => ({
          dice: component.damage_dice,
          type: component.damage_type?.index ?? null,
          modifier: index === 0 ? damageDelta : 0,
        }));
      return {
        name: action.name,
        bonus: action.attack_bonus + attackDelta,
        geometry: monsterAttackGeometry(action),
        damage,
        expectedDamage: damage.reduce(
          (total, component) => total + expectedDice(component.dice) + component.modifier,
          0
        ),
      };
    });
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function compareTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function attackFrom(position, target, attacks, rooms, doors) {
  if (
    !hasLineOfSight({
      rooms,
      doors,
      from: position,
      to: target,
    })
  ) {
    return null;
  }
  const squares = distance(position, target);
  return attacks
    .map((attack) => {
      const range = rangeValidation(squares, attack.geometry);
      return range.ok ? { attack, longRange: Boolean(range.longRange) } : null;
    })
    .filter(Boolean)
    .sort((left, right) =>
      compareTuple(
        [Number(left.longRange), -left.attack.expectedDamage, -left.attack.bonus],
        [Number(right.longRange), -right.attack.expectedDamage, -right.attack.bonus]
      )
    )[0] ?? null;
}

function reachableCells({ attacker, walkable, walls, elevation, occupied, maxMove }) {
  const grid = new Map(walkable);
  for (const key of occupied ?? []) {
    if (key !== `${attacker.x},${attacker.y}`) grid.delete(key);
  }
  const cells = [{ x: attacker.x, y: attacker.y, cost: 0, path: [] }];
  for (const key of grid.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (x === attacker.x && y === attacker.y) continue;
    const route = findPath(grid, attacker, { x, y }, maxMove, walls, elevation);
    if (route) cells.push({ x, y, cost: route.cost, path: route.path });
  }
  return cells;
}

/**
 * Elige la mejor jugada básica del turno.
 *
 * Prioridades: poder atacar > evitar la banda larga > gastar menos movimiento
 * > PJ más herido > mayor daño esperado. Si nadie queda a alcance tras mover,
 * avanza hacia el PJ más cercano sin exceder la velocidad.
 */
export function decideEnemyTurn({
  attacker,
  targets,
  monsterData,
  overrides = {},
  walkable,
  walls = null,
  elevation = null,
  rooms = [],
  doors = [],
  occupied = new Set(),
  maxMove = 6,
}) {
  if (!attacker || !targets?.length) return null;
  const attacks = normalizeEnemyAttacks(monsterData, overrides);
  const reachable = reachableCells({ attacker, walkable, walls, elevation, occupied, maxMove });
  let best = null;

  for (const target of targets) {
    for (const cell of reachable) {
      const option = attackFrom(cell, target, attacks, rooms, doors);
      const hpRatio = target.hpMax > 0 ? target.hpCurrent / target.hpMax : 1;
      const score = option
        ? [0, Number(option.longRange), cell.cost, hpRatio, -option.attack.expectedDamage]
        : [1, distance(cell, target), cell.cost, hpRatio, 0];
      if (!best || compareTuple(score, best.score) < 0) {
        best = {
          score,
          target,
          destination: { x: cell.x, y: cell.y },
          path: cell.path,
          moveCost: cell.cost,
          attack: option?.attack ?? null,
          longRange: option?.longRange ?? false,
        };
      }
    }
  }
  return best;
}
