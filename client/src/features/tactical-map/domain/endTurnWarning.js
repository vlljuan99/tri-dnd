// Aviso al terminar el turno con recursos sin gastar (Fase 5, añadido del
// 23-sep-2026). Puro: dice qué queda por usar; el HUD decide si pregunta.

/**
 * Lo que queda del turno, en palabras: ['la acción', 'la acción adicional',
 * '15 pies']. `remaining` son casillas de movimiento (5 pies cada una).
 */
export function unspentTurnResources({ combatant, remaining = null } = {}) {
  if (!combatant) return [];
  const left = [];
  if (!combatant.actionUsed) left.push('la acción');
  if (!combatant.bonusUsed) left.push('la acción adicional');
  if (Number.isInteger(remaining) && remaining > 0) left.push(`${remaining * 5} pies`);
  return left;
}

/** «Te quedan la acción adicional y 15 pies. ¿Terminar turno?» */
export function endTurnWarning(left) {
  if (!left?.length) return null;
  const list = left.length === 1 ? left[0] : `${left.slice(0, -1).join(', ')} y ${left.at(-1)}`;
  return `Te ${left.length === 1 && !left[0].endsWith('pies') ? 'queda' : 'quedan'} ${list}. ¿Terminar turno?`;
}
