// Flujo del panel de ataque (impacto → daño), separado del render para poder
// probarlo: qué armas se enseñan mientras dura un ataque, cuándo se puede
// preparar otro, cuándo se ha terminado y qué suena al resolverse.
//
// `feedback` es el último resultado del panel, anclado a su arma:
// { type: 'attack', weaponId, hit, … } | { type: 'damage', weaponId, … }.

/**
 * Tras un impacto falta tirar el daño: el ataque sigue abierto. Una acción sin
 * dados de daño conocidos (`canDamage: false`) se queda en el impacto.
 */
export function awaitingDamage(feedback) {
  return feedback?.type === 'attack' && Boolean(feedback.hit) && feedback.canDamage !== false;
}

/**
 * ¿Le queda otro ataque al atacante? Solo hay economía con el combate por
 * turnos en marcha: atacar gasta la acción entera (tirada y daño), salvo que
 * un Multiataque deje golpes pendientes. Fuera de combate, o sin entrada en
 * el tracker, el ataque se da por cerrado en cuanto se resuelve.
 */
export function hasAttackLeft({ combatActive = false, combatant = null, multiattackState = null } = {}) {
  if (!combatActive || !combatant) return false;
  if ((multiattackState?.remaining ?? []).some((entry) => entry.count > 0)) return true;
  return !combatant.actionUsed;
}

/**
 * ¿Se puede preparar otro ataque desde el panel? Antes del primero, sí; con un
 * impacto pendiente toca tirar el daño; después, solo si queda otro ataque.
 */
export function canStartAttack({ feedback = null, attackLeft = false } = {}) {
  if (!feedback) return true;
  if (awaitingDamage(feedback)) return false;
  return attackLeft;
}

/**
 * Filas que enseña el panel. Con un arma elegida en el hotbar, solo esa;
 * mientras dura un ataque (o si ya no queda otro), solo la del arma con la que
 * se ha tirado. El resto de armas ahí solo es ruido.
 */
export function visibleAttackRows(rows, { armedId = null, feedback = null, attackLeft = false } = {}) {
  const activeId = feedback && !canStartAttack({ feedback, attackLeft }) ? feedback.weaponId : null;
  const focusId = activeId ?? armedId;
  const focused = focusId != null ? rows.find((row) => row.id === focusId) : null;
  return focused ? [focused] : rows;
}

/**
 * Sonido de la mesa para un efecto visual de combate (`combat:visual`), o
 * null si no lleva. Suena en todos los clientes, cuando el dado ya ha caído.
 */
export function sfxForCombatVisual(visual) {
  switch (visual?.type) {
    case 'hit':
      return visual.critical ? 'attack.crit' : 'attack.hit';
    case 'miss':
      return 'attack.miss';
    case 'heal':
      return 'heal';
    default:
      return null;
  }
}
