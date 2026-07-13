import StatTooltip from '../../../components/StatTooltip.jsx';
import { conditionSymbol, conditionLabel } from '../domain/conditions.js';

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
  onSpecialAction,
  onDeathSave,
  onOpenSheet,
  onOpenInventory,
  onOpenNotes,
}) {
  if (!token) return null;

  const hp = combatant?.hpCurrent ?? token.hp;
  const hpMax = combatant?.hpMax ?? token.hpMax;
  const ac = combatant?.ac;
  const speed = combatant?.speed ?? token.speed;
  // Correr (Dash) dobla el presupuesto de movimiento del turno
  const budget = Number.isInteger(speed) ? Math.floor(speed / 5) * (combatant?.dashed ? 2 : 1) : null;
  const remaining = budget != null ? Math.max(0, budget - (combatant?.movedSquares ?? 0)) : null;
  const hasHp = Number.isInteger(hp) && Number.isInteger(hpMax) && hpMax > 0;
  const downed = Boolean(combatant?.downed);
  const dead = Boolean(combatant?.dead);
  const conditions = combatant?.conditions ?? [];
  // Acciones especiales disponibles: solo en tu turno, con la mesa en turnos y
  // sin estar agonizando; se deshabilitan si ya has gastado la acción.
  const canAct = Boolean(combatActive && isMyTurn && combatant && !downed);
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

      {conditions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {conditions.map((cond) => (
            <span
              key={cond}
              title={conditionLabel(cond)}
              className="rounded-sm border border-blood/40 bg-blood/10 px-1 text-[0.65rem] text-blood/90"
            >
              {conditionSymbol(cond)} {conditionLabel(cond)}
            </span>
          ))}
        </div>
      )}

      {/* PJ muerto de verdad (3 fallos): estado final, ya no hay nada que tirar */}
      {combatActive && dead && (
        <div className="flex items-center gap-2 border-l border-blood/30 pl-3">
          <span className="font-display text-xs uppercase tracking-widest text-blood">☠ Muerto</span>
        </div>
      )}

      {/* PJ agonizante: salvaciones de muerte en vez de acciones normales */}
      {combatActive && downed && !dead && (
        <div className="flex items-center gap-2 border-l border-bone/10 pl-3">
          <span className="flex items-center gap-1" title="Salvaciones de muerte">
            {[0, 1, 2].map((i) => (
              <span key={`s${i}`} className={`h-2 w-2 rounded-full ${i < (combatant?.deathSaves?.successes ?? 0) ? 'bg-moss' : 'bg-night-950 ring-1 ring-moss/40'}`} />
            ))}
            <span className="mx-0.5 text-bone/30">·</span>
            {[0, 1, 2].map((i) => (
              <span key={`f${i}`} className={`h-2 w-2 rounded-full ${i < (combatant?.deathSaves?.failures ?? 0) ? 'bg-blood' : 'bg-night-950 ring-1 ring-blood/40'}`} />
            ))}
          </span>
          {isMyTurn && onDeathSave && (
            <button
              onClick={onDeathSave}
              className="rounded-sm border border-blood/50 px-2 py-0.5 text-xs text-blood hover:bg-blood/10"
            >
              Tirar salvación
            </button>
          )}
        </div>
      )}

      {/* Acciones especiales del turno (gastan la acción): Correr, Esquivar,
          Destrabarse. Correr dobla el movimiento; las otras son posturas que
          el DM narra (sin autodetección de disparadores). */}
      {canAct && onSpecialAction && (
        <div className="flex items-center gap-1 border-l border-bone/10 pl-3">
          {[
            { kind: 'correr', label: 'Correr', on: combatant?.dashed },
            { kind: 'esquivar', label: 'Esquivar', on: combatant?.stance === 'esquivar' },
            { kind: 'destrabarse', label: 'Destrabar', on: combatant?.stance === 'destrabarse' },
          ].map((a) => (
            <button
              key={a.kind}
              onClick={() => onSpecialAction(a.kind)}
              disabled={combatant?.actionUsed && !a.on}
              title={a.on ? 'Activa este turno' : combatant?.actionUsed ? 'Ya has usado tu acción' : `Gasta la acción: ${a.label}`}
              className={`rounded-sm border px-2 py-0.5 text-xs ${
                a.on
                  ? 'border-moss bg-moss/20 text-bone'
                  : 'border-bone/20 text-bone/70 hover:border-gold hover:text-gold disabled:opacity-30 disabled:hover:border-bone/20 disabled:hover:text-bone/70'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
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
