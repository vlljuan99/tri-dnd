// Vista de la tira de iniciativa (Fase 2 de la reforma del HUD): convierte los
// combatientes que sirve el socket en las tarjetas de retrato que se pintan
// arriba-centro del tablero.
//
// Vive aparte del componente por la misma razón que turnOrder.js: es la única
// pieza del HUD que puede empezar a INVENTAR datos sin que nadie se entere. El
// servidor ya filtra lo que no debe ver un jugador (los PG y la CA de un
// enemigo solo llegan al socket del DM), así que aquí la regla es no rellenar
// ningún hueco: si el combatiente no trae PG y su token tampoco los trae, la
// tarjeta se pinta sin barra de vida en vez de suponer nada.

/** Estado vital de la tarjeta, con el mismo criterio que el tracker del DM. */
function vitalState(combatant, hp) {
  if (combatant.dead) return 'dead';
  if (combatant.dying) return 'dying';
  if (combatant.stable) return 'stable';
  // Un enemigo no tiene salvaciones de muerte: a 0 PG está muerto y punto.
  if (combatant.kind !== 'pj' && hp && hp.current <= 0) return 'dead';
  return 'normal';
}

/**
 * Empareja cada combatiente con su token del tablero (por personaje o por
 * marcador) y deriva lo que la tira necesita pintar.
 *
 * @param combatants lista ya ordenada por iniciativa, tal como llega del socket
 * @param tokens tokens del tablero compuesto (ya filtrados por visibilidad)
 * @param turnId id del combatiente activo, o null fuera de combate
 * @param userId usuario que mira, para marcar cuáles son suyos
 */
export function buildInitiativeStrip({ combatants = [], tokens = [], turnId = null, userId = null } = {}) {
  return combatants.map((combatant) => {
    const token =
      tokens.find((t) =>
        combatant.characterId ? t.characterId === combatant.characterId : t.serverId === combatant.mapTokenId
      ) ?? null;

    // Los PG del combatiente mandan; los del token son el respaldo para un
    // enemigo visto por un jugador (su barra ya se pinta en el tablero, así
    // que enseñarla también aquí no revela nada nuevo).
    const current = Number.isInteger(combatant.hpCurrent) ? combatant.hpCurrent : token?.hp;
    const max = Number.isInteger(combatant.hpMax) ? combatant.hpMax : token?.hpMax;
    const hp =
      Number.isInteger(current) && Number.isInteger(max) && max > 0
        ? {
            current,
            max,
            temp: combatant.hpTemp ?? 0,
            ratio: Math.max(0, Math.min(1, current / max)),
          }
        : null;

    return {
      id: combatant.id,
      name: token?.name ?? combatant.name,
      kind: combatant.kind,
      initiative: combatant.initiative,
      initiativeSource: combatant.initiativeSource ?? null,
      active: combatant.id === turnId,
      // "Mío" es el PJ cuyo token controla este usuario: la tarjeta se resalta
      // para encontrarte de un vistazo en una tira de ocho retratos.
      mine: Boolean(combatant.characterId && token && token.ownerUserId === userId),
      // Sin token no hay nada que seleccionar en el tablero (enemigo fuera de
      // la niebla, PJ en otra planta): la tarjeta se pinta, pero no se pulsa.
      tokenId: token?.id ?? null,
      imageUrl: token?.imageUrl ?? null,
      hp,
      conditions: combatant.conditions ?? [],
      timedConditions: combatant.timedConditions ?? [],
      concentration: combatant.concentration ?? null,
      state: vitalState(combatant, hp),
      deathSaves: combatant.deathSaves ?? null,
      dashed: Boolean(combatant.dashed),
      stance: combatant.stance ?? null,
      // Fase 4c: su jugador aún no ha tirado la iniciativa (ritual de combate)
      initiativePending: Boolean(combatant.initiativePending),
      // Fase 4c: quién le está ayudando (acción Ayudar)
      helpFrom: combatant.helpFrom?.name ?? null,
    };
  });
}
