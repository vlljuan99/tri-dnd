import { motion, useReducedMotion } from 'framer-motion';
import { useRoom } from '../../../store/socket.js';

// Resumen de combate (Fase 4, añadido): al acabar, quién hizo cuánto daño,
// críticos y pifias, quién dio el golpe final y quién cayó. Los números de los
// enemigos solo llegan al DM (los filtra el servidor).

function Fila({ entry }) {
  return (
    <tr className="border-t border-bone/10">
      <td className="py-1 pr-2">{entry.name}</td>
      <td className="py-1 text-right font-mono">{entry.damage}</td>
      <td className="py-1 text-right font-mono text-gold">{entry.crits || '—'}</td>
      <td className="py-1 text-right font-mono text-blood">{entry.fumbles || '—'}</td>
    </tr>
  );
}

function Tabla({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="mt-3">
      <p className="font-display text-[0.65rem] uppercase tracking-widest text-bone/50">{title}</p>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-[0.6rem] uppercase tracking-wider text-bone/40">
            <th className="text-left font-normal">Quién</th>
            <th className="text-right font-normal">Daño</th>
            <th className="text-right font-normal">Críticos</th>
            <th className="text-right font-normal">Pifias</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <Fila key={entry.name} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CombatSummary() {
  const summary = useRoom((s) => s.combatSummary);
  const clear = useRoom((s) => s.clearCombatSummary);
  const reducir = useReducedMotion();
  if (!summary) return null;
  const mvp = summary.party?.[0]?.damage > 0 ? summary.party[0] : null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-night-950/60 p-4" onClick={clear}>
      <motion.div
        key={summary.key}
        role="dialog"
        aria-label="Resumen del combate"
        onClick={(event) => event.stopPropagation()}
        initial={reducir ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-h-[85vh] w-[min(92vw,26rem)] overflow-y-auto rounded-md border border-gold/40 bg-night-900 p-4 text-bone shadow-2xl"
      >
        <p className="font-display text-[0.65rem] uppercase tracking-[0.3em] text-gold/70">
          Fin del combate{summary.rounds ? ` · ${summary.rounds} ${summary.rounds === 1 ? 'ronda' : 'rondas'}` : ''}
        </p>
        <h2 className="mt-1 font-display text-xl tracking-wide text-gold">Resumen</h2>
        {mvp && (
          <p className="mt-2 text-sm text-bone/80">
            Más daño: <strong className="text-gold">{mvp.name}</strong> ({mvp.damage})
          </p>
        )}
        <Tabla title="El grupo" rows={summary.party} />
        <Tabla title="Enemigos (solo lo ves tú)" rows={summary.enemies} />
        {summary.finalBlows?.length > 0 && (
          <div className="mt-3">
            <p className="font-display text-[0.65rem] uppercase tracking-widest text-bone/50">Golpes finales</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {summary.finalBlows.map((blow, index) => (
                <li key={`${blow.by}-${blow.target}-${index}`}>
                  <span className="text-gold">{blow.by}</span> → {blow.target}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.fallen?.length > 0 && (
          <p className="mt-3 text-sm text-blood/90">Cayeron: {summary.fallen.join(', ')}</p>
        )}
        <button
          type="button"
          autoFocus
          onClick={clear}
          className="mt-4 w-full rounded-sm bg-gold py-1.5 font-display tracking-wider text-night-950 hover:bg-gold/90"
        >
          Seguir
        </button>
      </motion.div>
    </div>
  );
}
