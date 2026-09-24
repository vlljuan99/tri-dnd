import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRoom } from '../../../store/socket.js';

// Susurro recibido (Fase 4, añadido): además de quedar en el registro, se lee
// como nota secreta sobre el tablero. Solo llega a quien va dirigido (y al DM):
// lo filtra el servidor.

const DURACION_MS = 7000;

export default function WhisperNote() {
  const note = useRoom((s) => s.whisperNote);
  const clear = useRoom((s) => s.clearWhisperNote);
  const reducir = useReducedMotion();

  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(clear, DURACION_MS);
    return () => clearTimeout(timer);
  }, [note?.id, clear]);

  if (!note) return null;
  return (
    <motion.button
      type="button"
      key={note.id}
      onClick={clear}
      initial={reducir ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      className="pointer-events-auto absolute right-3 top-[7.5rem] z-30 w-[min(88vw,18rem)] rounded-sm border border-dashed border-gold/50 bg-night-950/95 p-3 text-left text-bone shadow-2xl"
      aria-label={`Susurro de ${note.from}: ${note.text}`}
    >
      <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-gold/70">{note.from} te susurra</p>
      <p className="mt-1 font-serif text-sm italic leading-snug">{note.text}</p>
    </motion.button>
  );
}
