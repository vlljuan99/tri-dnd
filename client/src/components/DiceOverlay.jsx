import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { DICE_TYPES } from '../lib/dice.js';
import { useDice } from '../store/dice.js';
import { useRoom } from '../store/socket.js';
import RollCard from './RollCard.jsx';

// Posición del botón flotante, recordada por navegador (offsets negativos
// desde su esquina inferior derecha por defecto)
const FAB_POSITION_KEY = 'tri-dnd:dice-fab-pos';

function readFabPosition() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FAB_POSITION_KEY) || '{}');
    // Nunca fuera de la pantalla actual (pudo guardarse en una más grande)
    return {
      x: Math.min(0, Math.max(-(window.innerWidth - 72), saved.x || 0)),
      y: Math.min(0, Math.max(-(window.innerHeight - 72), saved.y || 0)),
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

function D20Icon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2 L21 7.5 L21 16.5 L12 22 L3 16.5 L3 7.5 Z M12 2 L12 8.2 M21 7.5 L12 8.2 L3 7.5 M12 8.2 L17 15 L7 15 Z M21 16.5 L17 15 M3 16.5 L7 15 M12 22 L17 15 M12 22 L7 15"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ADVANTAGE_OPTIONS = [
  ['dis', 'Desv.'],
  ['none', 'Normal'],
  ['adv', 'Vent.'],
];

/**
 * Tirador de dados siempre accesible: FAB flotante + panel superpuesto
 * sobre la pantalla actual sin cambiar de vista.
 */
export default function DiceOverlay() {
  const dice = useDice();
  const { campaignId, role } = useRoom();
  const inRoom = Boolean(campaignId);
  const isDm = role === 'dm';
  const hasDice = DICE_TYPES.some((d) => dice.pool[d] > 0);
  const initialPos = readFabPosition();
  const fabX = useMotionValue(initialPos.x);
  const fabY = useMotionValue(initialPos.y);

  function saveFabPosition() {
    window.localStorage.setItem(
      FAB_POSITION_KEY,
      JSON.stringify({ x: Math.round(fabX.get()), y: Math.round(fabY.get()) })
    );
  }

  return (
    <>
      {/* Botón flotante: arrastrable, cada cual lo deja donde no le estorbe.
          onTap (y no onClick) para que soltar tras arrastrar no lo abra. */}
      <motion.button
        drag
        dragMomentum={false}
        dragElastic={0.08}
        dragConstraints={{
          left: -(window.innerWidth - 72),
          right: 0,
          top: -(window.innerHeight - 72),
          bottom: 0,
        }}
        style={{ x: fabX, y: fabY, touchAction: 'none' }}
        onDragEnd={saveFabPosition}
        onTap={dice.toggleOpen}
        aria-label="Tirador de dados (arrastra para recolocarlo)"
        title="Arrastra para recolocarlo"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 cursor-grab items-center justify-center rounded-full border border-gold/50 bg-night-900 text-gold shadow-lg shadow-black/40 active:cursor-grabbing"
      >
        <D20Icon className="h-8 w-8" />
      </motion.button>

      <AnimatePresence>
        {dice.open && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] w-full overflow-y-auto rounded-t-lg border border-gold/25 bg-night-900 p-4 text-bone shadow-2xl shadow-black/60 sm:inset-x-auto sm:right-4 sm:bottom-20 sm:w-96 sm:rounded-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg tracking-wide text-gold">Tirador de dados</h2>
              <button onClick={dice.close} aria-label="Cerrar" className="px-2 text-bone/60 hover:text-bone">
                ✕
              </button>
            </div>

            {/* Contadores por tipo de dado */}
            <div className="grid grid-cols-4 gap-2">
              {DICE_TYPES.map((die) => (
                <div
                  key={die}
                  className={`relative select-none rounded-sm border py-2 text-center transition-colors ${
                    dice.pool[die] > 0 ? 'border-gold/60 bg-gold/10' : 'border-bone/15 hover:border-bone/40'
                  }`}
                >
                  <button
                    onClick={() => dice.incDie(die, 1)}
                    className="w-full"
                    aria-label={`Añadir ${die}`}
                  >
                    <div className="font-display text-sm text-gold/90">{die}</div>
                    <div className="font-mono text-lg">{dice.pool[die]}</div>
                  </button>
                  {dice.pool[die] > 0 && (
                    <button
                      onClick={() => dice.incDie(die, -1)}
                      aria-label={`Quitar ${die}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-bone/30 bg-night-950 text-xs text-bone/80 hover:text-bone"
                    >
                      −
                    </button>
                  )}
                </div>
              ))}

              {/* Modificador */}
              <div className="rounded-sm border border-bone/15 py-2 text-center">
                <div className="font-display text-sm text-gold/90">Mod.</div>
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => dice.incModifier(-1)}
                    className="px-1 text-bone/60 hover:text-bone"
                    aria-label="Restar modificador"
                  >
                    −
                  </button>
                  <span className="w-8 font-mono text-lg">
                    {dice.modifier >= 0 ? `+${dice.modifier}` : dice.modifier}
                  </span>
                  <button
                    onClick={() => dice.incModifier(1)}
                    className="px-1 text-bone/60 hover:text-bone"
                    aria-label="Sumar modificador"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Ventaja / desventaja (solo afecta a los d20) */}
            <div className="mt-3 flex items-center gap-2">
              <div className="flex flex-1 gap-1 rounded-sm border border-bone/15 p-1">
                {ADVANTAGE_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => dice.setAdvantage(value)}
                    className={`flex-1 rounded-sm py-1 font-display text-xs tracking-wide transition-colors ${
                      dice.advantage === value ? 'bg-gold/80 text-night-950' : 'text-bone/60 hover:text-bone'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={dice.clearPool}
                className="rounded-sm border border-bone/15 px-2 py-1.5 text-xs text-bone/60 hover:text-bone"
              >
                Limpiar
              </button>
            </div>

            {inRoom && isDm && (
              <label className="mt-2 flex items-center gap-2 text-sm text-bone/70">
                <input
                  type="checkbox"
                  checked={dice.hidden}
                  onChange={(e) => dice.setHidden(e.target.checked)}
                  className="accent-gold"
                />
                Tirada oculta (solo la ves tú)
              </label>
            )}

            <button
              onClick={dice.roll}
              disabled={!hasDice}
              className="mt-3 w-full rounded-sm bg-gold py-2 font-display text-lg tracking-wider text-night-950 transition-colors hover:bg-gold/90 disabled:opacity-40"
            >
              Tirar
            </button>

            {/* Resultado con animación de giro/aparición */}
            <AnimatePresence mode="wait">
              {dice.lastRoll && (
                <motion.div
                  key={dice.rollId}
                  initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="mt-3"
                >
                  <RollCard roll={dice.lastRoll} />
                  {inRoom && (
                    <p className="mt-1 text-right text-xs text-bone/50">
                      {dice.lastRoll.shared ? 'Compartida con la mesa' : 'Solo local'}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {dice.history.length > 1 && (
              <details className="mt-3">
                <summary className="cursor-pointer font-display text-sm text-bone/60 hover:text-bone">
                  Historial
                </summary>
                <div className="mt-2 space-y-1">
                  {dice.history.slice(1, 10).map((r) => (
                    <RollCard key={r.at} roll={r} compact />
                  ))}
                </div>
              </details>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
