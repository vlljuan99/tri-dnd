import { useEffect, useState } from 'react';
import { useRoom } from '../../../store/socket.js';

// Cartel de aviso a pantalla cuando ARRANCA el combate (por descubrir enemigos
// o por el botón del DM). Se dispara con el contador `combatAlert` del store
// —que sube al recibir el evento 'combat:started'— y muestra el orden de
// iniciativa un instante antes de desvanecerse. No decide nada de reglas: solo
// avisa; el estado real vive en `combat`.
export default function CombatAlert() {
  const alert = useRoom((s) => s.combatAlert);
  const combat = useRoom((s) => s.combat);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (alert === 0) return undefined; // no mostrar en el primer render
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [alert]);

  if (!visible) return null;

  const order = [...combat.combatants].sort((a, b) => b.initiative - a.initiative);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div className="animate-[combatPop_320ms_ease-out] rounded-md border-2 border-blood/70 bg-night-950/95 px-8 py-6 text-center shadow-2xl backdrop-blur">
        <p className="font-display text-4xl uppercase tracking-[0.25em] text-blood drop-shadow">
          ¡Combate!
        </p>
        <p className="mt-1 text-xs uppercase tracking-widest text-bone/60">Tirada de iniciativa</p>
        {order.length > 0 && (
          <ol className="mt-3 flex flex-col gap-1 text-sm">
            {order.map((c, i) => (
              <li key={c.id} className="flex items-center justify-center gap-2">
                <span className="w-5 text-right font-mono text-xs text-gold/70">{i + 1}.</span>
                <span className={c.kind === 'enemigo' ? 'text-blood/90' : 'text-bone'}>{c.name}</span>
                <span className="font-mono text-xs text-bone/50">({c.initiative})</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <style>{`@keyframes combatPop{0%{transform:scale(0.8);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}
