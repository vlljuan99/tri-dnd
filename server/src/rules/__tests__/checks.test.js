import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abilityCheckBonus,
  abilityForCheck,
  characterSaveBonus,
  checkDisadvantage,
  checkLabel,
  groupCheckSucceeds,
  skillCheckBonus,
} from '../checks.js';
import { resolveAttackEffects } from '../../services/combatRules.js';

const rogue = {
  kind: 'pj',
  level: 5,
  abilities: JSON.stringify({ str: 8, dex: 18, con: 12, int: 10, wis: 13, cha: 14 }),
  skill_proficiencies: JSON.stringify(['stealth', 'perception']),
  save_proficiencies: JSON.stringify(['dex', 'int']),
  inventory: '[]',
  armor_proficiencies: '[]',
};

test('bonificadores de prueba, habilidad y salvación del SRD', () => {
  assert.equal(abilityCheckBonus(rogue, 'dex'), 4);
  assert.equal(skillCheckBonus(rogue, 'stealth'), 7, 'DES +4 y competencia +3 a nivel 5');
  assert.equal(skillCheckBonus(rogue, 'athletics'), -1, 'sin competencia, solo FUE');
  assert.equal(skillCheckBonus(rogue, 'inventada'), 0);
  assert.equal(characterSaveBonus(rogue, 'dex'), 7);
  assert.equal(characterSaveBonus(rogue, 'con'), 1);
});

test('característica y nombre de una tirada pedida', () => {
  assert.equal(abilityForCheck({ habilidad: 'stealth' }), 'dex');
  assert.equal(abilityForCheck({ caracteristica: 'wis' }), 'wis');
  assert.equal(abilityForCheck({ caracteristica: 'suerte' }), null);
  assert.equal(checkLabel({ tipo: 'prueba', habilidad: 'stealth' }), 'Sigilo');
  assert.equal(checkLabel({ tipo: 'salvacion', caracteristica: 'dex' }), 'Salvación de Destreza');
  assert.equal(checkLabel({ tipo: 'prueba', caracteristica: 'str' }), 'Prueba de Fuerza');
});

test('prueba de grupo: basta con que la supere al menos la mitad', () => {
  assert.equal(groupCheckSucceeds(2, 4), true);
  assert.equal(groupCheckSucceeds(1, 4), false);
  assert.equal(groupCheckSucceeds(2, 3), true);
  assert.equal(groupCheckSucceeds(1, 3), false);
  assert.equal(groupCheckSucceeds(1, 1), true);
  assert.equal(groupCheckSucceeds(0, 0), false);
});

test('la armadura sin competencia da desventaja en FUE y DES, no en el resto', () => {
  const clumsy = {
    ...rogue,
    inventory: JSON.stringify([{ id: 'x', slot: 'armadura', armor: { armorCategory: 'Heavy' }, name: 'Cota de mallas' }]),
    armor_proficiencies: JSON.stringify([]),
  };
  assert.equal(checkDisadvantage(rogue, 'dex'), false);
  // El detalle de qué armadura cuenta vive en rules/proficiency.js; aquí basta
  // con que una prueba de SAB nunca la herede.
  assert.equal(checkDisadvantage(clumsy, 'wis'), false);
});

test('Ayudar da ventaja con motivo y se cancela con una desventaja', () => {
  const helped = resolveAttackEffects({ helpedBy: 'Aria', distance: 1 });
  assert.equal(helped.advantage, 'adv');
  assert.ok(helped.advantageReasons.includes('te ayuda Aria'));
  const cancelled = resolveAttackEffects({ helpedBy: 'Aria', attackerConditions: ['envenenado'], distance: 1 });
  assert.equal(cancelled.advantage, 'none');
  assert.equal(resolveAttackEffects({ distance: 1 }).advantage, 'none');
});
