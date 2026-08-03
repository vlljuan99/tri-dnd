import { useState } from 'react';
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

/**
 * La iniciativa con su procedencia. Automatizar las tiradas solo es aceptable
 * si la mesa puede auditarlas, así que el número lleva siempre su desglose
 * (1d20 + DES) donde el servidor lo tiró, y se distingue de un valor escrito
 * a mano por el DM o de uno que aún no se ha tirado.
 *
 * El desglose de un enemigo solo llega al socket del DM (delata su DES); para
 * un jugador `initiativeRoll` viene vacío y solo se ve el total, que siempre
 * ha sido público.
 */
export function InitiativeValue({ combatant }) {
  const { initiative, initiativeSource: source, initiativeRoll: roll } = combatant;

  if (source == null) {
    return (
      <span title="Todavía sin tirar: se tirará al abrir el combate" className="font-mono text-xs text-bone/30">
        Ini —
      </span>
    );
  }

  const detail = roll
    ? `Tirada por el servidor: d20 ${roll.d20} ${roll.modifier >= 0 ? '+' : '−'} ${Math.abs(roll.modifier)} de DES = ${initiative}`
    : source === 'manual'
      ? 'Puesta a mano por el DM'
      : 'Tirada por el servidor';

  return (
    <span title={detail} className="flex items-center gap-1 font-mono text-xs text-bone/50">
      Ini {initiative}
      {source === 'manual' ? (
        <span aria-label="puesta a mano" className="text-[0.6rem] text-ochre/80">✎</span>
      ) : (
        <span aria-label="tirada automática" className="text-[0.6rem] text-sage/80">⚄</span>
      )}
    </span>
  );
}

/** Chip del hechizo al que se concentra un combatiente. */
export function ConcentrationChip({ spell }) {
  if (!spell) return null;
  return (
    <span
      title={`Concentrándose en ${spell}: recibir daño obliga a una salvación de Constitución`}
      className="rounded-sm border border-gold/50 bg-gold/10 px-1 text-[0.6rem] text-gold"
    >
      ◎ {spell}
    </span>
  );
}

/** Chips de las condiciones activas de un combatiente. */
export function ConditionChips({ conditions, timedConditions = [] }) {
  if (!conditions?.length) return null;
  const timers = Object.fromEntries(timedConditions.map((timer) => [timer.condition, timer]));
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {conditions.map((cond) => {
        const timer = timers[cond];
        const timingLabel = timer?.timing === 'start' ? 'al inicio' : 'al final';
        return (
          <span
            key={cond}
            title={timer ? `${conditionLabel(cond)}: ${timer.remaining} rondas, descuenta ${timingLabel} de su turno` : conditionLabel(cond)}
            className="rounded-sm border border-blood/40 bg-blood/10 px-1 text-[0.6rem] text-blood/90"
          >
            {conditionSymbol(cond)} {conditionLabel(cond)}
            {timer && <span className="ml-1 text-gold/80">⌛{timer.remaining}</span>}
          </span>
        );
      })}
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
export function ConditionEditor({ conditions, timedConditions = [], onToggle }) {
  const [duration, setDuration] = useState(0);
  const [timing, setTiming] = useState('end');
  const timers = Object.fromEntries(timedConditions.map((timer) => [timer.condition, timer]));

  return (
    <div className="mt-1 space-y-1.5 border-t border-bone/10 pt-1.5">
      <div className="flex flex-wrap items-center gap-1 text-[0.6rem] text-bone/55">
        <span>Al añadir:</span>
        <input
          type="number"
          min="0"
          max="99"
          value={duration}
          onChange={(event) => setDuration(Math.max(0, Math.min(99, Number(event.target.value) || 0)))}
          className="w-12 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-center text-bone"
          title="0 = permanente; 1–99 = rondas"
        />
        <span>{duration === 0 ? 'permanente' : duration === 1 ? 'ronda' : 'rondas'}</span>
        {duration > 0 && (
          <select
            value={timing}
            onChange={(event) => setTiming(event.target.value)}
            className="rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-bone"
          >
            <option value="start">Al inicio del turno</option>
            <option value="end">Al final del turno</option>
          </select>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {CONDITIONS.map((cond) => {
          const on = conditions?.includes(cond.key);
          const timer = timers[cond.key];
          return (
            <button
              key={cond.key}
              type="button"
              onClick={() => onToggle(cond.key, on ? {} : { duration: duration || undefined, timing })}
              title={on ? `Quitar ${cond.label}` : `Añadir ${cond.label}`}
              className={`rounded-sm border px-1 py-0.5 text-[0.6rem] ${
                on ? 'border-blood/60 bg-blood/15 text-blood' : 'border-bone/20 text-bone/50 hover:text-bone'
              }`}
            >
              {cond.symbol} {cond.label}{timer ? ` · ${timer.remaining}` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BossActionControls({ combatant, active, onUse }) {
  const boss = combatant?.bossActions;
  if (!boss || (!boss.legendary?.length && !boss.lair?.length)) return null;
  return (
    <div className="mt-1.5 space-y-1 border-t border-blood/15 pt-1.5">
      {boss.legendary?.length > 0 && (
        <div>
          <p className="text-[0.6rem] uppercase tracking-widest text-blood/75">
            Legendarias {boss.legendaryPoints}/{boss.legendaryPointsMax}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {boss.legendary.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={active || boss.legendaryPoints < action.cost}
                title={action.desc || action.name}
                onClick={() => onUse('legendary', action.id)}
                className="rounded-sm border border-blood/40 px-1.5 py-0.5 text-[0.62rem] text-blood/90 hover:bg-blood/10 disabled:opacity-30"
              >
                {action.name}{action.cost > 1 ? ` · ${action.cost}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      {boss.lair?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {boss.lair.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={boss.lairUsedThisRound}
              title={action.desc || 'Acción de guarida en iniciativa 20'}
              onClick={() => onUse('lair', action.id)}
              className="rounded-sm border border-violet-400/40 px-1.5 py-0.5 text-[0.62rem] text-violet-200 hover:bg-violet-400/10 disabled:opacity-30"
            >
              Guarida: {action.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
