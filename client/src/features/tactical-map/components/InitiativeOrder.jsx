import { useState } from 'react';
import { useRoom } from '../../../store/socket.js';
import { rollPool } from '../../../lib/dice.js';
import { TurnBadges, ConditionChips, DeathSaveDots, ConditionEditor } from './CombatantStatus.jsx';

// Barritas de vida y color por proporción (mismo criterio que el resto de la mesa)
function hpColor(ratio) {
  return ratio > 0.5 ? 'bg-moss' : ratio > 0.25 ? 'bg-ochre' : 'bg-blood';
}

/**
 * Orden de iniciativa compacto para el tablero: durante el combate ocupa el
 * sitio del panel de "Tokens" (arriba a la derecha). Vista rápida de un
 * vistazo; la gestión completa (añadir/editar/quitar combatientes) vive en
 * InitiativeTracker, dentro del cajón del DM — ambos comparten las mismas
 * piezas visuales de estado (CombatantStatus.jsx) para no divergir.
 */
export default function InitiativeOrder({ combat, isDm, userId, ownerByCharId }) {
  const room = useRoom();
  const [conditionsFor, setConditionsFor] = useState(null); // combatantId con el editor de condiciones abierto

  async function rollDeathSave(c) {
    const roll = rollPool({ d20: 1 }, { kind: 'check', label: 'Salvación de muerte', actorName: c.name });
    const natural = roll.groups.find((g) => g.sides === 20)?.results[0]?.kept ?? roll.total;
    const resp = await room.deathSave(c.id, roll, natural);
    if (resp?.error) window.alert(resp.error);
  }

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="font-display text-xs uppercase tracking-widest text-gold/80">Iniciativa</p>
        <span className="font-mono text-[0.65rem] text-bone/50">Ronda {combat.round}</span>
      </div>

      {combat.combatants.length === 0 && (
        <p className="px-1 py-2 text-center text-[0.7rem] italic text-bone/40">Sin combatientes.</p>
      )}

      {combat.combatants.map((c) => {
        const active = combat.turnId === c.id;
        const mine = c.kind === 'pj' && ownerByCharId?.[c.characterId] === userId;
        const knowsHp = Number.isInteger(c.hpCurrent) && Number.isInteger(c.hpMax) && c.hpMax > 0;
        const ratio = knowsHp ? Math.max(0, Math.min(1, c.hpCurrent / c.hpMax)) : 0;
        const canRollSave = c.downed && !c.dead && (mine || isDm);
        return (
          <div
            key={c.id}
            className={`rounded-sm border px-2 py-1.5 ${active ? 'border-gold bg-gold/10' : 'border-transparent'} ${
              c.downed ? 'opacity-90' : ''
            }`}
          >
            <div className="flex items-center gap-1.5">
              {active && <span className="text-[0.6rem] text-gold">▶</span>}
              <span className={`min-w-0 flex-1 truncate text-sm ${c.kind === 'enemigo' ? 'text-blood/90' : 'text-bone'}`}>
                {c.name}
              </span>
              <TurnBadges combatant={c} />
              <span className="font-mono text-[0.65rem] text-bone/50">{c.initiative}</span>
            </div>

            {knowsHp && (
              <div className="mt-1 flex items-center gap-1.5">
                <span className="h-1 flex-1 overflow-hidden rounded-sm bg-night-950">
                  <span className={`block h-full ${hpColor(ratio)}`} style={{ width: `${ratio * 100}%` }} />
                </span>
                <span className="font-mono text-[0.6rem] text-bone/50">
                  {c.hpCurrent}/{c.hpMax}
                </span>
              </div>
            )}

            <ConditionChips conditions={c.conditions} />

            {/* PJ muerto de verdad (3 fallos): estado final */}
            {c.dead && (
              <p className="mt-1 text-center font-display text-[0.65rem] uppercase tracking-widest text-blood">
                ☠ Muerto
              </p>
            )}

            {/* Salvaciones de muerte de un PJ agonizante */}
            {c.downed && !c.dead && (
              <div className="mt-1 flex items-center justify-between gap-2">
                <DeathSaveDots saves={c.deathSaves} />
                {canRollSave && (
                  <button
                    onClick={() => rollDeathSave(c)}
                    className="rounded-sm border border-blood/50 px-1.5 py-0.5 text-[0.6rem] text-blood hover:bg-blood/10"
                  >
                    Tirar salvación
                  </button>
                )}
              </div>
            )}

            {/* Controles del DM: saltar turno del activo y editar condiciones */}
            {isDm && (
              <div className="mt-1 flex items-center gap-1">
                {active && (
                  <button
                    onClick={() => room.nextTurn()}
                    className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-[0.6rem] text-gold hover:bg-gold/10"
                  >
                    Saltar turno
                  </button>
                )}
                <button
                  onClick={() => setConditionsFor(conditionsFor === c.id ? null : c.id)}
                  className="ml-auto rounded-sm border border-bone/20 px-1.5 py-0.5 text-[0.6rem] text-bone/60 hover:text-bone"
                >
                  Condiciones
                </button>
              </div>
            )}

            {isDm && conditionsFor === c.id && (
              <ConditionEditor conditions={c.conditions} onToggle={(key) => room.toggleCondition(c.id, key)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
