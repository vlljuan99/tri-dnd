import { formatModifier } from '../lib/dnd.js';
import CombatantTooltip from './CombatantTooltip.jsx';

const ADVANTAGE_LABEL = { adv: 'ventaja', dis: 'desventaja' };

/**
 * Pinta el resultado de una tirada (overlay, historial y chat de la mesa).
 * Paleta oscura de mesa de juego: crítico en dorado, pifia en rojo sangre.
 * Si la tirada tiene `actorName` (personaje o monstruo que la hace), se
 * destaca en grande; el nombre del jugador que la disparó queda pequeño y
 * en un tono distinto, para no confundir "quién tira" con "por quién tira".
 */
export default function RollCard({ roll, authorName, compact = false }) {
  const totalColor = roll.crit
    ? 'text-gold'
    : roll.fumble
      ? 'text-blood'
      : 'text-bone';
  const hasActor = Boolean(roll.actorName);

  const details = (
    <span className="text-sm text-bone/80">
      {roll.label || 'Tirada'}
      {roll.advantage && roll.advantage !== 'none' && (
        <em className="ml-1 text-bone/50">({ADVANTAGE_LABEL[roll.advantage]})</em>
      )}
      {roll.forcedCrit && <em className="ml-1 text-gold/70">(crítico automático)</em>}
      {roll.hiddenBadge && (
        <span className="ml-2 rounded-sm border border-gold/40 px-1 text-xs text-gold/80">oculta</span>
      )}
      <span className="ml-2 font-mono text-xs text-bone/50">{roll.formula}</span>
    </span>
  );

  return (
    <div className="rounded-sm border border-gold/20 bg-night-950/60 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {hasActor ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <CombatantTooltip name={roll.actorName} className="truncate font-display text-base tracking-wide text-gold">
                  {roll.actorName}
                </CombatantTooltip>
                {authorName && <span className="shrink-0 text-xs text-bone/40">{authorName}</span>}
              </div>
              <div className="mt-0.5">{details}</div>
            </>
          ) : (
            <div className="min-w-0">
              {authorName && (
                <span className="mr-2 font-display text-xs tracking-wide text-gold/90">{authorName}</span>
              )}
              {details}
            </div>
          )}
        </div>
        <span className={`shrink-0 font-mono text-2xl font-bold ${totalColor}`}>{roll.total}</span>
      </div>

      {!compact && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {roll.groups.map((g) =>
            g.results.map((r, i) => (
              <span key={`${g.die}-${i}`} className="flex items-center gap-0.5">
                {r.rolls.map((value, j) => {
                  const discarded = r.rolls.length > 1 && value !== r.kept;
                  const isNat20 = g.sides === 20 && value === 20;
                  const isNat1 = g.sides === 20 && value === 1;
                  return (
                    <span
                      key={j}
                      title={g.die}
                      className={`rounded-sm border px-1.5 py-0.5 font-mono text-xs ${
                        discarded
                          ? 'border-bone/10 text-bone/30 line-through'
                          : isNat20
                            ? 'border-gold bg-gold/15 text-gold'
                            : isNat1
                              ? 'border-blood bg-blood/15 text-blood'
                              : 'border-bone/20 text-bone/80'
                      }`}
                    >
                      {value}
                    </span>
                  );
                })}
              </span>
            ))
          )}
          {roll.modifier !== 0 && (
            <span className="font-mono text-xs text-bone/60">{formatModifier(roll.modifier)}</span>
          )}
        </div>
      )}
    </div>
  );
}
