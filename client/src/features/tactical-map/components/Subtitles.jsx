import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRoom } from '../../../store/socket.js';
import { useReveal } from '../../../store/reveal.js';

// Subtítulos de la mesa (Fase 4d): lo que narra el DM y la frase de un golpe
// final aparecen sobre el tablero como en un videojuego, en vez de perderse
// en el chat. Quedan además en el registro como cualquier mensaje.

const FACTOR_RITMO = { cinematico: 1.35, normal: 1, rapido: 0.7 };

/** Tiempo en pantalla: proporcional a lo que hay que leer, con topes. */
export function subtitleDuration(text, ritmo = 'normal') {
  const base = Math.min(9000, Math.max(2600, 1600 + String(text ?? '').length * 55));
  return Math.round(base * (FACTOR_RITMO[ritmo] ?? 1));
}

export default function Subtitles() {
  const subtitle = useRoom((s) => s.subtitle);
  const clearSubtitle = useRoom((s) => s.clearSubtitle);
  const ritmo = useReveal((s) => s.ritmo);
  const reducir = useReducedMotion();

  useEffect(() => {
    if (!subtitle) return undefined;
    const timer = setTimeout(() => clearSubtitle(subtitle.id), subtitleDuration(subtitle.text, ritmo));
    return () => clearTimeout(timer);
  }, [subtitle?.id, ritmo, clearSubtitle]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[13rem] z-20 flex justify-center px-4 sm:bottom-[10rem] md:bottom-[7rem]">
      <AnimatePresence mode="wait">
        {subtitle && (
          <motion.div
            key={subtitle.id}
            initial={reducir ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            role="status"
            aria-live="polite"
            className="max-w-[min(92vw,42rem)] rounded-sm bg-gradient-to-r from-transparent via-night-950/85 to-transparent px-10 py-2.5 text-center"
          >
            {subtitle.style === 'golpe-final' && (
              <p className="font-display text-[0.65rem] uppercase tracking-[0.3em] text-blood/80">
                Golpe final · {subtitle.author}
              </p>
            )}
            <p className="font-serif text-lg italic leading-snug text-bone drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] sm:text-xl">
              {subtitle.style === 'golpe-final' ? `«${subtitle.text}»` : subtitle.text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
