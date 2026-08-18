// Reglas de percepción activa de la Fase 10.5. La tirada se construye en el
// servidor para que el cliente no pueda elegir el resultado ni conocer las
// trampas o sus CD antes de descubrirlas.

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '') ?? fallback;
  } catch {
    return fallback;
  }
}

// Única definición real en rules/abilities.js (Fase B); se reexporta para no
// tocar los sitios que ya importan estas dos funciones desde aquí.
export { abilityModifier, proficiencyBonus } from '../rules/abilities.js';
import { abilityModifier, proficiencyBonus } from '../rules/abilities.js';

export function perceptionBonus(character) {
  const abilities = parseJson(character?.abilities, {});
  const proficiencies = parseJson(character?.skill_proficiencies, []);
  return abilityModifier(abilities.wis) +
    (proficiencies.includes('perception') ? proficiencyBonus(character?.level) : 0);
}

export function buildPerceptionRoll(character, random = Math.random) {
  const kept = Math.floor(random() * 20) + 1;
  const modifier = perceptionBonus(character);
  return {
    formula: `1d20${modifier >= 0 ? '+' : ''}${modifier}`,
    label: 'Percepción',
    actorName: character.name,
    groups: [{ die: 'd20', sides: 20, results: [{ rolls: [kept], kept }] }],
    modifier,
    total: kept + modifier,
  };
}

export function discoverableTrapIds(traps, visibleCells, total) {
  return traps
    .filter((trap) => visibleCells.has(`${trap.x},${trap.y}`))
    .filter((trap) => total >= (trap.perception_dc ?? 10))
    .map((trap) => trap.id);
}
