import { formatModifier } from '../lib/dnd.js';
import CombatantTooltip from './CombatantTooltip.jsx';
import { textoContra, textoDelMargen, veredictoDe } from '../features/dice-tray/lib/reveal.js';

const ADVANTAGE_LABEL = { adv: 'ventaja', dis: 'desventaja' };
const VEREDICTO_COLOR = { exito: 'text-gold', fallo: 'text-bone/55', critico: 'text-gold', pifia: 'text-blood' };
// Reacciones a las tiradas (Fase 4, añadido): el mismo conjunto que acepta el servidor
export const REACCIONES = ['🔥', '😱', '😂', '👏', '💀'];

function Reacciones({ reactions = {}, selfId, onReact }) {
  const mine = Object.entries(reactions).find(([, users]) => users.includes(selfId))?.[0] ?? null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {REACCIONES.map((emoji) => {
        const count = reactions[emoji]?.length ?? 0;
        const chosen = mine === emoji;
        if (!count && !chosen) return null;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(chosen ? null : emoji)}
            aria-pressed={chosen}
            className={`rounded-full border px-1.5 text-xs ${chosen ? 'border-gold/60 bg-gold/15' : 'border-bone/15 hover:border-bone/35'}`}
          >
            {emoji} <span className="font-mono text-[0.65rem] text-bone/70">{count}</span>
          </button>
        );
      })}
      <details className="relative">
        <summary className="list-none cursor-pointer rounded-full border border-bone/15 px-1.5 text-xs text-bone/50 hover:text-bone" aria-label="Reaccionar">
          +
        </summary>
        <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-sm border border-bone/20 bg-night-900 p-1 shadow-xl">
          {REACCIONES.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={(event) => {
                onReact(emoji);
                event.currentTarget.closest('details')?.removeAttribute('open');
              }}
              className="rounded-sm px-1 text-base hover:bg-bone/10"
              aria-label={`Reaccionar con ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * Pinta el resultado de una tirada (overlay, historial y chat de la mesa).
 * Paleta oscura de mesa de juego: crítico en dorado, pifia en rojo sangre.
 * Si la tirada tiene `actorName` (personaje o monstruo que la hace), se
 * destaca en grande; el nombre del jugador que la disparó queda pequeño y
 * en un tono distinto, para no confundir "quién tira" con "por quién tira".
 */
export default function RollCard({ roll, authorName, compact = false, reactions = null, selfId = null, onReact = null }) {
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

      {/* Veredicto que puso el servidor al resolver (Fase 4b): contra qué y
          cómo salió, con el margen cuando lo hay. */}
      {!compact && veredictoDe(roll.outcome) && (
        <p className="mt-1 text-xs text-bone/60">
          {textoContra(roll.outcome) && <span>{textoContra(roll.outcome)} · </span>}
          <span className={`font-display uppercase tracking-widest ${VEREDICTO_COLOR[veredictoDe(roll.outcome).tono] ?? ''}`}>
            {veredictoDe(roll.outcome).texto}
          </span>
          {textoDelMargen(roll) && <span> {textoDelMargen(roll)}</span>}
        </p>
      )}

      {!compact && onReact && <Reacciones reactions={reactions ?? {}} selfId={selfId} onReact={onReact} />}
    </div>
  );
}
