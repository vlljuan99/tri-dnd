import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { play } from '../../../lib/sfx/index.js';

// Una trampa se dispara (Fase 4c): «¡clic!», el tablero se oscurece un instante
// en todas las pantallas y enseguida salta la salvación del que la ha pisado.
// Solo lee el aviso del servidor; no decide nada.
export default function TrapAlert({ alert }) {
  const reducir = useReducedMotion();

  useEffect(() => {
    if (alert) play('ui.click');
  }, [alert?.id]);

  if (!alert) return null;
  return (
    <motion.div
      key={alert.id}
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-night-950/60"
      initial={reducir ? false : { opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0.9] }}
      transition={{ duration: 0.35 }}
      role="status"
      aria-live="assertive"
    >
      <div className="text-center">
        <motion.p
          initial={reducir ? false : { scale: 1.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          className="font-display text-5xl uppercase tracking-[0.2em] text-blood drop-shadow-[0_0_18px_rgba(143,43,35,0.8)]"
        >
          ¡Clic!
        </motion.p>
        <p className="mt-1 font-display text-sm uppercase tracking-[0.3em] text-bone/80">{alert.name}</p>
      </div>
    </motion.div>
  );
}
