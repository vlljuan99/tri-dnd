import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRoom } from '../../../store/socket.js';
import { useAuth } from '../../../store/auth.js';
import { agitarActivado, esSacudida } from '../lib/shake.js';

// Tiradas pendientes (Fase 4c). El servidor espera a que el dueño de un PJ
// pulse «Tirar» en sus salvaciones, su iniciativa o lo que pide el DM; si no
// pulsa en unos segundos, tira solo. Aquí vive el aviso para el jugador y el
// panel del DM con lo que falta por tirar.
//
// Nada de esto tira nada: el botón solo le dice al servidor «ya»; el número
// lo saca él y llega por la mesa como cualquier otra tirada.

const TITULOS = {
  iniciativa: '¡Tira iniciativa!',
  concentracion: '¡Mantén la concentración!',
};

function tituloDe(pending) {
  return TITULOS[pending.tipo] ?? `¡${pending.etiqueta}!`;
}

/** Segundos que le quedan, con la hora del servidor como referencia. */
function useRestante(plazo) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAhora(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, (Number(plazo) || 0) - ahora);
}

function Cuenta({ plazo, total = 8000 }) {
  const restante = useRestante(plazo);
  const ratio = Math.max(0, Math.min(1, restante / total));
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="h-1 overflow-hidden rounded-full bg-night-950">
        <div className="h-full bg-gold/80 transition-[width] duration-200 ease-linear" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1 text-[0.65rem] text-bone/45">Se tirará sola en {Math.ceil(restante / 1000)} s</p>
    </div>
  );
}

