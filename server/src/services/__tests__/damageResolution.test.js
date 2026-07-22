import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absorbTemporaryHitPoints,
  damageDetailForViewer,
  damageAdjustmentText,
  resolveDamageComponents,
  sanitizeDamageComponents,
} from '../damageResolution.js';

test('resistencia redondea hacia abajo, vulnerabilidad duplica e inmunidad anula', () => {
  const result = resolveDamageComponents(
    [
      { amount: 5, type: 'slashing' },
      { amount: 3, type: 'fire' },
      { amount: 7, type: 'poison' },
    ],
    { resistances: ['slashing'], vulnerabilities: ['fire'], immunities: ['poison'] }
  );
  assert.equal(result.appliedTotal, 8);
  assert.deepEqual(result.components.map((c) => c.applied), [2, 6, 0]);
  assert.deepEqual(damageAdjustmentText(result.components), [
    'resistencia: cortante',
    'vulnerabilidad: fuego',
    'inmunidad: veneno',
  ]);
});

test('resistencia y vulnerabilidad simultáneas se cancelan', () => {
  const result = resolveDamageComponents(
    [{ amount: 9, type: 'cold' }],
    { resistances: ['cold'], vulnerabilities: ['cold'] }
  );
  assert.equal(result.appliedTotal, 9);
  assert.equal(result.components[0].adjustment, 'cancelled');
});

test('los calificadores de ataques no mágicos no afectan a caídas ni armas mágicas', () => {
  const profile = { resistances: ["bludgeoning, piercing, and slashing from nonmagical attacks"] };
  assert.equal(
    resolveDamageComponents([{ amount: 8, type: 'bludgeoning', magical: false }], profile, { source: 'attack' })
      .appliedTotal,
    4
  );
  assert.equal(
    resolveDamageComponents([{ amount: 8, type: 'bludgeoning', magical: true }], profile, { source: 'attack' })
      .appliedTotal,
    8
  );
  assert.equal(
    resolveDamageComponents([{ amount: 8, type: 'bludgeoning', magical: false }], profile, { source: 'fall' })
      .appliedTotal,
    8
  );
});

test('petrificado concede resistencia a todos los tipos conocidos', () => {
  const result = resolveDamageComponents([{ amount: 11, type: null }], { petrified: true });
  assert.equal(result.appliedTotal, 5);
});

test('los PG temporales absorben antes de tocar los PG reales', () => {
  assert.deepEqual(absorbTemporaryHitPoints(12, 5), {
    absorbed: 5,
    remainingTemporaryHitPoints: 0,
    hitPointDamage: 7,
  });
  assert.deepEqual(absorbTemporaryHitPoints(3, 8), {
    absorbed: 3,
    remainingTemporaryHitPoints: 5,
    hitPointDamage: 0,
  });
});

test('la respuesta a un jugador no revela los PG exactos de un enemigo', () => {
  const detail = {
    damage: 7,
    tempAbsorbed: 3,
    remainingTempHp: 2,
    remainingHp: 19,
    maxHp: 42,
    defeated: false,
  };
  assert.deepEqual(damageDetailForViewer(detail, { enemy: true, isDm: false }), {
    damage: 7,
    tempAbsorbed: true,
    remainingTempHp: null,
    remainingHp: null,
    maxHp: null,
    defeated: false,
  });
  assert.equal(damageDetailForViewer(detail, { enemy: true, isDm: true }), detail);
});

test('el servidor exige que el desglose coincida con el total y los tipos canónicos', () => {
  assert.equal(sanitizeDamageComponents([{ amount: 4, type: 'fire' }], 5).error, 'El desglose de daño no coincide con la tirada');
  assert.equal(sanitizeDamageComponents([{ amount: 5, type: 'agua' }], 5).error, 'Tipo de daño no válido');
  assert.deepEqual(
    sanitizeDamageComponents([{ amount: 5, type: 'fire' }], 5, { forcedTypes: ['cold'] }).components,
    [{ amount: 5, type: 'cold', magical: false, silvered: false, adamantine: false }]
  );
});
