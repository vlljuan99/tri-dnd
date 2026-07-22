// Anticipación del turno siguiente. Replica lo que hace el servidor al
// avanzar (advanceTurn en sockets.js) para poder enseñarle al DM lo que va a
// pasar ANTES de que pulse: «Siguiente» no tiene deshacer y, al dar la vuelta
// al orden, sube la ronda y dispara sus eventos en el chat.
//
// Vive aparte del componente porque es la única lógica del tracker que puede
// divergir del servidor sin que nadie se entere: si un día cambia el criterio
// de avance allí, este test es el que lo canta.

/**
 * @param combatants lista ya ordenada por iniciativa (como la sirve el socket)
 * @param turnId id del combatiente activo, o null si no hay ninguno
 * @returns { next, closesRound } — `next` es a quién le tocaría; `closesRound`
 *   indica si ese salto cierra la ronda en curso y empieza la siguiente.
 */
export function nextTurnPreview(combatants, turnId) {
  if (!combatants?.length) return { next: null, closesRound: false };

  const index = combatants.findIndex((c) => c.id === turnId);
  // Sin turno activo (tracker recién abierto, o el activo se ha ido del
  // tablero) el servidor arranca por el primero y NO cuenta como dar la
  // vuelta: la ronda no sube.
  const nextIndex = index === -1 ? 0 : (index + 1) % combatants.length;

  return {
    next: combatants[nextIndex],
    closesRound: index !== -1 && nextIndex === 0,
  };
}
