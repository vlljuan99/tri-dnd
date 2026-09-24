import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRoom } from '../../../store/socket.js';
import { play } from '../../../lib/sfx/index.js';

// Presentación de jefe (Fase 4d): la primera vez que la mesa ve a un enemigo
// marcado por el DM, un cartel a pantalla completa con su nombre (el que ve la
// mesa: si está oculto, el visible), su título y su imagen. Lo decide el
// servidor, que solo lo manda cuando el jefe está a la vista.

const DURACION_MS = 4200;

export default function BossIntro() {
  const boss = useRoom((s) => s.bossIntro);
  const clearBossIntro = useRoom((s) => s.clearBossIntro);
  const reducir = useReducedMotion();

  useEffect(() => {
    if (!boss) return undefined;
    play('combat.start');
    const timer = setTimeout(clearBossIntro, DURACION_MS);
    return () => clearTimeout(timer);
  }, [boss?.key, clearBossIntro]);

  if (!boss) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-night-950/80"
      onClick={clearBossIntro}
      role="presentation"
    >
      <motion.div
        key={boss.key}
        role="dialog"
        aria-label={`Aparece ${boss.name}`}
        initial={reducir ? false : { opacity: 0, scale: 1.12 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="flex flex-col items-center px-6 text-center"
      >
        {boss.imageUrl && (
          <img
            src={boss.imageUrl}
            alt=""
            className="mb-4 h-40 w-40 rounded-full border-4 border-blood/70 object-cover shadow-[0_0_40px_rgba(143,43,35,0.6)] sm:h-52 sm:w-52"
          />
        )}
        <motion.p
          initial={reducir ? false : { letterSpacing: '0.6em', opacity: 0 }}
          animate={{ letterSpacing: '0.25em', opacity: 1 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          className="font-display text-4xl uppercase text-bone drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] sm:text-5xl"
        >
          {boss.name}
        </motion.p>
        {boss.title && (
          <motion.p
            initial={reducir ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-2 font-serif text-lg italic text-blood/90"
          >
            {boss.title}
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}
