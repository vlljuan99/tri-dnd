import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOMMENDED_FLUID_EFFECTS,
  mergeFluidEffects,
  normalizeFluidEffects,
} from '../fluidRules.js';
import { buildWalkableGrid } from '../pathfinding.js';

test('un mapa sin ajustes recibe las cinco reglas recomendadas', () => {
  const effects = normalizeFluidEffects('{}');
  assert.deepEqual(effects, RECOMMENDED_FLUID_EFFECTS);
  assert.equal(effects.agua.movementCost, 2);
  assert.equal(effects.lava.damageDice, '2d6');
  assert.equal(effects.niebla.visionRadius, 2);
});

test('el DM puede cambiar una propiedad sin perder las demás recomendaciones', () => {
  const result = mergeFluidEffects('{}', { lava: { damageDice: '4d6', saveAbility: 'dex', saveDc: 15 } });
  assert.equal(result.error, undefined);
  assert.equal(result.effects.lava.damageDice, '4d6');
  assert.equal(result.effects.lava.saveAbility, 'dex');
  assert.equal(result.effects.lava.movementCost, 2);
  assert.deepEqual(result.effects.agua, RECOMMENDED_FLUID_EFFECTS.agua);
});

test('rechaza fórmulas y rangos manipulados', () => {
  assert.match(mergeFluidEffects('{}', { lava: { damageDice: 'mucho' } }).error, /fórmula/);
  assert.match(mergeFluidEffects('{}', { agua: { movementCost: 99 } }).error, /movimiento/);
  assert.match(mergeFluidEffects('{}', { niebla: { visionRadius: 0 } }).error, /visión/);
});

test('el coste recomendado del fluido entra en el pathfinding del servidor', () => {
  const room = {
    x: 0, y: 0, width: 3, height: 1,
    disabled_cells: '[]', obstacle_cells: '[]', terrain_cells: '[]', elevation_cells: '[]',
    fluid_cells: JSON.stringify([[1, 0, 'agua'], [2, 0, 'lava']]),
  };
  const grid = buildWalkableGrid([room], '{}');
  assert.equal(grid.get('0,0'), 1);
  assert.equal(grid.get('1,0'), 2);
  assert.equal(grid.get('2,0'), 2);

  const custom = buildWalkableGrid([room], { lava: { movementCost: 5 } });
  assert.equal(custom.get('2,0'), 5);
});
