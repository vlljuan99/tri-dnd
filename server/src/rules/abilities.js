// Única definición de estas dos fórmulas en el servidor (Fase B): antes
// vivían duplicadas en concentration.js, perception.js, turnEconomy.js,
// opportunityAttacks.js y rules/equipment.js. Esos archivos ahora importan de
// aquí; el cliente conserva su propio espejo en client/src/lib/dnd.js.

export function abilityModifier(score) {
  return Math.floor(((Number.isFinite(score) ? Number(score) : 10) - 10) / 2);
}

export function proficiencyBonus(level) {
  const safeLevel = Number.isInteger(level) && level > 0 ? level : 1;
  return 2 + Math.floor((safeLevel - 1) / 4);
}
