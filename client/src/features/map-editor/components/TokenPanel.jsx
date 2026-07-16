import { useEffect, useState } from 'react';
import { SKILLS } from '../../../lib/dnd.js';
import SrdPicker from '../../../components/SrdPicker.jsx';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

const KIND_LABELS = { enemigo: 'Enemigo', aliado: 'Aliado / PNJ', objeto: 'Objeto', trampa: 'Trampa' };

const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `loot-${Date.now()}-${Math.random()}`);

// Campo numérico de override: vacío = usar el valor del SRD/jefe
function OverrideNumber({ label, value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <input
        type="number"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${inputClass} text-center font-mono`}
      />
    </label>
  );
}

// Panel lateral del marcador seleccionado (enemigo, aliado, objeto o trampa)
export default function TokenPanel({ token, roomName, busy, onPatch, onDelete, onSaveTemplate }) {
  const [name, setName] = useState(token.name);
  // Variante por instancia (miniboss) y botín: estado local editable
  const [overrides, setOverrides] = useState(token.overrides ?? {});
  const [loot, setLoot] = useState(token.loot ?? []);
  const [successConsequence, setSuccessConsequence] = useState(token.successConsequence ?? '');
  const [failureConsequence, setFailureConsequence] = useState(token.failureConsequence ?? '');
  const [lootPicker, setLootPicker] = useState(false);
  const [lootText, setLootText] = useState('');

  useEffect(() => {
    setName(token.name);
    setOverrides(token.overrides ?? {});
    setLoot(token.loot ?? []);
    setSuccessConsequence(token.successConsequence ?? '');
    setFailureConsequence(token.failureConsequence ?? '');
  }, [token]);

  const isEnemy = token.kind === 'enemigo';
  const setOv = (k, v) => setOverrides((o) => ({ ...o, [k]: v }));

  function saveOverrides(next = overrides) {
    // Se limpian los campos vacíos/no numéricos para no guardar ruido
    const clean = {};
    for (const k of ['hp', 'ac', 'speed', 'attackBonus', 'damageBonus']) {
      if (Number.isInteger(next[k])) clean[k] = next[k];
    }
    if (Array.isArray(next.traits) && next.traits.length) clean.traits = next.traits;
    onPatch(token.id, { overrides: clean });
  }

  function addTrait() {
    const next = { ...overrides, traits: [...(overrides.traits ?? []), { name: 'Rasgo', desc: '' }] };
    setOverrides(next);
    saveOverrides(next);
  }
  function patchTrait(i, fields) {
    const traits = (overrides.traits ?? []).map((t, idx) => (idx === i ? { ...t, ...fields } : t));
    setOverrides((o) => ({ ...o, traits }));
  }
  function removeTrait(i) {
    const next = { ...overrides, traits: (overrides.traits ?? []).filter((_, idx) => idx !== i) };
    setOverrides(next);
    saveOverrides(next);
  }

  // --- Botín ---
  function saveLoot(next) {
    setLoot(next);
    onPatch(token.id, { loot: next });
  }
  function addLootEntry(entry) {
    saveLoot([...loot, entry]);
  }
  function patchLoot(id, fields) {
    saveLoot(loot.map((l) => (l.id === id ? { ...l, ...fields } : l)));
  }
  function removeLoot(id) {
    saveLoot(loot.filter((l) => l.id !== id));
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="font-display text-sm text-gold">{KIND_LABELS[token.kind]}</p>
        <p className="mt-1 text-xs text-bone/65">
          {roomName} · casilla ({token.x}, {token.y})
          {token.monsterIndex && <> · SRD: {token.monsterIndex}</>}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="token-name">Nombre</label>
        <div className="mt-1 flex gap-2">
          <input id="token-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            disabled={busy || !name.trim() || name.trim() === token.name}
            onClick={() => onPatch(token.id, { name: name.trim() })}
            className="shrink-0 rounded-sm border border-gold/30 px-2 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </div>

      <div>
        <p className={labelClass}>Tipo</p>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={busy}
              onClick={() => onPatch(token.id, { kind })}
              className={`rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
                token.kind === kind
                  ? 'border-gold bg-gold/15 text-gold'
                  : 'border-bone/20 text-bone/70 hover:border-bone/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Variante por instancia (miniboss, Fase 17): solo enemigos */}
      {isEnemy && (
        <div className="rounded-sm border border-gold/15 bg-night-950/40 p-2">
          <p className={labelClass}>Variante de esta instancia (miniboss)</p>
          <p className="mt-1 text-[0.65rem] text-bone/45">
            Sobrescribe los stats de este enemigo concreto sin crear otra ficha. Vacío = usar los del
            compendio/jefe. Se aplica al aparecer en el tablero.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <OverrideNumber label="PG" value={overrides.hp} onChange={(v) => setOv('hp', v)} placeholder="SRD" />
            <OverrideNumber label="CA" value={overrides.ac} onChange={(v) => setOv('ac', v)} placeholder="SRD" />
            <OverrideNumber label="Vel (pies)" value={overrides.speed} onChange={(v) => setOv('speed', v)} placeholder="SRD" />
            <OverrideNumber label="Ataque +" value={overrides.attackBonus} onChange={(v) => setOv('attackBonus', v)} placeholder="0" />
            <OverrideNumber label="Daño +" value={overrides.damageBonus} onChange={(v) => setOv('damageBonus', v)} placeholder="0" />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => saveOverrides()}
            className="mt-2 w-full rounded-sm border border-gold/30 px-2 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Guardar variante
          </button>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className={labelClass}>Rasgos añadidos</span>
              <button type="button" onClick={addTrait} className="text-xs text-gold/80 hover:text-gold">
                + Rasgo
              </button>
            </div>
            {(overrides.traits ?? []).map((t, i) => (
              <div key={i} className="mt-1.5 rounded-sm border border-bone/10 p-1.5">
                <div className="flex gap-1">
                  <input
                    value={t.name}
                    onChange={(e) => patchTrait(i, { name: e.target.value })}
                    onBlur={() => saveOverrides()}
                    placeholder="Nombre del rasgo"
                    className="flex-1 rounded-sm border border-bone/15 bg-night-950 px-2 py-1 text-xs text-bone"
                  />
                  <button
                    type="button"
                    onClick={() => removeTrait(i)}
                    aria-label="Quitar rasgo"
                    className="px-1 text-bone/40 hover:text-blood"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={t.desc}
                  onChange={(e) => patchTrait(i, { desc: e.target.value })}
                  onBlur={() => saveOverrides()}
                  rows={2}
                  placeholder="Qué hace (texto libre)"
                  className="mt-1 w-full resize-y rounded-sm border border-bone/15 bg-night-950 px-2 py-1 text-xs text-bone"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {(token.kind === 'enemigo' || token.kind === 'aliado') && (
        <div className="rounded-sm border border-sky-400/15 bg-night-950/40 p-2">
          <label className={labelClass} htmlFor="token-vision-radius">Alcance de visión / detección</label>
          <p className="mt-1 text-[0.65rem] text-bone/45">
            El DM puede mostrar este alcance sobre el tablero. Las paredes, puertas cerradas y obstáculos
            cortan la línea de visión.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="token-vision-radius"
              type="number"
              min={1}
              max={30}
              disabled={busy}
              value={token.visionRadius ?? 6}
              onChange={(e) =>
                onPatch(token.id, {
                  visionRadius: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)),
                })
              }
              className="w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-center font-mono text-xs text-bone"
            />
            <span className="text-xs text-bone/55">casillas</span>
          </div>
        </div>
      )}

      {token.kind === 'trampa' && (
        <div className="rounded-sm border border-violet-400/15 bg-night-950/40 p-2">
          <label className={labelClass} htmlFor="trap-perception-dc">CD para descubrirla</label>
          <p className="mt-1 text-[0.65rem] text-bone/45">
            Una búsqueda de Percepción solo la revela si está dentro de la visión del personaje y la
            tirada alcanza esta dificultad. La CD nunca se envía al jugador.
          </p>
          <input
            id="trap-perception-dc"
            type="number"
            min={1}
            max={30}
            disabled={busy}
            value={token.perceptionDc ?? 10}
            onChange={(e) =>
              onPatch(token.id, {
                perceptionDc: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)),
              })
            }
            className="mt-2 w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-center font-mono text-xs text-bone"
          />
        </div>
      )}

      {/* Botín (Fase 20): solo enemigos */}
      {isEnemy && (
        <div className="rounded-sm border border-gold/15 bg-night-950/40 p-2">
          <div className="flex items-center justify-between">
            <p className={labelClass}>Botín al derrotarlo</p>
            <button type="button" onClick={() => setLootPicker(true)} className="text-xs text-gold/80 hover:text-gold">
              + Del compendio
            </button>
          </div>
          <p className="mt-1 text-[0.65rem] text-bone/45">
            Al caer, se tira cada objeto por su probabilidad y queda un botín saqueable para los jugadores.
          </p>

          {loot.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {loot.map((l) => (
                <li key={l.id} className="rounded-sm border border-bone/10 p-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 truncate text-xs text-bone">{l.name}</span>
                    <button
                      type="button"
                      onClick={() => removeLoot(l.id)}
                      aria-label="Quitar del botín"
                      className="px-1 text-bone/40 hover:text-blood"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-bone/60">
                    <label className="flex items-center gap-1">
                      Cantidad
                      <input
                        type="number"
                        min={1}
                        value={l.qty}
                        onChange={(e) => patchLoot(l.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-12 rounded-sm border border-bone/15 bg-night-950 px-1 py-0.5 text-center font-mono text-bone"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      Prob. %
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={l.chance}
                        onChange={(e) =>
                          patchLoot(l.id, { chance: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })
                        }
                        className="w-14 rounded-sm border border-bone/15 bg-night-950 px-1 py-0.5 text-center font-mono text-bone"
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!lootText.trim()) return;
              addLootEntry({ id: genId(), name: lootText.trim(), source: 'text', index: null, qty: 1, chance: 100 });
              setLootText('');
            }}
          >
            <input
              value={lootText}
              onChange={(e) => setLootText(e.target.value)}
              placeholder="Añadir a mano (Oro, gema…)"
              className="flex-1 rounded-sm border border-bone/15 bg-night-950 px-2 py-1 text-xs text-bone"
            />
            <button type="submit" className="rounded-sm border border-gold/30 px-2 text-xs text-gold hover:bg-gold/10">
              +
            </button>
          </form>
        </div>
      )}

      {(token.kind === 'objeto' || token.kind === 'trampa') && (
        <div>
          <p className={labelClass}>Interacción (opcional)</p>
          <p className="mt-1 text-xs text-bone/50">
            Si pides una habilidad, interactuar cuesta la acción del turno y el jugador tiene que tirar
            contra la dificultad (oculta hasta que resuelve el intento).
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <select
              disabled={busy}
              value={token.skill ?? ''}
              onChange={(e) =>
                onPatch(token.id, { skill: e.target.value || null, dc: e.target.value ? token.dc ?? 10 : null })
              }
              className="flex-1 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-xs text-bone"
            >
              <option value="">Sin tirada</option>
              {SKILLS.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.name}
                </option>
              ))}
            </select>
            {token.skill && (
              <input
                type="number"
                min={1}
                max={30}
                disabled={busy}
                value={token.dc ?? 10}
                onChange={(e) =>
                  onPatch(token.id, { dc: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)) })
                }
                className="w-16 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-center font-mono text-xs text-bone"
                aria-label="Dificultad"
              />
            )}
          </div>
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className={labelClass}>Consecuencia si lo supera</span>
              <textarea
                rows={3}
                maxLength={2000}
                disabled={busy}
                value={successConsequence}
                onChange={(e) => setSuccessConsequence(e.target.value)}
                placeholder="Ej.: Esquiva el derrumbe y encuentra un paso seguro."
                className={`${inputClass} mt-1 resize-y text-xs`}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Consecuencia si falla</span>
              <textarea
                rows={3}
                maxLength={2000}
                disabled={busy || !token.skill}
                value={failureConsequence}
                onChange={(e) => setFailureConsequence(e.target.value)}
                placeholder={
                  token.skill
                    ? 'Ej.: El techo cae; recibe 2d6 de daño y queda atrapado.'
                    : 'Añade una tirada para poder definir una rama de fallo.'
                }
                className={`${inputClass} mt-1 resize-y text-xs disabled:opacity-50`}
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                (successConsequence === (token.successConsequence ?? '') &&
                  failureConsequence === (token.failureConsequence ?? ''))
              }
              onClick={() =>
                onPatch(token.id, {
                  successConsequence,
                  failureConsequence,
                })
              }
              className="w-full rounded-sm border border-gold/30 px-2 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
            >
              Guardar consecuencias
            </button>
            <p className="text-[0.65rem] text-bone/40">
              Solo es informativo: la app muestra el resultado, pero no aplica daño ni estados automáticamente.
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => onPatch(token.id, { hidden: !token.hidden })}
        className={`w-full rounded-sm border px-3 py-1.5 font-display text-sm disabled:opacity-40 ${
          token.hidden
            ? 'border-bone/30 text-bone/70 hover:bg-bone/5'
            : 'border-sage/60 text-sage hover:bg-sage/10'
        }`}
      >
        {token.hidden ? 'Oculto (solo DM) — hacer visible' : 'Visible ✓ — ocultar a los jugadores'}
      </button>

      <div className="space-y-2 border-t border-gold/15 pt-3">
        {onSaveTemplate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveTemplate(token.id)}
            className="w-full rounded-sm border border-gold/30 px-3 py-1.5 font-display text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
            title="Guarda este marcador configurado (variante y botín incluidos) en tu biblioteca"
          >
            Guardar en biblioteca
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`¿Quitar "${token.name}" del mapa?`)) onDelete(token.id);
          }}
          className="w-full rounded-sm border border-blood/40 px-3 py-1.5 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Quitar marcador
        </button>
      </div>

      {lootPicker && (
        <SrdPicker
          title="Añadir objeto al botín"
          category="equipment"
          onPick={(entry) => {
            addLootEntry({
              id: genId(),
              name: entry.name,
              source: entry.custom ? 'custom' : 'srd',
              index: entry.index,
              qty: 1,
              chance: 100,
            });
            setLootPicker(false);
          }}
          onClose={() => setLootPicker(false)}
        />
      )}
    </div>
  );
}
