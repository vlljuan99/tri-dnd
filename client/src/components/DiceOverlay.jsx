import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { DICE_TYPES } from '../lib/dice.js';
import { useDice } from '../store/dice.js';
import { useRoom } from '../store/socket.js';
import { useAuth } from '../store/auth.js';
import { dadosDeTirada } from '../features/dice-tray/lib/supported.js';
import { latestMessageId, pickIncomingRoll } from '../features/dice-tray/lib/incoming.js';
import RollCard from './RollCard.jsx';

// La bandeja arrastra three.js y react-three-fiber. Este tirador vive en el
// bundle principal (el botón flotante está en todas las pantallas), así que la
// bandeja se carga aparte y solo la primera vez que ruedan dados de verdad: en
// la pantalla de acceso o en la ficha no se descarga nada de 3D.
const DiceTray = lazy(() => import('../features/dice-tray/components/DiceTray.jsx'));

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
  // Distancia recorrida durante el gesto actual: onTap de Framer Motion
  // puede disparar igualmente tras un arrastre corto, así que se decide a
  // mano si abrir el tirador según cuánto se movió el dedo/cursor.
  const dragDistance = useRef(0);

  // El número no se enseña hasta que los dados paran: si el total aparece
  // antes, el vuelo del dado no significa nada. `revealedId` marca la última
  // tirada ya asentada en la bandeja.
  const [revealedId, setRevealedId] = useState(0);
  // Quien haya pedido menos animación al sistema ve el resultado directo.
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );
  // Una tirada sin dados con cuerpo (solo modificador, por ejemplo) se lee al
  // instante en la tarjeta, sin esperar a una bandeja que no va a rodar.
  const tieneDadosFisicos = dadosDeTirada(dice.lastRoll).length > 0 && !reduceMotion;
  const resultadoVisible = !tieneDadosFisicos || revealedId >= dice.rollId;
  // `lastRoll` se queda en el store para siempre, así que "hay dados" no sirve
  // para saber si AHORA MISMO está rodando algo: eso es que la última tirada
  // propia aún no se ha asentado.
  const propiaEnVuelo = tieneDadosFisicos && revealedId < dice.rollId;

  // Las tiradas de los demás también ruedan: en una mesa, cuando alguien saca un
  // 20 se ve caer el dado, no llega una línea de texto. Se leen del store de la
  // sala y arrancan desde el último mensaje ya presente, para que al entrar no
  // se ponga a rodar el historial entero.
  const messages = useRoom((s) => s.messages);
  const selfId = useAuth((s) => s.user?.id);
  const baselineRef = useRef(null);
  if (baselineRef.current === null) baselineRef.current = latestMessageId(messages);
  const [ajena, setAjena] = useState(null);

  useEffect(() => {
    if (reduceMotion) return;
    const entrante = pickIncomingRoll(messages, { selfId, sinceId: baselineRef.current });
    if (!entrante) return;
    baselineRef.current = entrante.id;
    setAjena(entrante);
  }, [messages, reduceMotion, selfId]);

  // Red de seguridad: la bandeja se descarga bajo demanda y podría no llegar
  // (red caída, chunk que falla). El resultado de una tirada nunca puede
  // quedarse oculto por un problema de presentación, así que pasado el tiempo
  // máximo de un vuelo se enseña igualmente.
  const rollIdActual = dice.rollId;
  useEffect(() => {
    if (!tieneDadosFisicos || !rollIdActual) return undefined;
    const timer = setTimeout(() => setRevealedId(rollIdActual), 4000);
    return () => clearTimeout(timer);
  }, [rollIdActual, tieneDadosFisicos]);

  function saveFabPosition() {
    window.localStorage.setItem(
      FAB_POSITION_KEY,
      JSON.stringify({ x: Math.round(fabX.get()), y: Math.round(fabY.get()) })
    );
  }

  return (
    <>
      {/* Los dados ruedan sobre toda la pantalla, no dentro del panel: se ven
          igual con el tirador abierto o cerrado, y también cuando la tirada
          nace de la ficha o de un ataque. */}
      {/* Sin respaldo visible: mientras se descarga la bandeja no debe aparecer
          nada tapando la pantalla; el panel ya dice "Rodando…". */}
      {tieneDadosFisicos && (
        <Suspense fallback={null}>
          <DiceTray
            key={dice.rollId}
            roll={dice.lastRoll}
            rollId={dice.rollId}
            onSettled={() => setRevealedId(dice.rollId)}
          />
        </Suspense>
      )}

      {/* La tirada de otro jugador rueda con su nombre: en la mesa se ve quién
          tira. No compite con la propia porque solo una está en vuelo. */}
      {ajena && !propiaEnVuelo && (
        <Suspense fallback={null}>
          <DiceTray
            key={`ajena-${ajena.id}`}
            roll={ajena.roll}
            rollId={ajena.id}
            autorNombre={ajena.authorName}
            onSettled={() => setAjena(null)}
          />
        </Suspense>
      )}

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
        onPointerDown={() => {
          dragDistance.current = 0;
        }}
        onDrag={(_, info) => {
          dragDistance.current += Math.abs(info.delta.x) + Math.abs(info.delta.y);
        }}
        onDragEnd={saveFabPosition}
        onClick={() => {
          // Un arrastre real desplaza varios píxeles; un toque simple, casi nada
          if (dragDistance.current < 5) dice.toggleOpen();
        }}
        aria-label="Tirador de dados (arrastra para recolocarlo)"
        title="Arrastra para recolocarlo"
        className={`${inRoom ? 'tactical-dice-fab' : ''} fixed bottom-20 right-4 z-40 flex h-14 w-14 cursor-grab items-center justify-center rounded-full border border-gold/50 bg-night-900 text-gold shadow-lg shadow-black/40 active:cursor-grabbing`}
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

            {/* Mientras los dados ruedan por la pantalla, el panel no se queda
                en blanco: dice que la tirada está en el aire. */}
            {dice.lastRoll && !resultadoVisible && (
              <p className="mt-3 rounded-sm border border-gold/20 bg-night-950/60 px-3 py-2 text-center font-display text-sm tracking-widest text-gold/70">
                Rodando…
              </p>
            )}

            {/* Resultado con animación de giro/aparición */}
            <AnimatePresence mode="wait">
              {dice.lastRoll && resultadoVisible && (
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
