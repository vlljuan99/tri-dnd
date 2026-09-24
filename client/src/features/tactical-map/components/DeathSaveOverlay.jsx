import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { play } from '../../../lib/sfx/index.js';

// Salvación de muerte con tensión (Fase 4c). En tu turno, a 0 PG y agonizando,
// la mesa se oscurece, late, y los tres huecos de éxito y fallo se ven en
// grande. La tirada sigue siendo la de siempre (un d20, CD 10): cambia la
// escena, no la regla. El dado rueda y se revela en la bandeja como todos.

function Huecos({ label, count, tone }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="font-display text-[0.65rem] uppercase tracking-[0.25em] text-bone/55">{label}</span>
      <div className="flex gap-2">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={`h-5 w-5 rounded-full border-2 ${
              index < count
                ? tone === 'exito'
                  ? 'border-moss bg-moss shadow-[0_0_10px_rgba(94,140,74,0.7)]'
                  : 'border-blood bg-blood shadow-[0_0_10px_rgba(143,43,35,0.7)]'
                : tone === 'exito'
                  ? 'border-moss/50'
                  : 'border-blood/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default function DeathSaveOverlay({ name, saves, onRoll }) {
  const reducir = useReducedMotion();
  const [busy, setBusy] = useState(false);

  // Un único golpe sordo al empezar el turno a las puertas de la muerte
  useEffect(() => {
    play('downed');
  }, []);

  async function tirar() {
    if (busy) return;
    setBusy(true);
    try {
      await onRoll?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-night-950/75 backdrop-blur-[1px]">
      {/* Viñeta roja que late como un pulso */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgba(143,43,35,0.65)]"
        animate={reducir ? undefined : { opacity: [0.35, 0.9, 0.35] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        role="alertdialog"
        aria-label="Salvación de muerte"
        className="relative w-[min(92vw,22rem)] rounded-md border-2 border-blood/60 bg-night-950/95 p-5 text-center text-bone shadow-2xl"
      >
        <p className="font-display text-[0.65rem] uppercase tracking-[0.3em] text-blood/80">{name} agoniza</p>
        <h2 className="mt-1 font-display text-2xl tracking-wide text-bone">Salvación de muerte</h2>
        <p className="mt-1 text-xs text-bone/55">Un d20: 10 o más es un éxito. Un 20 te devuelve a la vida con 1 PG.</p>
        <div className="mt-4 flex justify-center gap-8">
          <Huecos label="Éxitos" count={saves?.successes ?? 0} tone="exito" />
          <Huecos label="Fallos" count={saves?.failures ?? 0} tone="fallo" />
        </div>
        <button
          type="button"
          autoFocus
          onClick={tirar}
          disabled={busy}
          className="mt-5 w-full rounded-sm bg-blood/85 py-2.5 font-display text-lg tracking-[0.2em] text-bone shadow-lg shadow-blood/30 hover:bg-blood disabled:opacity-60"
        >
          {busy ? 'Tirando…' : 'Tirar'}
        </button>
      </div>
    </div>
  );
}
