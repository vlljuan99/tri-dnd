import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRoom } from '../../../store/socket.js';

// «¿Cómo quieres hacerlo?» (Fase 4d): quien derriba a un enemigo describe el
// golpe final en una frase, que la mesa lee como subtítulo. Es opcional: se
// cierra sin escribir y no pasa nada. No toca ninguna regla.

const CADUCA_MS = 45_000;

export default function FinisherPrompt() {
  const request = useRoom((s) => s.finisherRequest);
  const sendFinisher = useRoom((s) => s.sendFinisher);
  const [text, setText] = useState('');
  const reducir = useReducedMotion();

  useEffect(() => {
    setText('');
    if (!request) return undefined;
    const timer = setTimeout(() => sendFinisher(''), CADUCA_MS);
    return () => clearTimeout(timer);
  }, [request?.at, sendFinisher]);

  if (!request) return null;

  function enviar(event) {
    event.preventDefault();
    sendFinisher(text.trim());
  }

  return (
    <motion.form
      onSubmit={enviar}
      initial={reducir ? false : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      className="pointer-events-auto absolute left-1/2 top-[22vh] z-30 w-[min(92vw,24rem)] -translate-x-1/2 rounded-md border-2 border-blood/50 bg-night-950/95 p-4 text-center text-bone shadow-2xl"
      aria-label="¿Cómo quieres hacerlo?"
    >
      <p className="font-display text-[0.65rem] uppercase tracking-[0.3em] text-blood/80">{request.enemyName} cae</p>
      <h2 className="mt-1 font-display text-xl tracking-wide text-gold">¿Cómo quieres hacerlo?</h2>
      <input
        autoFocus
        value={text}
        maxLength={240}
        onChange={(event) => setText(event.target.value)}
        placeholder="Giro la espada y le parto el escudo en dos…"
        className="mt-3 w-full rounded-sm border border-bone/20 bg-night-900 px-3 py-2 text-sm text-bone placeholder:text-bone/35 focus:border-gold/60 focus:outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => sendFinisher('')}
          className="flex-1 rounded-sm border border-bone/20 py-1.5 text-xs text-bone/60 hover:text-bone"
        >
          Saltar
        </button>
        <button
          type="submit"
          disabled={!text.trim()}
          className="flex-[2] rounded-sm bg-gold py-1.5 font-display text-sm tracking-wider text-night-950 hover:bg-gold/90 disabled:opacity-40"
        >
          Contarlo a la mesa
        </button>
      </div>
    </motion.form>
  );
}