/** El aviso del jugador: su tirada, un botón grande y la cuenta atrás. */
function AvisoPropio({ pending, pendientes, onTirar, onSiempreAuto }) {
  const reducir = useReducedMotion();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function tirar() {
    if (enviando) return;
    setEnviando(true);
    setError('');
    const resp = await onTirar(pending.id);
    if (resp?.error) setError(resp.error);
    setEnviando(false);
  }

  return (
    <motion.div
      key={pending.id}
      initial={reducir ? false : { opacity: 0, y: -16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      role="alertdialog"
      aria-label={tituloDe(pending)}
      className="pointer-events-auto w-[min(92vw,22rem)] rounded-md border-2 border-gold/60 bg-night-950/95 p-4 text-center text-bone shadow-2xl shadow-black/70 backdrop-blur"
    >
      <p className="font-display text-[0.65rem] uppercase tracking-[0.25em] text-gold/70">
        {pending.nombre ?? 'Tu personaje'}
        {pendientes > 1 ? ` · ${pendientes - 1} más después` : ''}
      </p>
      <h2 className="mt-1 font-display text-2xl tracking-wide text-gold">{tituloDe(pending)}</h2>
      {pending.origen && <p className="mt-0.5 text-sm text-bone/70">{pending.origen}</p>}
      {pending.cd != null && <p className="mt-0.5 text-xs text-bone/50">CD {pending.cd}</p>}
      <button
        type="button"
        autoFocus
        onClick={tirar}
        disabled={enviando}
        className="mt-3 w-full rounded-sm bg-gold py-2.5 font-display text-lg tracking-[0.2em] text-night-950 shadow-lg shadow-gold/20 transition hover:bg-gold/90 disabled:opacity-60"
      >
        {enviando ? 'Tirando…' : 'Tirar'}
      </button>
      {error && <p className="mt-2 text-xs text-blood">{error}</p>}
      <Cuenta plazo={pending.plazo} />
      <button
        type="button"
        onClick={onSiempreAuto}
        className="mt-2 text-[0.65rem] text-bone/40 underline decoration-dotted hover:text-bone/70"
      >
        Tirar siempre automáticamente
      </button>
    </motion.div>
  );
}

function FilaPendiente({ pending, onTirar }) {
  const restante = useRestante(pending.plazo);
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 truncate">
        <span className="text-bone/90">{pending.nombre ?? '—'}</span>
        <span className="text-bone/45"> · {pending.etiqueta}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-[0.65rem] text-gold/70">⏳ {Math.ceil(restante / 1000)} s</span>
        <button
          type="button"
          onClick={() => onTirar(pending.id)}
          className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-[0.65rem] text-gold hover:bg-gold/10"
        >
          Tirar ya
        </button>
      </span>
    </li>
  );
}

/** Panel del DM: quién falta por tirar, y lo que acaba de salir. */
function PanelDelDm({ pendientes, resultados, onTirar, onTirarTodas }) {
  if (!pendientes.length && !resultados.length) return null;
  return (
    <div className="pointer-events-auto fixed right-3 top-[7.5rem] z-[55] w-[min(92vw,18rem)] rounded-sm border border-gold/30 bg-night-950/95 p-2.5 text-xs text-bone shadow-2xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-display text-[0.65rem] uppercase tracking-widest text-gold/80">Tiradas pendientes</p>
        {pendientes.length > 1 && (
          <button type="button" onClick={onTirarTodas} className="text-[0.65rem] text-gold hover:underline">
            Tirar todas
          </button>
        )}
      </div>
      <ul className="divide-y divide-bone/10">
        {resultados.map((resultado) => (
          <li key={`r-${resultado.id}`} className="flex items-center justify-between gap-2 py-1 text-bone/70">
            <span className="min-w-0 truncate">
              {resultado.nombre ?? '—'}
              <span className="text-bone/40"> · {resultado.etiqueta}</span>
            </span>
            <span className="shrink-0 font-mono">
              {resultado.exito === true ? <span className="text-moss">✓ </span> : null}
              {resultado.exito === false ? <span className="text-blood">✗ </span> : null}
              {resultado.total}
              {resultado.motivo === 'plazo' && <span className="ml-1 text-bone/35">(sola)</span>}
            </span>
          </li>
        ))}
        {pendientes.map((pending) => (
          <FilaPendiente key={pending.id} pending={pending} onTirar={onTirar} />
        ))}
      </ul>
    </div>
  );
}

export default function PendingRolls() {
  const pendingRolls = useRoom((s) => s.pendingRolls);
  const pendingResults = useRoom((s) => s.pendingResults);
  const role = useRoom((s) => s.role);
  const resolvePendingRoll = useRoom((s) => s.resolvePendingRoll);
  const forcePendingRolls = useRoom((s) => s.forcePendingRolls);
  const userId = useAuth((s) => s.user?.id);
  const setAutoRolls = useAuth((s) => s.setAutoRolls);
  const isDm = role === 'dm';

  const propias = pendingRolls.filter((pending) => pending.ownerUserId === userId);
  const ajenas = isDm ? pendingRolls.filter((pending) => pending.ownerUserId !== userId) : [];
  const primera = propias[0] ?? null;

  // Agitar el móvil para tirar (opcional, apagado por defecto)
  const primeraRef = useRef(primera);
  primeraRef.current = primera;
  useEffect(() => {
    if (!primera || !agitarActivado() || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      return undefined;
    }
    let ultima = 0;
    function onMotion(event) {
      if (!esSacudida(event.accelerationIncludingGravity ?? event.acceleration)) return;
      const ahora = Date.now();
      if (ahora - ultima < 1500) return;
      ultima = ahora;
      if (primeraRef.current) resolvePendingRoll(primeraRef.current.id);
    }
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [primera?.id, resolvePendingRoll]);

  async function siempreAuto() {
    try {
      await setAutoRolls(true);
    } catch {
      // Si falla la preferencia, al menos esta tirada sale ya
    }
    if (primera) resolvePendingRoll(primera.id);
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-[14vh] z-[62] flex justify-center px-4 md:top-[24vh]">
        <AnimatePresence mode="wait">
          {primera && (
            <AvisoPropio
              key={primera.id}
              pending={primera}
              pendientes={propias.length}
              onTirar={resolvePendingRoll}
              onSiempreAuto={siempreAuto}
            />
          )}
        </AnimatePresence>
      </div>
      {isDm && (
        <PanelDelDm
          pendientes={ajenas}
          resultados={pendingResults.filter((resultado) => resultado.ownerUserId !== userId)}
          onTirar={resolvePendingRoll}
          onTirarTodas={() => forcePendingRolls(ajenas.map((pending) => pending.id))}
        />
      )}
    </>
  );
}
