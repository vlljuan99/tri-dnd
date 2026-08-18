// Normalización de la progresión de clase (Fase C). Solo la parte pura: lo que
// llega del SRD → la fila que se guarda. La lectura contra la base y la ruta
// se prueban en classProgression.integration.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classLevelRow, normalizeSpellSlots } from '../classProgression.js';

test('los espacios de conjuro salen siempre como nueve posiciones', () => {
  assert.deepEqual(
    normalizeSpellSlots({ spell_slots_level_1: 4, spell_slots_level_2: 2 }),
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    'los niveles que el SRD no publica valen 0, no undefined'
  );
  assert.deepEqual(normalizeSpellSlots(null), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('un nivel de mago conserva trucos, espacios y recursos propios', () => {
  const row = classLevelRow({
    level: 3,
    prof_bonus: 2,
    ability_score_bonuses: 0,
    spellcasting: { cantrips_known: 3, spell_slots_level_1: 4, spell_slots_level_2: 2 },
    class_specific: { arcane_recovery_levels: 2 },
    class: { index: 'wizard' },
  });

  assert.equal(row.classIndex, 'wizard');
  assert.equal(row.level, 3);
  assert.equal(row.cantripsKnown, 3);
  assert.equal(row.spellsKnown, null, 'el mago prepara, no conoce un número fijo');
  assert.deepEqual(row.spellSlots.slice(0, 3), [4, 2, 0]);
  assert.deepEqual(row.classSpecific, { arcane_recovery_levels: 2 });
});

test('una clase sin magia no inventa espacios de conjuro', () => {
  const row = classLevelRow({
    level: 5,
    prof_bonus: 3,
    ability_score_bonuses: 1,
    class_specific: { extra_attacks: 1 },
    class: { index: 'fighter' },
  });

  assert.deepEqual(row.spellSlots, [], 'sin bloque de lanzamiento no hay array de espacios');
  assert.equal(row.cantripsKnown, null);
  assert.equal(row.abilityScoreBonuses, 1);
});
