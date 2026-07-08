import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import {
  CLASS_NAMES,
  SCHOOL_NAMES,
  formatModifier,
  spellAttackBonus,
  spellSaveDC,
} from '../../../lib/dnd.js';
import { castSpellRoll } from '../../../lib/spellcasting.js';
import { useRoom } from '../../../store/socket.js';
import WeaponRow from '../../../components/WeaponRow.jsx';

/**
 * Ficha en modal de consulta rápida (Fase 8.6, pulido): pensada para mirar y
 * cerrar sin perder el tablero de vista. Solo lectura salvo las tiradas de
 * ataque/hechizo — para editar inventario, notas de clase, etc., sigue
 * existiendo la ficha completa en /personajes/:id.
 */
export default function CharacterQuickView({ characterId, onClose }) {
  const submitRoll = useRoom((s) => s.sendRoll);
  const [char, setChar] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/characters/${characterId}`)
      .then(({ character }) => {
        if (!cancelled) setChar(character);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar la ficha.');
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  function onRoll(roll) {
    if (roll) submitRoll(roll);
  }

  async function castSpell(spell, mode) {
    const roll = await castSpellRoll(char, spell, mode);
    onRoll(roll);
  }

  const weapons = char?.inventory.filter((i) => i.weapon && i.equipped) ?? [];
  const preparedSpells = char
    ? (char.spells.known ?? []).filter((s) => (char.spells.prepared ?? []).includes(s.index))
    : [];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-night-950/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-md border border-gold/30 bg-night-900 p-4 text-bone shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {error && <p className="text-sm text-blood">{error}</p>}
        {!char && !error && <p className="text-sm text-bone/50">Cargando…</p>}

        {char && (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {char.avatar_path ? (
                  <img
                    src={char.avatar_path}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-full border border-gold/40 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-night-950 font-display text-xl text-gold/70">
                    {char.name?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-lg text-gold">{char.name}</p>
                  <p className="truncate text-xs text-bone/60">
                    {CLASS_NAMES[char.class_index] ?? 'Sin clase'} · nv. {char.level}
                  </p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar ficha" className="shrink-0 px-1 text-bone/60 hover:text-bone">
                ✕
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              <span className="rounded-sm border border-blood/40 bg-blood/5 px-2 py-1 font-mono">
                HP {char.hp_current}/{char.hp_max}
              </span>
              <span className="rounded-sm border border-bone/15 px-2 py-1 font-mono">CA {char.ac}</span>
              <span className="rounded-sm border border-bone/15 px-2 py-1 font-mono">
                {char.speed} pies ({Math.floor((char.speed ?? 0) / 5)} cas)
              </span>
            </div>

            <section className="mb-3">
              <h3 className="mb-1.5 font-display text-xs uppercase tracking-widest text-gold/70">Ataques</h3>
              {weapons.length === 0 ? (
                <p className="text-sm text-bone/50">Sin armas equipadas.</p>
              ) : (
                <div className="space-y-1.5">
                  {weapons.map((item) => (
                    <WeaponRow key={item.id} item={item} char={char} onRoll={onRoll} disabled={false} />
                  ))}
                </div>
              )}
            </section>

            {preparedSpells.length > 0 && (
              <section>
                <h3 className="mb-1.5 font-display text-xs uppercase tracking-widest text-gold/70">
                  Hechizos preparados
                </h3>
                <p className="mb-1.5 text-xs text-bone/50">
                  Ataque {formatModifier(spellAttackBonus(char))} · CD {spellSaveDC(char)}
                </p>
                <ul className="space-y-1.5">
                  {preparedSpells.map((spell) => (
                    <li key={spell.index} className="flex items-center justify-between gap-2 rounded-sm border border-bone/10 px-2 py-1.5">
                      <span className="min-w-0 truncate text-sm">
                        {spell.name}
                        <span className="ml-1.5 text-xs text-bone/40">
                          {spell.level === 0 ? 'truco' : `nv. ${spell.level}`}
                          {spell.school && ` · ${SCHOOL_NAMES[spell.school] ?? spell.school}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {spell.attackType && (
                          <button
                            onClick={() => castSpell(spell, 'attack')}
                            className="rounded-sm border border-gold/40 px-2 py-0.5 text-xs text-gold hover:bg-gold/10"
                          >
                            Ataque
                          </button>
                        )}
                        {spell.hasDamage && (
                          <button
                            onClick={() => castSpell(spell, 'damage')}
                            className="rounded-sm border border-bone/30 px-2 py-0.5 text-xs hover:bg-bone/10"
                          >
                            Daño
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
