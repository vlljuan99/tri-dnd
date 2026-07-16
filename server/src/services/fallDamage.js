// Daño de caída 5e: 1d6 por cada 10 pies, con el máximo habitual de 20d6.
// La tirada se construye en el servidor para que un cliente no pueda elegir
// el resultado y usa la misma forma que el resto de tiradas del chat.

export const MIN_FALL_FEET = 10;
export const MAX_FALL_FEET = 200;

export function fallDiceForFeet(feet) {
  const value = Number(feet);
  if (!Number.isInteger(value) || value < MIN_FALL_FEET || value > MAX_FALL_FEET || value % 10 !== 0) {
    return null;
  }
  return Math.min(20, value / 10);
}

export function buildFallDamageRoll({ feet, targetName, random = Math.random }) {
  const dice = fallDiceForFeet(feet);
  if (!dice) throw new Error('Altura de caída no válida');

  const results = [];
  let total = 0;
  for (let i = 0; i < dice; i += 1) {
    const sample = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    const value = 1 + Math.floor(sample * 6);
    results.push({ rolls: [value], kept: value });
    total += value;
  }

  return {
    kind: 'damage',
    label: `Daño por caída (${feet} pies)`,
    actorName: targetName || null,
    formula: `${dice}d6`,
    groups: [{ die: 'd6', sides: 6, results }],
    modifier: 0,
    advantage: 'none',
    total,
    crit: false,
    fumble: false,
  };
}
