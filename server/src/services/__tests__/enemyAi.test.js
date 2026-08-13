import test from 'node:test';
import assert from 'node:assert/strict';
import { decideEnemyTurn, normalizeEnemyAttacks } from '../enemyAi.js';
import { buildWalkableGrid } from '../pathfinding.js';

function room(width = 12, height = 8) {
  return {
    id: 1,
    floor_id: 1,
    x: 0,
    y: 0,
    width,
    height,
    disabled_cells: '[]',
    obstacle_cells: '[]',
    terrain_cells: '[]',
    elevation_cells: '[]',
    fluid_cells: '[]',
    wall_edges: '[]',
  };
}

const meleeMonster = {
  actions: [
    {
      name: 'Espada',
      attack_bonus: 5,
      desc: 'Melee Weapon Attack: reach 5 ft., one target.',
      damage: [{ damage_dice: '1d8+3', damage_type: { index: 'slashing' } }],
    },
  ],
};

test('un enemigo cuerpo a cuerpo avanza hasta quedar a alcance sin pisar al PJ', () => {
  const battlefield = room();
  const decision = decideEnemyTurn({
    attacker: { x: 1, y: 2 },
    targets: [{ id: 7, name: 'Alda', x: 6, y: 2, hpCurrent: 18, hpMax: 24 }],
    monsterData: meleeMonster,
    walkable: buildWalkableGrid([battlefield]),
    rooms: [battlefield],
    occupied: new Set(['1,2', '6,2']),
    maxMove: 4,
  });

  assert.equal(decision.target.id, 7);
  assert.equal(
    Math.max(Math.abs(decision.destination.x - 6), Math.abs(decision.destination.y - 2)),
    1,
    'debe terminar a alcance cuerpo a cuerpo'
  );
  assert.equal(decision.moveCost, 4);
  assert.equal(decision.attack.name, 'Espada');
  assert.ok(!decision.path.some((cell) => cell.x === 6 && cell.y === 2));
});

test('un arquero con línea de visión prefiere disparar sin moverse', () => {
  const battlefield = room();
  const archer = {
    actions: [
      {
        name: 'Arco corto',
        attack_bonus: 4,
        desc: 'Ranged Weapon Attack: range 80/320 ft., one target.',
        damage: [{ damage_dice: '1d6+2', damage_type: { index: 'piercing' } }],
      },
    ],
  };
  const decision = decideEnemyTurn({
    attacker: { x: 1, y: 1 },
    targets: [{ id: 9, name: 'Bran', x: 9, y: 1, hpCurrent: 30, hpMax: 30 }],
    monsterData: archer,
    walkable: buildWalkableGrid([battlefield]),
    rooms: [battlefield],
    occupied: new Set(['1,1', '9,1']),
    maxMove: 6,
  });

  assert.deepEqual(decision.destination, { x: 1, y: 1 });
  assert.equal(decision.moveCost, 0);
  assert.equal(decision.attack.name, 'Arco corto');
  assert.equal(decision.longRange, false);
});

test('los ajustes de instancia alteran ataque y daño sin confiar en el cliente', () => {
  const [attack] = normalizeEnemyAttacks(meleeMonster, { attackBonus: 2, damageBonus: 4 });
  assert.equal(attack.bonus, 7);
  assert.deepEqual(attack.damage, [{ dice: '1d8+3', type: 'slashing', modifier: 4 }]);
  assert.equal(attack.expectedDamage, 11.5);
});
