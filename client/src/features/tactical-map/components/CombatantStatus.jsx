import { CONDITIONS, conditionSymbol, conditionLabel } from '../domain/conditions.js';

// Piezas visuales del estado de un combatiente, compartidas entre el orden de
// iniciativa del tablero (InitiativeOrder) y el tracker completo del cajón
// del DM (InitiativeTracker): así ambos muestran exactamente lo mismo
// (insignias de Correr/postura, condiciones, salvaciones de muerte) sin
// duplicar el marcado ni arriesgarse a que diverjan con el tiempo.

/** Insignias en línea de recursos del turno con estado visual propio: Correr y postura. */
export function TurnBadges({ combatant }) {
  if (!combatant?.dashed && combatant?.stance == null) return null;
  return (
    <>
      {combatant.dashed && <span title="Corriendo (movimiento doblado)" className="text-[0.6rem] text-moss">»</span>}
      {combatant.stance === 'esquivar' && <span title="Esquivando" className="text-[0.6rem] text-gold/80">◈</span>}
      {combatant.stance === 'destrabarse' && <span title="Destrabado" className="text-[0.6rem] text-gold/80">↔</span>}
    </>
  );
}

/** Chips de las condiciones activas de un combatiente. */
export function ConditionChips({ conditions }) {
  if (!conditions?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {conditions.map((cond) => (
        <span
          key={cond}
          title={conditionLabel(cond)}
          className="rounded-sm border border-blood/40 bg-blood/10 px-1 text-[0.6rem] text-blood/90"
        >
          {conditionSymbol(cond)} {conditionLabel(cond)}
        </span>
      ))}
    </div>
  );
}

/** Puntos de éxito/fallo de las salvaciones de muerte (3 y 3). */
export function DeathSaveDots({ saves, size = 'sm' }) {
  if (!saves) return null;
  const dot = size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5';
  return (
    <span className="flex items-center gap-1" title={`Salvaciones de muerte: ${saves.successes} éxitos, ${saves.failures} fallos`}>
      {[0, 1, 2].map((i) => (
        <span key={`s${i}`} className={`${dot} rounded-full ${i < saves.successes ? 'bg-moss' : 'bg-night-950 ring-1 ring-moss/40'}`} />
      ))}
      <span className="mx-0.5 text-bone/30">·</span>
      {[0, 1, 2].map((i) => (
        <span key={`f${i}`} className={`${dot} rounded-full ${i < saves.failures ? 'bg-blood' : 'bg-night-950 ring-1 ring-blood/40'}`} />
      ))}
    </span>
  );
}

/** Selector de condiciones del DM: alterna cada una al pulsarla. */
export function ConditionEditor({ conditions, onToggle }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1 border-t border-bone/10 pt-1.5">
      {CONDITIONS.map((cond) => {
        const on = conditions?.includes(cond.key);
        return (
          <button
            key={cond.key}
            type="button"
            onClick={() => onToggle(cond.key)}
            title={cond.label}
            className={`rounded-sm border px-1 py-0.5 text-[0.6rem] ${
              on ? 'border-blood/60 bg-blood/15 text-blood' : 'border-bone/20 text-bone/50 hover:text-bone'
            }`}
          >
            {cond.symbol} {cond.label}
          </button>
        );
      })}
    </div>
  );
}
