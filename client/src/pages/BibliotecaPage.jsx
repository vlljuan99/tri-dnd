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
import { ABILITIES, SKILLS } from '../lib/dnd.js';
import {
  HIT_DICE,
  SIZES,
  DAMAGE_TYPES,
  damageTypeLabel,
  emptyClassForm,
  classDataToForm,
  buildClassData,
  emptyRaceForm,
  raceDataToForm,
  buildRaceData,
  classSummary,
  raceSummary,
} from '../lib/classRaceForm.js';

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
// Editor de rasgos narrativos (compartido por clase y raza). Los rasgos NO son
// efectos: son texto libre que la mesa narra, igual que el campo `features` de
// la ficha. Los efectos estructurados (bonos, destrezas, resistencias) van en
// sus propios campos del formulario.
// ---------------------------------------------------------------------------
function FeaturesEditor({ features, onChange }) {
  const update = (i, key, value) => onChange(features.map((f, j) => (j === i ? { ...f, [key]: value } : f)));
  const add = () => onChange([...features, { name: '', text: '' }]);
  const remove = (i) => onChange(features.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {features.map((f, i) => (
        <div key={i} className="rounded-sm border border-ink/15 bg-parchment-100/60 p-2">
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={f.name}
              onChange={(e) => update(i, 'name', e.target.value)}
              placeholder="Nombre del rasgo"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 rounded-sm border border-ember/40 px-2 text-sm text-ember hover:bg-ember/10"
            >
              ✕
            </button>
          </div>
          <textarea
            className={`${inputClass} mt-2 resize-y`}
            rows={2}
            value={f.text}
            onChange={(e) => update(i, 'text', e.target.value)}
            placeholder="Qué hace (lo narra la mesa; no se aplica solo)"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded-sm border border-ink/25 px-3 py-1 text-sm text-ink/70 hover:bg-ink/5"
      >
        + Añadir rasgo
      </button>
    </div>
  );
}

// Casillas de un conjunto de opciones (característica, habilidad, daño): un
// toggle multiselección compacto reutilizado por varias secciones.
function ChipToggle({ options, selected, onToggle, disabled }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled?.(o.value, on)}
            onClick={() => onToggle(o.value)}
            className={`rounded-sm border px-2 py-1 text-xs disabled:opacity-30 ${
              on ? 'border-ember bg-ember/15 text-ember' : 'border-ink/25 text-ink/60 hover:border-ink/40'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const ABILITY_OPTIONS = ABILITIES.map((a) => ({ value: a.key, label: a.short }));
const SKILL_OPTIONS = SKILLS.map((s) => ({ value: s.index, label: s.name }));
const DAMAGE_OPTIONS = DAMAGE_TYPES.map((d) => ({ value: d.index, label: d.label }));

// ---------------------------------------------------------------------------
// Formulario de CLASE personalizada
// ---------------------------------------------------------------------------
function ClassForm({ initial, onSave, onCancel, busy }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [form, setForm] = useState(() => (initial ? classDataToForm(initial.data) : emptyClassForm()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleSave = (key) =>
    set('savingThrows', form.savingThrows.includes(key)
      ? form.savingThrows.filter((s) => s !== key)
      : [...form.savingThrows, key]);
  const toggleSkill = (idx) =>
    set('skillFrom', form.skillFrom.includes(idx)
      ? form.skillFrom.filter((s) => s !== idx)
      : [...form.skillFrom, idx]);

  return (
    <div className="space-y-3">
      <Field label="Nombre">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Guardián de sangre" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dado de golpe">
          <select className={inputClass} value={form.hitDie} onChange={(e) => set('hitDie', Number(e.target.value))}>
            {HIT_DICE.map((d) => (
              <option key={d} value={d}>d{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Conjuros por">
          <select
            className={inputClass}
            value={form.spellcastingAbility}
            onChange={(e) => set('spellcastingAbility', e.target.value)}
          >
            <option value="">— sin conjuros —</option>
            {ABILITIES.map((a) => (
              <option key={a.key} value={a.key}>{a.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Salvaciones competentes (elige hasta 2)">
        <ChipToggle
          options={ABILITY_OPTIONS}
          selected={form.savingThrows}
          onToggle={toggleSave}
          disabled={(value, on) => !on && form.savingThrows.length >= 2}
        />
      </Field>

      <div className="rounded-sm border border-ink/15 p-2">
        <div className="flex items-center gap-2">
          <span className={labelClass + ' mb-0'}>Habilidades: elige</span>
          <input
            type="number"
            min={0}
            max={form.skillFrom.length || SKILLS.length}
            value={form.skillChoose}
            onChange={(e) => set('skillChoose', e.target.value)}
            className="w-16 rounded-sm border border-ink/25 bg-parchment-100 px-2 py-1 text-sm text-ink focus:border-ember focus:outline-none"
          />
          <span className="text-xs text-ink/50">
            {form.skillFrom.length ? `de estas ${form.skillFrom.length}` : 'de cualquiera'}
          </span>
        </div>
        <p className="mt-1 mb-2 text-xs text-ink/50">
          Marca de qué habilidades puede elegir el jugador. Sin marcar ninguna, elige de todas.
        </p>
        <ChipToggle options={SKILL_OPTIONS} selected={form.skillFrom} onToggle={toggleSkill} />
      </div>

      <Field label="Rasgos (texto libre, los narra la mesa)">
        <FeaturesEditor features={form.features} onChange={(v) => set('features', v)} />
      </Field>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(name.trim(), buildClassData(form))}
          disabled={busy || !name.trim()}
          className="rounded-sm bg-ember px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancel} className="rounded-sm border border-ink/25 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario de RAZA personalizada
// ---------------------------------------------------------------------------
function RaceForm({ initial, onSave, onCancel, busy }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [form, setForm] = useState(() => (initial ? raceDataToForm(initial.data) : emptyRaceForm()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setBonus = (key, value) =>
    set('abilityBonuses', { ...form.abilityBonuses, [key]: value === '' ? '' : Number(value) });
  const toggleIn = (field, value) =>
    set(field, form[field].includes(value) ? form[field].filter((v) => v !== value) : [...form[field], value]);

  return (
    <div className="space-y-3">
      <Field label="Nombre">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nacido de la tormenta" />
      </Field>

      <Field label="Bonos de característica (se suman solos a la ficha)">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => (
            <label key={a.key} className="flex flex-col items-center gap-1">
              <span className="text-xs text-ink/50">{a.short}</span>
              <input
                type="number"
                min={-5}
                max={5}
                value={form.abilityBonuses[a.key] ?? ''}
                onChange={(e) => setBonus(a.key, e.target.value)}
                placeholder="0"
                className="w-full rounded-sm border border-ink/25 bg-parchment-100 px-1 py-1 text-center text-sm text-ink focus:border-ember focus:outline-none"
              />
            </label>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Velocidad (pies)">
          <input
            type="number"
            min={0}
            max={120}
            className={inputClass}
            value={form.speed}
            onChange={(e) => set('speed', e.target.value)}
            placeholder="Base (30)"
          />
        </Field>
        <Field label="Tamaño">
          <select className={inputClass} value={form.size} onChange={(e) => set('size', e.target.value)}>
            {SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Destrezas concedidas (se marcan solas)">
        <ChipToggle options={SKILL_OPTIONS} selected={form.skillProficiencies} onToggle={(v) => toggleIn('skillProficiencies', v)} />
      </Field>

      <Field label="Resistencias a daño (etiqueta en la ficha)">
        <ChipToggle options={DAMAGE_OPTIONS} selected={form.resistances} onToggle={(v) => toggleIn('resistances', v)} />
      </Field>

      <Field label="Sentidos (uno por línea, p. ej. «Visión en la oscuridad 18 m»)">
        <textarea
          className={`${inputClass} resize-y`}
          rows={2}
          value={form.senses.join('\n')}
          onChange={(e) => set('senses', e.target.value.split('\n'))}
          placeholder="Visión en la oscuridad 18 m"
        />
      </Field>

      <Field label="Rasgos (texto libre, los narra la mesa)">
        <FeaturesEditor features={form.features} onChange={(v) => set('features', v)} />
      </Field>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(name.trim(), buildRaceData(form))}
          disabled={busy || !name.trim()}
          className="rounded-sm bg-ember px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancel} className="rounded-sm border border-ink/25 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5">
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
  if (tipo === 'clases') return classSummary(entry);
  if (tipo === 'razas') return raceSummary(entry);
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
// ---------------------------------------------------------------------------
// Pestaña de PLANTILLAS (salas, dungeons, ciudades y enemigos configurados)
// ---------------------------------------------------------------------------

const TEMPLATE_KIND_LABELS = {
  sala: 'Sala',
  mapa: 'Dungeon / mapa',
  ciudad: 'Ciudad',
  enemigo: 'Enemigo',
};

function templateSummary(t) {
  const m = t.meta ?? {};
  if (t.kind === 'sala') {
    return `${m.width}×${m.height}${m.tokens ? ` · ${m.tokens} marcador${m.tokens === 1 ? '' : 'es'}` : ''}`;
  }
  if (t.kind === 'mapa') {
    return `${m.floors} planta${m.floors === 1 ? '' : 's'} · ${m.rooms} sala${m.rooms === 1 ? '' : 's'}${
      m.tokens ? ` · ${m.tokens} marcadores` : ''
    }`;
  }
  if (t.kind === 'ciudad') {
    const parts = [`${m.pins} pin${m.pins === 1 ? '' : 's'}`];
    if (m.boards) parts.push(`${m.boards} tablero${m.boards === 1 ? '' : 's'}`);
    if (m.submaps) parts.push(`${m.submaps} submapa${m.submaps === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }
  const parts = [m.monsterIndex ? `base: ${m.monsterIndex}` : 'sin monstruo base'];
  if (m.hasOverrides) parts.push('variante');
  if (m.lootEntries) parts.push(`botín (${m.lootEntries})`);
  return parts.join(' · ');
}

// Las plantillas se guardan desde los editores (mapas y mundo); aquí solo se
// consultan, renombran y borran.
function TemplatesSection({ q }) {
  const [templates, setTemplates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => {
    api('/plantillas').then(({ templates: rows }) => setTemplates(rows)).catch((e) => setError(e.message));
  };
  useEffect(reload, []);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rename = (t) => {
    const name = window.prompt('Nuevo nombre de la plantilla', t.name);
    if (!name?.trim() || name.trim() === t.name) return;
    run(() => api(`/plantillas/${t.id}`, { method: 'PATCH', body: { name: name.trim() } }));
  };
  const remove = (t) => {
    if (!window.confirm(`¿Borrar la plantilla "${t.name}"?`)) return;
    run(() => api(`/plantillas/${t.id}`, { method: 'DELETE' }));
  };

  const visible = (templates ?? []).filter(
    (t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <>
      {error && <p className="mb-3 text-sm text-ember">{error}</p>}
      <p className="mb-4 text-sm text-ink/60">
        Salas, dungeons, ciudades y enemigos guardados desde los editores de mapas y de mundo. Se instancian
        desde allí en cualquier campaña; aquí puedes renombrarlas o borrarlas.
      </p>
      {templates === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : visible.length === 0 ? (
        <p className="italic text-ink/60">
          {templates.length === 0
            ? 'Nada todavía. Guarda una sala, un mapa, una ciudad o un enemigo desde los editores («Guardar en biblioteca»).'
            : 'Ninguna plantilla coincide con la búsqueda.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-md border border-ink/15 bg-parchment-100/70 p-3 shadow-sm">
              {t.previewUrl && (
                <img src={t.previewUrl} alt="" className="h-12 w-16 shrink-0 rounded-sm border border-ink/15 object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg text-ink">{t.name}</p>
                <p className="text-xs text-ink/60">
                  <span className="mr-1 rounded-sm border border-ink/20 px-1 py-px text-[0.65rem] uppercase tracking-wider">
                    {TEMPLATE_KIND_LABELS[t.kind] ?? t.kind}
                  </span>
                  {templateSummary(t)}
                </p>
              </div>
              <button
                onClick={() => rename(t)}
                disabled={busy}
                className="rounded-sm border border-ink/25 px-3 py-1 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-40"
              >
                Renombrar
              </button>
              <button
                onClick={() => remove(t)}
                disabled={busy}
                className="rounded-sm border border-ember/40 px-3 py-1 text-sm text-ember hover:bg-ember/10 disabled:opacity-40"
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Nombre en singular de cada categoría (con artículo por género), para los
// títulos del editor y los estados vacíos.
const SINGULAR = { objetos: 'objeto', hechizos: 'hechizo', clases: 'clase', razas: 'raza' };
const NEW_LABEL = { objetos: 'Nuevo objeto', hechizos: 'Nuevo hechizo', clases: 'Nueva clase', razas: 'Nueva raza' };

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
    if (tipo === 'plantillas') return undefined; // su pestaña carga lo suyo
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
      { key: 'clases', label: 'Clases' },
      { key: 'razas', label: 'Razas' },
      { key: 'plantillas', label: 'Plantillas' },
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
        Tu contenido propio, reutilizable en cualquier campaña: objetos, hechizos, y clases y razas con
        efectos que se aplican solos a la ficha. Aparece junto al compendio SRD al construir un personaje.
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
        {tipo !== 'plantillas' && (
          <button
            onClick={() => setEditing('new')}
            className="rounded-sm bg-ember px-3 py-1.5 font-display text-sm tracking-wide text-parchment-100 hover:bg-ember/90"
          >
            + Crear
          </button>
        )}
      </div>

      {tipo === 'plantillas' && <TemplatesSection q={q} />}

      {tipo !== 'plantillas' && error && <p className="mb-3 text-sm text-ember">{error}</p>}

      {editing && (
        <div className="mb-5 rounded-md border border-ember/40 bg-parchment-100/70 p-4 shadow-sm">
          <h3 className="mb-3 font-display text-lg text-ink">
            {editing === 'new' ? NEW_LABEL[tipo] : `Editar ${editing.name}`}
          </h3>
          {tipo === 'objetos' && (
            <ItemForm
              initial={editing === 'new' ? null : editing}
              damageTypes={damageTypes}
              properties={properties}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          )}
          {tipo === 'hechizos' && (
            <SpellForm
              initial={editing === 'new' ? null : editing}
              damageTypes={damageTypes}
              schools={schools}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          )}
          {tipo === 'clases' && (
            <ClassForm
              initial={editing === 'new' ? null : editing}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          )}
          {tipo === 'razas' && (
            <RaceForm
              initial={editing === 'new' ? null : editing}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
      )}

      {tipo === 'plantillas' ? null : entries === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : entries.length === 0 ? (
        <p className="italic text-ink/60">
          Nada todavía. Crea tu primer{tipo === 'clases' || tipo === 'razas' ? 'a' : ''} {SINGULAR[tipo]} con el botón «+ Crear».
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
