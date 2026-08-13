import test from 'node:test';
import assert from 'node:assert/strict';
import { bossActionsFor } from '../bossActions.js';
import { validateHazardDraft } from '../hazardZones.js';

test('las acciones de jefe conservan coste, guarida y reserva configurable', () => {
  const result = bossActionsFor({
    overrides: JSON.stringify({
      legendaryPointsMax: 4,
      legendaryActions: [
        { name: 'Coletazo', desc: 'Cuesta 2 acciones legendarias.', cost: 2 },
        { name: 'Detectar', desc: 'El dragón hace una prueba.' },
      ],
      lairActions: [{ name: 'Temblor', desc: 'La sala se sacude.' }],
    }),
  });
  assert.equal(result.maxPoints, 4);
  assert.deepEqual(result.legendary.map((action) => action.cost), [2, 1]);
  assert.equal(result.lair[0].cost, 0);
});

test('una zona temporal valida duración, salvación, dados y deduplica casillas', () => {
  const result = validateHazardDraft({
    name: 'Muro de fuego',
    visualType: 'fuego',
    triggerTiming: 'both',
    duration: 3,
    cells: [
      { floorId: 1, x: 3, y: 4 },
      { floorId: 1, x: 3, y: 4 },
      { floorId: 1, x: 4, y: 4 },
    ],
    saveAbility: 'dex',
    saveDc: 14,
    damageDice: '2d6',
    damageType: 'fire',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.cells.length, 2);
  assert.equal(result.value.duration, 3);
});

test('una zona rechaza fórmulas o duraciones manipuladas', () => {
  assert.match(validateHazardDraft({ name: 'X', duration: 0, cells: [] }).error, /durar/);
  assert.match(validateHazardDraft({
    name: 'X', duration: 2, cells: [{ floorId: 1, x: 0, y: 0 }], damageDice: '999d999',
  }).error, /dados/);
});
