import { useState } from 'react';
import SrdPicker from './SrdPicker.jsx';

// Secciones dinámicas de la ficha (Fase 21): el jugador crea y nombra sus
// propios bloques para organizar la ficha a su gusto (lore, monturas, equipo
// extra…). Tres tipos: 'texto' (texto libre), 'lista' (viñetas) y 'srd'
// (enlaces al compendio, apoyándose en los datos ya sincronizados). El array
// vive en characters.custom_sections y se guarda con el autoguardado normal.

const inputClass =
  'rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-bone focus:border-gold focus:outline-none disabled:opacity-60';

// Categorías del compendio que tiene sentido enlazar desde una sección
const SRD_CATEGORIES = [
  { value: 'equipment', label: 'Objetos' },
  { value: 'spells', label: 'Hechizos' },
  { value: 'monsters', label: 'Monstruos' },
  { value: 'conditions', label: 'Condiciones' },
  { value: 'races', label: 'Razas' },
  { value: 'classes', label: 'Clases' },
];
const srdLabel = (value) => SRD_CATEGORIES.find((c) => c.value === value)?.label ?? value;

const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sec-${Date.now()}-${Math.random()}`);

function SectionCard({ section, ro, onPatch, onRemove }) {
  const [picking, setPicking] = useState(false);
  const [newItem, setNewItem] = useState('');

  function setTitle(title) {
    onPatch({ ...section, title });
  }

  // --- Lista de viñetas ---
  function addListItem() {
    if (!newItem.trim()) return;
    onPatch({ ...section, content: [...(section.content ?? []), newItem.trim()] });
    setNewItem('');
  }
  function removeListItem(i) {
    onPatch({ ...section, content: section.content.filter((_, idx) => idx !== i) });
  }

  // --- Enlaces al compendio ---
  function addSrdEntry(entry) {
    const content = section.content ?? [];
    if (!content.some((e) => e.index === entry.index)) {
      onPatch({ ...section, content: [...content, { index: entry.index, name: entry.name }] });
    }
    setPicking(false);
  }
  function removeSrdEntry(index) {
    onPatch({ ...section, content: section.content.filter((e) => e.index !== index) });
  }

  return (
    <section className="rounded-md border border-gold/15 bg-night-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        {ro ? (
          <h3 className="font-display text-lg tracking-wide text-gold">{section.title || 'Sección'}</h3>
        ) : (
          <input
            value={section.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la sección"
            className={`${inputClass} flex-1 font-display text-lg text-gold`}
          />
        )}
        {!ro && (
          <button
            onClick={onRemove}
            aria-label="Borrar sección"
            title="Borrar sección"
            className="shrink-0 px-2 text-bone/40 hover:text-blood"
          >
            ✕
          </button>
        )}
      </div>

      {section.type === 'texto' && (
        <textarea
          value={section.content ?? ''}
          disabled={ro}
          onChange={(e) => onPatch({ ...section, content: e.target.value })}
          rows={5}
          placeholder="Escribe lo que quieras organizar aquí…"
          className={`${inputClass} w-full text-sm`}
        />
      )}

      {section.type === 'lista' && (
        <div>
          <ul className="space-y-1">
            {(section.content ?? []).map((item, i) => (
              <li key={i} className="flex items-center gap-2 rounded-sm border border-bone/10 px-2 py-1 text-sm">
                <span className="flex-1">{item}</span>
                {!ro && (
                  <button onClick={() => removeListItem(i)} aria-label="Quitar" className="px-1 text-bone/40 hover:text-blood">
                    ✕
                  </button>
                )}
              </li>
            ))}
            {(section.content ?? []).length === 0 && <li className="text-sm italic text-bone/40">Lista vacía.</li>}
          </ul>
          {!ro && (
            <div className="mt-2 flex gap-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addListItem())}
                placeholder="Nuevo elemento"
                className={`${inputClass} flex-1 text-sm`}
              />
              <button onClick={addListItem} className="rounded-sm border border-gold/40 px-3 text-sm text-gold hover:bg-gold/10">
                Añadir
              </button>
            </div>
          )}
        </div>
      )}

      {section.type === 'srd' && (
        <div>
          <ul className="space-y-1">
            {(section.content ?? []).map((entry) => (
              <li key={entry.index} className="flex items-center gap-2 rounded-sm border border-bone/10 px-2 py-1 text-sm">
                <span className="flex-1">{entry.name}</span>
                {!ro && (
                  <button onClick={() => removeSrdEntry(entry.index)} aria-label="Quitar" className="px-1 text-bone/40 hover:text-blood">
                    ✕
                  </button>
                )}
              </li>
            ))}
            {(section.content ?? []).length === 0 && (
              <li className="text-sm italic text-bone/40">Sin entradas enlazadas.</li>
            )}
          </ul>
          {!ro && (
            <div className="mt-2 flex items-center gap-2">
              <select
                value={section.category ?? 'equipment'}
                onChange={(e) => onPatch({ ...section, category: e.target.value })}
                className={`${inputClass} text-sm`}
              >
                {SRD_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <button
                onClick={() => setPicking(true)}
                className="rounded-sm border border-gold/40 px-3 py-1 text-sm text-gold hover:bg-gold/10"
              >
                + Enlazar del compendio
              </button>
            </div>
          )}
          {picking && (
            <SrdPicker
              title={`Enlazar ${srdLabel(section.category ?? 'equipment')}`}
              category={section.category ?? 'equipment'}
              onPick={addSrdEntry}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
    </section>
  );
}

export default function CustomSections({ sections, ro, onChange }) {
  const list = Array.isArray(sections) ? sections : [];

  function addSection(type) {
    const base = { id: genId(), title: '', type };
    const section =
      type === 'texto'
        ? { ...base, content: '' }
        : type === 'srd'
          ? { ...base, category: 'equipment', content: [] }
          : { ...base, content: [] };
    onChange([...list, section]);
  }

  function patchSection(id, next) {
    onChange(list.map((s) => (s.id === id ? next : s)));
  }
  function removeSection(id) {
    onChange(list.filter((s) => s.id !== id));
  }

  if (ro && list.length === 0) return null;

  return (
    <div className="space-y-4">
      {list.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          ro={ro}
          onPatch={(next) => patchSection(section.id, next)}
          onRemove={() => removeSection(section.id)}
        />
      ))}

      {!ro && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gold/20 p-3">
          <span className="text-sm text-bone/50">Añadir sección propia:</span>
          <button onClick={() => addSection('texto')} className="rounded-sm border border-bone/25 px-3 py-1 text-sm text-bone/80 hover:border-gold hover:text-gold">
            Texto
          </button>
          <button onClick={() => addSection('lista')} className="rounded-sm border border-bone/25 px-3 py-1 text-sm text-bone/80 hover:border-gold hover:text-gold">
            Lista
          </button>
          <button onClick={() => addSection('srd')} className="rounded-sm border border-bone/25 px-3 py-1 text-sm text-bone/80 hover:border-gold hover:text-gold">
            Enlaces al compendio
          </button>
        </div>
      )}
    </div>
  );
}
