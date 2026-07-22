import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { SKILLS, skillBonus, formatModifier } from '../../../lib/dnd.js';
import { rollAttack } from '../../../lib/dice.js';
import { isLootInteraction } from '../domain/interactions.js';

const DOOR_LABELS = { puerta: 'Puerta', escalera: 'Escalera', portal: 'Portal' };

/**
 * Popup de interacción con puertas, trampas y objetos (Fase 8.7): confirmar
 * gasta la acción del turno, y si el DM asignó una habilidad, primero hay
 * que tirarla (dificultad oculta hasta resolver, igual que la CA en combate).
 * El servidor ya validó adyacencia y turno antes de llegar aquí; si rechaza,
 * el error se muestra tal cual.
 */
export default function InteractPanel({ type, target, campaignId, characterId, combat, onClose }) {
  const [char, setChar] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { success, dc, opened, consequence }
  const [looted, setLooted] = useState(null); // [{name, qty}] tras saquear
  const [lootConsequence, setLootConsequence] = useState(null);

  // Un marcador de botín se saquea (pasa al inventario), no se "interactúa"
  const isLoot = isLootInteraction(type, target);
  const skill = !isLoot && target.skill ? SKILLS.find((s) => s.index === target.skill) : null;

  async function loot() {
    setBusy(true);
    setError('');
    try {
      const resp = await api(`/campaigns/${campaignId}/marcadores/${target.serverId}/saquear`, {
        method: 'POST',
        body: { characterId },
      });
      setLooted(resp.looted ?? []);
      setLootConsequence(
        resp.consequence
          ? { text: resp.consequence, scope: resp.consequenceScope ?? 'player' }
          : null
      );
    } catch (e) {
      setError(e.message || 'No se pudo saquear.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    api(`/characters/${characterId}`)
      .then(({ character }) => {
        if (!cancelled) setChar(character);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar tu ficha.');
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, skill]);

  const myCombatant = combat?.combatants?.find((c) => c.characterId === characterId);
  const myTurnActive = combat?.active && combat.turnId === myCombatant?.id;
  const disabled = busy || Boolean(result) || (combat?.active && !myTurnActive);
  const disabledReason =
    combat?.active && !myTurnActive ? 'Solo puedes interactuar en tu turno' : 'Gasta tu acción del turno';

  async function send(roll) {
    setBusy(true);
    setError('');
    try {
      const resp =
        type === 'door'
          ? await api(`/campaigns/${campaignId}/puertas/${target.id}/abrir`, {
              method: 'POST',
              body: { open: true, characterId, roll },
            })
          : await api(`/campaigns/${campaignId}/marcadores/${target.serverId}/interactuar`, {
              method: 'POST',
              body: { characterId, roll },
            });
      setResult({
        success: resp.success !== false,
        dc: resp.dc,
        opened: resp.opened,
        consequence: resp.consequence ?? '',
        consequenceScope: resp.consequenceScope ?? 'player',
      });
    } catch (e) {
      setError(e.message || 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (disabled) return;
    send();
  }

  function rollSkillCheck() {
    if (disabled || !char) return;
    const bonus = skillBonus(char, skill);
    const roll = rollAttack(bonus, { label: `Tirada de ${skill.name}`, actorName: char.name });
    send(roll);
  }

  const title = type === 'door' ? DOOR_LABELS[target.kind] ?? 'Puerta' : target.name;

  return (
    <div className="absolute bottom-20 left-1/2 z-20 w-[20rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-gold/30 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">{title}</p>
        <button onClick={onClose} aria-label="Cerrar" className="px-1 text-bone/60 hover:text-bone">
          ✕
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-blood">{error}</p>}

      {isLoot ? (
        looted ? (
          <div className="rounded-sm border border-gold/20 bg-night-950/60 p-2 text-sm">
            <p className="font-display uppercase tracking-widest text-gold">¡Saqueado!</p>
            <ul className="mt-1 space-y-0.5 text-xs text-bone/80">
              {looted.length === 0 ? (
                <li className="italic text-bone/50">No había nada.</li>
              ) : (
                looted.map((l, i) => (
                  <li key={i}>
                    {l.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                  </li>
                ))
              )}
            </ul>
            <p className="mt-1 text-[0.65rem] text-bone/40">Añadido a tu inventario.</p>
            {lootConsequence && (
              <div className="mt-2 rounded-sm border border-blood/25 bg-blood/10 p-2">
                <p className="text-[0.65rem] uppercase tracking-widest text-blood">
                  Consecuencia · {lootConsequence.scope === 'party' ? 'todo el grupo' : 'solo tú y el DM'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-bone/85">
                  {lootConsequence.text}
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-bone/70">Botín a tus pies.</p>
            <button
              onClick={loot}
              disabled={busy}
              className="w-full rounded-sm border border-gold/50 px-3 py-1.5 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
            >
              Saquear
            </button>
            <p className="mt-2 text-[0.65rem] text-bone/40">Pasa a tu inventario. No gasta la acción del turno.</p>
          </>
        )
      ) : (
        <>
      {!result && (
        <>
          {skill ? (
            <>
              <p className="mb-2 text-sm text-bone/70">Requiere una tirada de {skill.name}.</p>
              <button
                onClick={rollSkillCheck}
                disabled={disabled || !char}
                title={disabledReason}
                className="w-full rounded-sm border border-gold/50 px-3 py-1.5 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
              >
                {char ? `Tirar ${skill.name} (${formatModifier(skillBonus(char, skill))})` : 'Cargando…'}
              </button>
            </>
          ) : (
            <button
              onClick={confirm}
              disabled={disabled}
              title={disabledReason}
              className="w-full rounded-sm border border-gold/50 px-3 py-1.5 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
            >
              Confirmar
            </button>
          )}
        </>
      )}

      {result && (
        <div className="rounded-sm border border-bone/10 bg-night-950/60 p-2 text-sm">
          {Number.isInteger(result.dc) && (
            <p className="text-xs text-bone/50">Dificultad {result.dc}</p>
          )}
          <p
            className={`font-display uppercase tracking-widest ${
              result.success ? 'text-gold' : 'text-blood'
            }`}
          >
            {result.success ? '¡Conseguido!' : 'No lo consigues'}
          </p>
          {result.consequence && (
            <>
              <p className="mt-2 text-[0.65rem] uppercase tracking-widest text-bone/45">
                {result.consequenceScope === 'party' ? 'Visible para todo el grupo' : 'Visible solo para ti y el DM'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-bone/80">
                {result.consequence}
              </p>
            </>
          )}
        </div>
      )}

          <p className="mt-2 text-[0.65rem] text-bone/40">
            Interactuar gasta la acción del turno, tanto si lo consigues como si no.
          </p>
        </>
      )}
    </div>
  );
}
