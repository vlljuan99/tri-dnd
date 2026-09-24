import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { desgloseCorto, textoContra, textoDelMargen, veredictoDe } from '../lib/reveal.js';

// El rótulo que acompaña a los dados (Fase 4b): quién tira y qué, y en cuanto
// caen, paso a paso, el total, contra qué y el veredicto. Lo pinta la cola de
// revelado para la tirada que se está enseñando; no decide nada, solo lee.

const TONOS = {
  exito: 'text-gold',
  fallo: 'text-bone/60',
  critico: 'text-gold drop-shadow-[0_0_14px_rgba(232,195,104,0.75)]',
  pifia: 'text-blood',
};

function nombreDeQuienTira(entrada) {
  return entrada.roll?.actorName || entrada.autor || null;
}

export default function RevealCaption({ entrada, paso, pasos, escenario = 'centro' }) {
  const reducir = useReducedMotion();
  if (!entrada) return null;
  const { roll } = entrada;
  const outcome = roll?.outcome ?? null;
  const visibles = new Set((pasos ?? []).slice(0, paso + 1).map((item) => item.paso));
  const veredicto = visibles.has('veredicto') ? veredictoDe(outcome) : null;
  const margen = veredicto ? textoDelMargen(roll) : null;
  const esDanio = roll?.kind === 'damage';
  const quien = nombreDeQuienTira(entrada);
  const aparecer = reducir
    ? { initial: false, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 6, scale: 0.9 }, animate: { opacity: 1, y: 0, scale: 1 } };

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[61] flex justify-center px-4 ${
        escenario === 'mesa'
          ? // Pegado a los dados: la mitad alta del lienzo de la bandeja está vacía
            'bottom-[calc(12rem+min(28vh,15rem)*0.6)] sm:bottom-[calc(9rem+min(28vh,15rem)*0.6)] md:bottom-[calc(5.5rem+min(34vh,17rem)*0.62)]'
          : 'top-[12vh]'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-[min(92vw,30rem)] rounded-md border border-gold/25 bg-night-950/80 px-4 py-2 text-center text-bone shadow-2xl shadow-black/60 backdrop-blur">
        <p className="truncate font-display text-[0.7rem] uppercase tracking-[0.2em] text-gold/80">
          {quien}
          {quien && roll?.label ? ' · ' : ''}
          <span className="normal-case tracking-normal text-bone/70">{roll?.label}</span>
          {entrada.oculta && <span className="ml-1 text-bone/40">(oculta)</span>}
        </p>
        {/* Por qué caen dos d20: el motivo sigue a la vista mientras ruedan */}
        {(roll?.advantage === 'adv' || roll?.advantage === 'dis') && (
          <p className={`text-[0.7rem] ${roll.advantage === 'adv' ? 'text-moss' : 'text-blood/80'}`}>
            con {roll.advantage === 'adv' ? 'ventaja' : 'desventaja'}
            {outcome?.motivos?.length ? ` · ${outcome.motivos.join(', ')}` : ''}
          </p>
        )}

        {paso < 0 ? (
          <p className="mt-1 font-display text-sm tracking-widest text-gold/60">Rodando…</p>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-0.5">
            <motion.span key="total" {...aparecer} className="flex items-baseline gap-2">
              <span
                className={`font-display text-4xl leading-none ${esDanio ? 'text-blood' : 'text-bone'}`}
              >
                {roll?.total}
              </span>
              <span className="font-mono text-xs text-bone/50">{desgloseCorto(roll)}</span>
              {esDanio && <span className="text-xs text-bone/60">de daño</span>}
            </motion.span>
            {visibles.has('contra') && (
              <motion.span key="contra" {...aparecer} className="text-sm text-bone/70">
                {textoContra(outcome)}
                {outcome?.objetivo ? <span className="text-bone/45"> · {outcome.objetivo}</span> : null}
              </motion.span>
            )}
          </div>
        )}

        <AnimatePresence>
          {veredicto && (
            <motion.p
              key="veredicto"
              initial={reducir ? false : { opacity: 0, scale: 1.8, rotate: -6 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 16 }}
              className={`mt-1 font-display text-2xl uppercase tracking-[0.18em] ${TONOS[veredicto.tono] ?? ''}`}
            >
              {veredicto.texto}
              {margen && (
                <span className="ml-2 align-middle font-sans text-xs normal-case tracking-normal text-bone/60">
                  {margen}
                </span>
              )}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
