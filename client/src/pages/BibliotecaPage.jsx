import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import {
  listLibrary,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  EQUIPMENT_CATEGORIES,
  RARITIES,
  WEAPON_RANGES,
  DC_TYPES,
  ATTACK_TYPES,
  buildItemData,
  itemDataToForm,
  emptyItemForm,
  buildSpellData,
  spellDataToForm,
  emptySpellForm,
} from '../lib/customLibrary.js';

const inputClass =
  'w-full rounded-sm border border-ink/25 bg-parchment-100 px-2 py-1.5 text-sm text-ink focus:border-ember focus:outline-none';
const labelClass = 'block text-xs uppercase tracking-wider text-ink/50 mb-1';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Formulario de OBJETO
// ---------------------------------------------------------------------------
function ItemForm({ initial, damageTypes, properties, onSave, onCancel, busy }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [form, setForm] = useState(() => (initial ? itemDataToForm(initial.data) : emptyItemForm()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const isWeapon = form.category === 'weapon';
  const isArmor = form.category === 'armor';

  function toggleProperty(idx) {
    set('properties', form.properties.includes(idx) ? form.properties.filter((p) => p !== idx) : [...form.properties, idx]);
  }

  return (
    <div className="space-y-3">
      <Field label="Nombre">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Espada flamígera" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoría">
          <select className={inputClass} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {EQUIPMENT_CATEGORIES.map((c) => (
              <option key={c.index} value={c.index}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Rareza">
          <select className={inputClass} value={form.rarity} onChange={(e) => set('rarity', e.target.value)}>
            <option value="">— sin rareza —</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
      </div>

      {isWeapon && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Dados de daño">
              <input className={inputClass} value={form.damageDice} onChange={(e) => set('damageDice', e.target.value)} placeholder="1d8" />
            </Field>
            <Field label="Tipo de daño">
              <select className={inputClass} value={form.damageType} onChange={(e) => set('damageType', e.target.value)}>
                <option value="">—</option>
                {damageTypes.map((d) => (
                  <option key={d.index} value={d.index}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Versátil (a 2 manos)">
              <input className={inputClass} value={form.versatileDice} onChange={(e) => set('versatileDice', e.target.value)} placeholder="1d10" />
            </Field>
          </div>
          <Field label="Alcance">
            <select className={inputClass} value={form.weaponRange} onChange={(e) => set('weaponRange', e.target.value)}>
              {WEAPON_RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <div>
            <span className={labelClass}>Propiedades</span>
            <div className="flex flex-wrap gap-1.5">
              {properties.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  onClick={() => toggleProperty(p.index)}
                  className={`rounded-sm border px-2 py-1 text-xs ${
                    form.properties.includes(p.index)
                      ? 'border-ember bg-ember/15 text-ember'
                      : 'border-ink/20 text-ink/60 hover:border-ink/40'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {isArmor && (
        <Field label="Clase de armadura (base)">
          <input
            type="number"
            className={inputClass}
            value={form.armorClass}
            onChange={(e) => set('armorClass', e.target.value)}
            placeholder="14"
          />
        </Field>
      )}

      <Field label="Descripción / efectos">
        <textarea
          className={`${inputClass} resize-y`}
          rows={3}
          value={form.desc}
          onChange={(e) => set('desc', e.target.value)}
          placeholder="Efectos, consecuencias, notas de uso…"
        />
      </Field>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => onSave(name.trim(), buildItemData(form, damageTypes, properties))}
          className="rounded-sm bg-ember px-4 py-1.5 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
        >
          Guardar
        </button>
        <button type="button" onClick={onCancel} className="rounded-sm border border-ink/25 px-4 py-1.5 text-ink/70 hover:bg-ink/5">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario de HECHIZO
// ---------------------------------------------------------------------------
function SpellForm({ initial, damageTypes, schools, onSave, onCancel, busy }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [form, setForm] = useState(() => (initial ? spellDataToForm(initial.data) : emptySpellForm()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <Field label="Nombre">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Fuego arcano" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Nivel">
          <select className={inputClass} value={form.level} onChange={(e) => set('level', Number(e.target.value))}>
            <option value={0}>Truco</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>Nivel {n}</option>
            ))}
          </select>
        </Field>
        <Field label="Escuela">
          <select className={inputClass} value={form.school} onChange={(e) => set('school', e.target.value)}>
            <option value="">—</option>
            {schools.map((s) => (
              <option key={s.index} value={s.index}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Tipo de ataque">
          <select className={inputClass} value={form.attackType} onChange={(e) => set('attackType', e.target.value)}>
            {ATTACK_TYPES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Dados de daño">
          <input className={inputClass} value={form.damageDice} onChange={(e) => set('damageDice', e.target.value)} placeholder="8d6" />
        </Field>
        <Field label="Tipo de daño">
          <select className={inputClass} value={form.damageType} onChange={(e) => set('damageType', e.target.value)}>
            <option value="">—</option>
            {damageTypes.map((d) => (
              <option key={d.index} value={d.index}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Salvación (CD)">
          <select className={inputClass} value={form.dcType} onChange={(e) => set('dcType', e.target.value)}>
            <option value="">— sin salvación —</option>
            {DC_TYPES.map((d) => (
              <option key={d.index} value={d.index}>{d.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Alcance">
          <input className={inputClass} value={form.range} onChange={(e) => set('range', e.target.value)} placeholder="45 metros" />
        </Field>
        <Field label="Duración">
          <input className={inputClass} value={form.duration} onChange={(e) => set('duration', e.target.value)} placeholder="Instantáneo" />
        </Field>
      </div>
      <div className="flex gap-4 text-sm text-ink/70">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.concentration} onChange={(e) => set('concentration', e.target.checked)} />
          Concentración
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.ritual} onChange={(e) => set('ritual', e.target.checked)} />
          Ritual
        </label>
      </div>
      <Field label="Descripción / efectos">
        <textarea
          className={`${inputClass} resize-y`}
          rows={3}
          value={form.desc}
          onChange={(e) => set('desc', e.target.value)}
          placeholder="Qué hace el hechizo…"
        />
      </Field>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => onSave(name.trim(), buildSpellData(form, damageTypes, schools))}
          className="rounded-sm bg-ember px-4 py-1.5 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
        >
          Guardar
        </button>
        <button type="button" onClick={onCancel} className="rounded-sm border border-ink/25 px-4 py-1.5 text-ink/70 hover:bg-ink/5">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumen corto de una entrada para la lista
// ---------------------------------------------------------------------------
function entrySummary(tipo, entry) {
  const m = entry.meta ?? {};
  if (tipo === 'objetos') {
    const parts = [];
    if (m.equipmentCategory) parts.push(EQUIPMENT_CATEGORIES.find((c) => c.index === m.equipmentCategory)?.label ?? m.equipmentCategory);
    if (m.damage?.dice) parts.push(`${m.damage.dice}${m.damage.type ? ` ${m.damage.type}` : ''}`);
    return parts.join(' · ') || 'Objeto';
  }
  const parts = [m.level === 0 ? 'Truco' : `Nivel ${m.level}`];
  if (m.hasDamage) parts.push('daño');
  if (m.concentration) parts.push('conc.');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
export default function BibliotecaPage() {
  const [tipo, setTipo] = useState('objetos');
  const [entries, setEntries] = useState(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | entry
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [damageTypes, setDamageTypes] = useState([]);
  const [properties, setProperties] = useState([]);
  const [schools, setSchools] = useState([]);

  useEffect(() => {
    api('/srd/damage-types').then(({ results }) => setDamageTypes(results)).catch(() => {});
    api('/srd/weapon-properties').then(({ results }) => setProperties(results)).catch(() => {});
    api('/srd/magic-schools').then(({ results }) => setSchools(results)).catch(() => {});
  }, []);

  function reload() {
    setEntries(null);
    listLibrary(tipo, q).then(setEntries).catch((e) => setError(e.message));
  }

  useEffect(() => {
    setEditing(null);
    const timer = setTimeout(() => {
      listLibrary(tipo, q).then(setEntries).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, q]);

  async function save(name, data) {
    setBusy(true);
    setError('');
    try {
      if (editing === 'new') await createLibrary(tipo, { name, data });
      else await updateLibrary(tipo, editing.index.replace('custom:', ''), { name, data });
      setEditing(null);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry) {
    if (!window.confirm(`¿Borrar "${entry.name}" de la biblioteca?`)) return;
    setBusy(true);
    try {
      await deleteLibrary(tipo, entry.index.replace('custom:', ''));
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const tabs = useMemo(
    () => [
      { key: 'objetos', label: 'Objetos' },
      { key: 'hechizos', label: 'Hechizos' },
    ],
    []
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <Link to="/" className="font-display text-sm text-ember/80 hover:text-ember">← Campamento</Link>
        <Link to="/personajes" className="font-display text-sm text-ember/80 hover:text-ember">Personajes →</Link>
      </div>
      <h2 className="mb-1 font-display text-3xl font-semibold text-ink">Biblioteca del DM</h2>
      <p className="mb-6 text-sm text-ink/60">
        Tus objetos y hechizos propios, reutilizables en cualquier campaña. Aparecen junto al compendio SRD
        cuando añades equipo o hechizos a una ficha.
      </p>

      <div className="mb-4 flex items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTipo(t.key)}
            className={`rounded-sm border px-3 py-1.5 font-display text-sm ${
              tipo === t.key ? 'border-ember bg-ember/10 text-ember' : 'border-ink/20 text-ink/60 hover:border-ink/40'
            }`}
          >
            {t.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          className="ml-auto w-40 rounded-sm border border-ink/25 bg-parchment-100 px-3 py-1.5 text-sm text-ink focus:border-ember focus:outline-none"
        />
        <button
          onClick={() => setEditing('new')}
          className="rounded-sm bg-ember px-3 py-1.5 font-display text-sm tracking-wide text-parchment-100 hover:bg-ember/90"
        >
          + Crear
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-ember">{error}</p>}

      {editing && (
        <div className="mb-5 rounded-md border border-ember/40 bg-parchment-100/70 p-4 shadow-sm">
          <h3 className="mb-3 font-display text-lg text-ink">
            {editing === 'new' ? `Nuevo ${tipo === 'objetos' ? 'objeto' : 'hechizo'}` : `Editar ${editing.name}`}
          </h3>
          {tipo === 'objetos' ? (
            <ItemForm
              initial={editing === 'new' ? null : editing}
              damageTypes={damageTypes}
              properties={properties}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <SpellForm
              initial={editing === 'new' ? null : editing}
              damageTypes={damageTypes}
              schools={schools}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
      )}

      {entries === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : entries.length === 0 ? (
        <p className="italic text-ink/60">
          Nada todavía. Crea tu primer {tipo === 'objetos' ? 'objeto' : 'hechizo'} con el botón «+ Crear».
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.index}
              className="flex items-center gap-3 rounded-md border border-ink/15 bg-parchment-100/70 p-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg text-ink">{entry.name}</p>
                <p className="text-xs text-ink/60">{entrySummary(tipo, entry)}</p>
              </div>
              <button
                onClick={() => setEditing(entry)}
                className="rounded-sm border border-ink/25 px-3 py-1 text-sm text-ink/70 hover:bg-ink/5"
              >
                Editar
              </button>
              <button
                onClick={() => remove(entry)}
                disabled={busy}
                className="rounded-sm border border-ember/40 px-3 py-1 text-sm text-ember hover:bg-ember/10 disabled:opacity-40"
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
