import StatTooltip from '../../../components/StatTooltip.jsx';

// Barra de estado permanente del propio personaje (Fase 8.6, pulido):
// lo que se mira constantemente en tu turno —vida, movimiento restante,
// si ya has actuado— vive aquí, siempre visible, en vez de mezclado con
// una lista de tokens que solo tiene sentido cuando hay varios en juego.
export default function PlayerHud({
  token,
  combatant,
  combatActive,
  isMyTurn,
  characterId,
  canSeeNotes,
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
    <div className="pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 self-start rounded-sm border border-gold/25 bg-night-900/95 px-2.5 py-1.5 text-bone shadow-xl backdrop-blur">
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
        <StatTooltip stat="hp" className="flex items-center gap-1.5">
          <div className="h-2.5 w-24 overflow-hidden rounded-sm bg-night-950">
            <div className={`h-full ${hpColor}`} style={{ width: `${hpRatio * 100}%` }} />
          </div>
          <span className="font-mono text-xs text-bone/70">
            {hp}/{hpMax}
          </span>
        </StatTooltip>
      )}

      {ac != null && (
        <StatTooltip stat="ca" className="rounded-sm border border-bone/15 px-1.5 py-0.5 font-mono text-xs text-bone/70">
          CA {ac}
        </StatTooltip>
      )}

      {gated && budget != null && (
        <StatTooltip stat="mov" className="font-mono text-xs text-bone/70">
          Mov {remaining}/{budget} cas
        </StatTooltip>
      )}

      {gated && (
        <StatTooltip
          stat="accion"
          className={`font-display text-xs uppercase tracking-widest ${
            combatant.actionUsed ? 'text-bone/30 line-through' : 'text-gold'
          }`}
        >
          Acción
        </StatTooltip>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-l border-bone/10 pl-3">
        {characterId && (
          <button
            onClick={onOpenSheet}
            className="inline-flex min-h-9 items-center rounded-sm border border-bone/20 px-2.5 text-xs text-bone/80 hover:border-gold hover:text-gold"
          >
            Ficha
          </button>
        )}
        {characterId && (
          <button
            onClick={onOpenInventory}
            className="inline-flex min-h-9 items-center rounded-sm border border-bone/20 px-2.5 text-xs text-bone/80 hover:border-gold hover:text-gold"
          >
            Inventario
          </button>
        )}
        {canSeeNotes && (
          <button
            onClick={onOpenNotes}
            className="inline-flex min-h-9 items-center rounded-sm border border-bone/20 px-2.5 text-xs text-bone/80 hover:border-gold hover:text-gold"
          >
            Notas
          </button>
        )}
        {isMyTurn ? (
          <button
            onClick={onEndTurn}
            className="inline-flex min-h-9 items-center rounded-sm bg-gold px-2.5 text-xs font-semibold text-night-950 hover:bg-gold/90"
          >
            Terminar turno
          </button>
        ) : (
          gated && (
            <span className="inline-flex min-h-9 items-center rounded-sm border border-bone/10 px-2.5 text-xs text-bone/40">
              Esperando tu turno…
            </span>
          )
        )}
      </div>
    </div>
  );
}
