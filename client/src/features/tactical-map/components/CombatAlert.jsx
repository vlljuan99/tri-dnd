import { useEffect, useRef, useState } from 'react';
import { useRoom } from '../../../store/socket.js';
import { useReveal } from '../../../store/reveal.js';

export function ScreenBanner({
  signal,
  ready = true,
  duration = 4200,
  skipInitial = false,
  compact = false,
  children,
}) {
  const [visible, setVisible] = useState(false);
  const [shownAt, setShownAt] = useState(0);
  const lastSignalRef = useRef(skipInitial ? signal : null);
  // Un cartel no pisa a unos dados en pantalla (Fase 4b): «¡Tu turno!» sale
  // cuando se retira el rótulo del último golpe, no encima de él.
  const diceOnScreen = useReveal((state) => state.activa != null);
  const canShow = ready && !diceOnScreen;

  useEffect(() => {
    if (signal == null || signal === 0) {
      // El aviso de turno usa null mientras actúa otra criatura. Olvidar aquí
      // la señal anterior permite avisar otra vez si el turno vuelve al mismo
      // PJ incluso antes de que cambie el número de ronda.
      if (skipInitial) lastSignalRef.current = null;
      return undefined;
    }
    if (!canShow || Object.is(lastSignalRef.current, signal)) return undefined;
    lastSignalRef.current = signal;
    setVisible(true);
    setShownAt((count) => count + 1);
    return undefined;
  }, [canShow, signal]);

  // El cierre va aparte: si después llegan dados, el cartel ya visible se
  // cierra a su hora igualmente.
  useEffect(() => {
    if (!shownAt) return undefined;
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [duration, shownAt]);

  useEffect(() => {
    if (!visible) return undefined;
    function dismissWithEscape(event) {
      if (event.key === 'Escape') setVisible(false);
    }
    window.addEventListener('keydown', dismissWithEscape);
    return () => window.removeEventListener('keydown', dismissWithEscape);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-night-950/10"
      onClick={() => setVisible(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-live="assertive"
        className={`relative animate-[screenBannerPop_360ms_ease-out] rounded-md border-2 bg-night-950/95 text-center shadow-2xl backdrop-blur ${
          compact ? 'border-gold/60 px-7 py-4' : 'border-blood/70 px-8 py-6'
        }`}
      >
        <button
          type="button"
          aria-label="Cerrar aviso"
          title="Cerrar"
          onClick={() => setVisible(false)}
          className="absolute right-2 top-1 text-lg text-bone/40 hover:text-bone"
        >
          ×
        </button>
        {children}
      </div>
      <style>{`@keyframes screenBannerPop{0%{transform:scale(0.8);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

// Espera al tracker si la señal llega primero: el cartel nunca enseña un orden
// vacío por una carrera entre `combat:started` y `combat:state`.
export default function CombatAlert() {
  const alert = useRoom((state) => state.combatAlert);
  const combat = useRoom((state) => state.combat);
  const order = [...combat.combatants].sort((a, b) => b.initiative - a.initiative);

  return (
    <ScreenBanner signal={alert} ready={order.length > 0} duration={5000}>
      <p className="font-display text-4xl uppercase tracking-[0.25em] text-blood drop-shadow">
        ¡Combate!
      </p>
      <p className="mt-1 text-xs uppercase tracking-widest text-bone/60">Tirada de iniciativa</p>
      <ol className="mt-3 flex flex-col gap-1 text-sm">
        {order.map((combatant, index) => (
          <li key={combatant.id} className="flex items-center justify-center gap-2">
            <span className="w-5 text-right font-mono text-xs text-gold/70">{index + 1}.</span>
            <span className={combatant.kind === 'enemigo' ? 'text-blood/90' : 'text-bone'}>
              {combatant.name}
            </span>
            <span className="font-mono text-xs text-bone/50">({combatant.initiative})</span>
          </li>
        ))}
      </ol>
    </ScreenBanner>
  );
}

export function TurnAlert({ trigger }) {
  return (
    <ScreenBanner signal={trigger} duration={2200} skipInitial compact>
      <p className="font-display text-2xl uppercase tracking-[0.2em] text-gold drop-shadow">
        ¡Tu turno!
      </p>
      <p className="mt-1 text-xs text-bone/60">Es hora de actuar.</p>
    </ScreenBanner>
  );
}
