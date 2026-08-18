// Qué puede hacer AHORA MISMO el combatiente que manejas: espejo en cliente de
// lo que el servidor ya valida en `turnEconomy` (`checkTurn`,
// `trySpendMovement`, `trySpendEnemyMovement`, `trySpecialAction`).
//
// El servidor sigue siendo la autoridad —esto no relaja ninguna regla, solo la
// anticipa—, pero sin este espejo el tablero ofrece controles que solo sirven
// para cosechar un error: el pad de movimiento de un personaje muerto, o el
// área de alcance de alguien que ya gastó sus casillas. Un control que no puede
// funcionar no debe estar encendido.
//
// Ojo con el DM: no tiene barra libre para todo. Al mover FICHAS DE PERSONAJE
// la ruta del servidor se salta camino y presupuesto (recoloca la escena a
// placer), pero al mover un enemigo del tracker o al gastarle una acción pasa
// por las mismas reglas que cualquiera. Eso es lo que distingue `freeMovement`
// de un "modo DM" global.

// Mismas listas que `combatRules.js` en servidor y cliente.
const ACTION_BLOCKERS = new Set(['aturdido', 'paralizado', 'petrificado', 'inconsciente']);
const MOVEMENT_BLOCKERS = new Set([
  'agarrado',
  'apresado',
  'aturdido',
  'paralizado',
  'petrificado',
  'inconsciente',
]);

const ALLOWED = { allowed: true, reason: null, message: null };

function blocked(reason, message) {
  return { allowed: false, reason, message };
}

/** Presupuesto de movimiento del turno en casillas (Correr lo dobla). */
export function movementBudget(combatant, speed) {
  const feet = Number.isInteger(combatant?.speed) ? combatant.speed : speed;
  if (!Number.isInteger(feet) || feet <= 0) return null;
  return Math.floor(feet / 5) * (combatant?.dashed ? 2 : 1);
}

/**
 * ¿Está fuera de juego? Para un PJ lo dice el tracker (`downed`, con su estado
 * de muerte); un enemigo no tiene salvaciones de muerte, así que a 0 PG está
 * fuera y punto — el servidor lo bloquea igual (`trySpendEnemyMovement`).
 */
export function isOutOfCombat(combatant) {
  if (!combatant) return false;
  if (combatant.downed) return true;
  return combatant.kind !== 'pj' && Number.isInteger(combatant.hpCurrent) && combatant.hpCurrent <= 0;
}

/**
 * @param combatant fila del tracker (o null si el token no está en combate)
 * @param speed velocidad de respaldo cuando el combatiente no la trae
 * @param combatActive si la mesa está en modo por turnos
 * @param turnId combatiente al que le toca
 * @param freeMovement el servidor no valida este movimiento (el DM colocando
 *   fichas de personaje). No afecta a las acciones: `trySpecialAction` no tiene
 *   excepción para el DM.
 * @returns { budget, remaining, spent, move, act } — `move`/`act` traen
 *   `allowed`, el `reason` en clave y el `message` ya redactado para el aviso.
 */
export function turnControl({
  combatant = null,
  speed = null,
  combatActive = false,
  turnId = null,
  freeMovement = false,
} = {}) {
  const budget = movementBudget(combatant, speed);
  const spent = Math.max(0, combatant?.movedSquares ?? 0);
  const remaining = budget == null ? null : Math.max(0, budget - spent);
  const base = { budget, remaining, spent: budget == null ? spent : Math.min(spent, budget) };

  // Inconsciente (0 PG, agonizando o muerto): en 5e no se mueve ni actúa,
  // tenga o no la mesa el modo por turnos activo.
  if (isOutOfCombat(combatant)) {
    const message = combatant.dead
      ? 'Tu personaje ha muerto: ya no puedes moverte ni actuar.'
      : combatant.kind === 'pj'
        ? 'Estás inconsciente: no puedes moverte ni actuar.'
        : 'Está fuera de combate: no puede moverse ni actuar.';
    const gate = blocked('inconsciente', message);
    return { ...base, move: freeMovement ? ALLOWED : gate, act: gate };
  }

  const conditions = Array.isArray(combatant?.conditions) ? combatant.conditions : [];
  const moveByCondition = conditions.some((condition) => MOVEMENT_BLOCKERS.has(condition));
  const actByCondition = conditions.some((condition) => ACTION_BLOCKERS.has(condition));
  const conditionGate = (verb) =>
    blocked('condiciones', `Las condiciones actuales impiden ${verb}.`);

  const move = freeMovement
    ? ALLOWED
    : moveByCondition
      ? conditionGate('moverse')
      : // Modo libre (o fuera del tracker): sin turnos ni casillas que contar.
        !combatActive || !combatant
        ? ALLOWED
        : turnId !== combatant.id
          ? blocked('turno', 'Todavía no es tu turno.')
          : remaining === 0
            ? blocked('sin-movimiento', 'Ya has gastado todo tu movimiento este turno.')
            : ALLOWED;

  const act = actByCondition
    ? conditionGate('actuar')
    : !combatActive || !combatant
      ? ALLOWED
      : turnId !== combatant.id
        ? blocked('turno', 'Todavía no es tu turno.')
        : combatant.actionUsed
          ? blocked('accion-gastada', 'Ya has usado tu acción este turno.')
          : ALLOWED;

  return { ...base, move, act };
}
