// Barra de estado permanente del propio personaje (Fase 8.6, pulido):
// lo que se mira constantemente en tu turno —vida, movimiento restante,
// si ya has actuado— vive aquí, siempre visible, en vez de mezclado con
// una lista de tokens que solo tiene sentido cuando hay varios en juego.
export default function PlayerHud({
  token,
  combatant,
  combatActive,
  isMyTurn,
  onEndTurn,
  onOpenSheet,
  onOpenInventory,
  onOpenNotes,
}) {
  if (!token) return null;

  const hp = combatant?.hpCurrent ?? token.hp;
  const hpMax = combatant?.hpMax ?? token.hpMax;
  const ac = combatant?.ac;
  const speed = combatant?.speed ?? token.speed;
  const budget = Number.isInteger(speed) ? Math.floor(speed / 5) : null;
  const remaining = budget != null ? Math.max(0, budget - (combatant?.movedSquares ?? 0)) : null;
  const hasHp = Number.isInteger(hp) && Number.isInteger(hpMax) && hpMax > 0;
  const hpRatio = hasHp ? Math.max(0, Math.min(1, hp / hpMax)) : 0;
  const hpColor = hpRatio > 0.5 ? 'bg-moss' : hpRatio > 0.25 ? 'bg-ochre' : 'bg-blood';
  const gated = Boolean(combatActive && combatant); // movimiento/acción solo tienen sentido con el modo activo

  return (
    <div className="absolute inset-x-3 bottom-20 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-gold/25 bg-night-900/95 px-3 py-2 text-bone shadow-xl backdrop-blur sm:inset-x-4 sm:bottom-24">
      <div className="flex items-center gap-2">
        {token.imageUrl ? (
          <img src={token.imageUrl} alt="" className="h-10 w-10 rounded-full border border-gold/40 object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 bg-night-950 font-display text-gold/70">
            {token.name?.[0]?.toUpperCase()}
          </div>
        )}
        <span className="font-display text-sm tracking-wide text-gold">{token.name}</span>
      </div>

      {hasHp && (
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-24 overflow-hidden rounded-sm bg-night-950">
            <div className={`h-full ${hpColor}`} style={{ width: `${hpRatio * 100}%` }} />
          </div>
          <span className="font-mono text-xs text-bone/70">
            {hp}/{hpMax}
          </span>
        </div>
      )}

      {ac != null && (
        <span className="rounded-sm border border-bone/15 px-1.5 py-0.5 font-mono text-xs text-bone/70">CA {ac}</span>
      )}

      {gated && budget != null && (
        <span className="font-mono text-xs text-bone/70">
          Mov {remaining}/{budget} cas
        </span>
      )}

      {gated && (
        <span
          className={`font-display text-xs uppercase tracking-widest ${
            combatant.actionUsed ? 'text-bone/30 line-through' : 'text-gold'
          }`}
        >
          Acción
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          onClick={onOpenSheet}
          className="rounded-sm border border-bone/20 px-2 py-1 text-xs text-bone/80 hover:border-gold hover:text-gold"
        >
          Ficha
        </button>
        <button
          onClick={onOpenInventory}
          className="rounded-sm border border-bone/20 px-2 py-1 text-xs text-bone/80 hover:border-gold hover:text-gold"
        >
          Inventario
        </button>
        <button
          onClick={onOpenNotes}
          className="rounded-sm border border-bone/20 px-2 py-1 text-xs text-bone/80 hover:border-gold hover:text-gold"
        >
          Notas
        </button>
        {isMyTurn && (
          <button
            onClick={onEndTurn}
            className="rounded-sm bg-gold px-2 py-1 font-display text-xs uppercase tracking-widest text-night-950 hover:bg-gold/90"
          >
            Terminar turno
          </button>
        )}
      </div>
    </div>
  );
}
