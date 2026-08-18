import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { useRoom } from '../../../store/socket.js';
import { availableSlotsFor, equipItem, SLOT_LABELS } from '../../../lib/equipment.js';

/**
 * Panel de inventario del tablero (Fase 8.6), separado del panel de ataque:
 * consultar objetos, armas y equipo de un personaje, y usar los no-armas
 * (pociones, pergaminos...) en tu propio turno. Usar un objeto gasta la
 * acción, igual que atacar — el servidor lo valida y lo aplica.
 *
 * Fase E: también se equipa desde aquí. Lo que se saquea de un cofre llega con
 * sus datos de arma o armadura, así que empuñarlo no debería obligar a salir
 * del tablero e ir a la ficha. El servidor revalida los slots y recalcula la
 * CA, como en cualquier otra escritura del inventario.
 */
export default function InventoryPanel({ token, isOwner, isDm, combat, onClose, onInventoryChange }) {
  const useItem = useRoom((s) => s.useItem);
  const [char, setChar] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null); // id del objeto en uso

  useEffect(() => {
    let cancelled = false;
    setChar(null);
    setError('');
    api(`/characters/${token.characterId}`)
      .then(({ character }) => {
        if (!cancelled) setChar(character);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar el inventario.');
      });
    return () => {
      cancelled = true;
    };
  }, [token.characterId]);

  const myCombatant = combat?.combatants?.find((c) => c.characterId === token.characterId);
  const myTurnActive = combat?.active && combat.turnId === myCombatant?.id;
  const canUse = isOwner || isDm;

  async function use(item) {
    if (!canUse || busy) return;
    setBusy(item.id);
    setError('');
    const resp = await useItem(token.characterId, item.id);
    setBusy(null);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    setChar((c) => ({
      ...c,
      inventory:
        resp.remainingQty > 0
          ? c.inventory.map((i) => (i.id === item.id ? { ...i, qty: resp.remainingQty } : i))
          : c.inventory.filter((i) => i.id !== item.id),
    }));
    onInventoryChange?.();
  }

  // Equipar/desequipar desde la mesa. Se manda el inventario recién leído del
  // servidor con el cambio aplicado; si el servidor lo rechaza (slot ocupado,
  // arma a dos manos…) se enseña su error y no se toca el estado local.
  async function changeSlot(item, slot) {
    if (!isOwner || busy) return;
    setBusy(item.id);
    setError('');
    try {
      const { character } = await api(`/characters/${token.characterId}`);
      const inventory = equipItem(character.inventory, item.id, slot || null);
      const updated = await api(`/characters/${token.characterId}`, { method: 'PUT', body: { inventory } });
      setChar(updated.character);
      onInventoryChange?.();
    } catch (e) {
      setError(e.message || 'No se pudo equipar.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="absolute bottom-20 left-1/2 z-20 w-[22rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-gold/30 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">
          Inventario de {token.name}
        </p>
        <button onClick={onClose} aria-label="Cerrar inventario" className="px-1 text-bone/60 hover:text-bone">
          ✕
        </button>
      </div>

      {!char && !error && <p className="text-sm text-bone/50">Cargando…</p>}
      {error && <p className="mb-2 text-xs text-blood">{error}</p>}

      {char && char.inventory.length === 0 && (
        <p className="text-sm text-bone/50">Inventario vacío.</p>
      )}

      {char && char.inventory.length > 0 && (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {char.inventory.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-bone/10 bg-night-950/60 px-2 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate">
                {item.name}
                <span className="ml-1.5 font-mono text-xs text-bone/50">×{item.qty}</span>
                {item.weapon && <span className="ml-1.5 text-xs text-bone/40">(arma)</span>}
                {item.slot && (
                  <span className="ml-1.5 text-xs text-gold/70">{SLOT_LABELS[item.slot]}</span>
                )}
              </span>
              {isOwner && availableSlotsFor(item).length > 0 ? (
                <select
                  value={item.slot ?? ''}
                  disabled={busy === item.id}
                  onChange={(e) => changeSlot(item, e.target.value)}
                  aria-label={`Dónde llevas ${item.name}`}
                  className="shrink-0 rounded-sm border border-bone/20 bg-night-950 px-1.5 py-0.5 text-xs text-bone/80 disabled:opacity-40"
                >
                  <option value="">Mochila</option>
                  {availableSlotsFor(item).map((slot) => (
                    <option key={slot} value={slot}>
                      {SLOT_LABELS[slot]}
                    </option>
                  ))}
                </select>
              ) : item.weapon ? (
                <span className="shrink-0 text-xs text-bone/40">ataca desde tu token</span>
              ) : canUse ? (
                <button
                  onClick={() => use(item)}
                  disabled={busy === item.id || (combat?.active && !myTurnActive)}
                  title={
                    combat?.active && !myTurnActive
                      ? 'Solo puedes usar objetos en tu turno'
                      : 'Gasta tu acción del turno'
                  }
                  className="shrink-0 rounded-sm border border-gold/50 px-2 py-0.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
                >
                  Usar
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[0.65rem] text-bone/40">
        Usar un objeto gasta la acción del turno; no resuelve su efecto solo (tira los dados que haga falta).
      </p>
    </div>
  );
}
