import { useMemo } from 'react';
import ArchiveIcon from './ArchiveIcon.jsx';
import ArchiveIconPicker from './ArchiveIconPicker.jsx';
import { inferArchiveIcon } from '../lib/archiveIcons.js';

function UnfiledIcon({ selected }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-4 w-4 shrink-0 ${selected ? 'text-gold' : 'text-gold/55'}`}>
      <path d="M4 4h16v16H4z" /><path d="M4 9h16M9 4v5" />
    </svg>
  );
}

function descendantsOf(sectionId, sections) {
  const found = new Set();
  const visit = (parentId) => {
    for (const section of sections) {
      if (section.parentId !== parentId || found.has(section.id)) continue;
      found.add(section.id);
      visit(section.id);
    }
  };
  visit(sectionId);
  return found;
}

function TreeBranch({ parentId, depth, sections, selectedId, entryCounts, busy, onSelect, onMove, canEdit }) {
  const children = sections
    .filter((section) => section.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.id - b.id);

  return children.map((section, index) => (
    <div key={section.id}>
      <div className="group flex min-w-0 items-center gap-1" style={{ paddingLeft: `${depth * 12}px` }}>
        <button
          type="button"
          onClick={() => onSelect(section.id)}
          className={`flex min-w-0 flex-1 items-start gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
            selectedId === section.id
              ? 'bg-gold/15 font-medium text-gold'
              : 'text-bone/70 hover:bg-bone/5 hover:text-bone'
          }`}
        >
          <ArchiveIcon
            node={section}
            className={`mt-0.5 h-4 w-4 shrink-0 ${selectedId === section.id ? 'text-gold' : 'text-gold/55'}`}
          />
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{section.title}</span>
          <span className="ml-1 shrink-0 text-[0.65rem] text-bone/35">{entryCounts.get(section.id) ?? 0}</span>
        </button>
        {canEdit && <div className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onMove(section.id, 'up')}
            disabled={busy || index === 0}
            title="Subir sección"
            aria-label={`Subir ${section.title}`}
            className="px-1 text-xs text-bone/45 hover:text-gold disabled:opacity-20"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(section.id, 'down')}
            disabled={busy || index === children.length - 1}
            title="Bajar sección"
            aria-label={`Bajar ${section.title}`}
            className="px-1 text-xs text-bone/45 hover:text-gold disabled:opacity-20"
          >
            ↓
          </button>
        </div>}
      </div>
      <TreeBranch
        parentId={section.id}
        depth={depth + 1}
        sections={sections}
        selectedId={selectedId}
        entryCounts={entryCounts}
        busy={busy}
        onSelect={onSelect}
        onMove={onMove}
        canEdit={canEdit}
      />
    </div>
  ));
}

export default function ArchiveTree({
  sections,
  entries,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onChangeParent,
  onChangeIcon,
  canEdit = true,
}) {
  const selected = sections.find((section) => section.id === selectedId) ?? null;
  const entryCounts = useMemo(() => {
    const counts = new Map();
    for (const entry of entries) counts.set(entry.parentId, (counts.get(entry.parentId) ?? 0) + 1);
    return counts;
  }, [entries]);
  const forbiddenParents = useMemo(
    () => (selected ? new Set([selected.id, ...descendantsOf(selected.id, sections)]) : new Set()),
    [selected, sections]
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-b border-gold/15 bg-night-900/70 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between border-b border-gold/15 px-3 py-3">
        <div>
          <p className="font-display text-sm uppercase tracking-[0.16em] text-gold">Secciones</p>
          <p className="text-[0.65rem] text-bone/40">{canEdit ? 'Organiza el lore por temas' : 'Explora el lore compartido'}</p>
        </div>
        {canEdit && <button
          type="button"
          onClick={() => onCreate(null)}
          disabled={busy}
          className="rounded-sm border border-gold/35 px-2 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
        >
          + Raíz
        </button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`mb-1 flex w-full min-w-0 items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm ${
            selectedId == null ? 'bg-gold/15 text-gold' : 'text-bone/70 hover:bg-bone/5 hover:text-bone'
          }`}
        >
          <UnfiledIcon selected={selectedId == null} />
          <span className="min-w-0 flex-1">Entradas sin sección</span>
          <span className="ml-1 shrink-0 text-[0.65rem] text-bone/35">{entryCounts.get(null) ?? 0}</span>
        </button>

        {sections.length === 0 ? (
          <div className="m-2 rounded-sm border border-dashed border-bone/15 p-3 text-center text-xs text-bone/40">
            {canEdit ? 'Crea una sección para comenzar a estructurar la campaña.' : 'Todavía no hay secciones publicadas.'}
          </div>
        ) : (
          <TreeBranch
            parentId={null}
            depth={0}
            sections={sections}
            selectedId={selectedId}
            entryCounts={entryCounts}
            busy={busy}
            onSelect={onSelect}
            onMove={onMove}
            canEdit={canEdit}
          />
        )}
      </div>

      {selected && canEdit && (
        <div className="space-y-2 border-t border-gold/15 p-3">
          <p className="truncate text-xs text-bone/50" title={selected.title}>
            Editar «{selected.title}»
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onCreate(selected.id)}
              disabled={busy}
              className="rounded-sm border border-bone/20 px-2 py-1.5 text-xs text-bone/70 hover:border-gold hover:text-gold disabled:opacity-40"
            >
              + Subsección
            </button>
            <button
              type="button"
              onClick={() => onRename(selected)}
              disabled={busy}
              className="rounded-sm border border-bone/20 px-2 py-1.5 text-xs text-bone/70 hover:border-gold hover:text-gold disabled:opacity-40"
            >
              Renombrar
            </button>
          </div>
          <div>
            <span className="mb-1 block text-[0.6rem] uppercase tracking-widest text-bone/40">Icono de la sección</span>
            <ArchiveIconPicker
              value={selected.iconAutomatic ? '' : selected.icon}
              automaticIcon={inferArchiveIcon('seccion', selected.title)}
              disabled={busy}
              label={`Icono de ${selected.title}`}
              onChange={(icon) => onChangeIcon(selected, icon)}
            />
          </div>
          <label className="block">
            <span className="mb-1 block text-[0.6rem] uppercase tracking-widest text-bone/40">Mover dentro de</span>
            <select
              value={selected.parentId ?? ''}
              disabled={busy}
              onChange={(event) => onChangeParent(selected.id, event.target.value ? Number(event.target.value) : null)}
              className="w-full rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-xs text-bone focus:border-gold focus:outline-none"
            >
              <option value="">Raíz del archivo</option>
              {sections
                .filter((section) => !forbiddenParents.has(section.id))
                .map((section) => (
                  <option key={section.id} value={section.id}>{section.optionLabel ?? section.title}</option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onDelete(selected)}
            disabled={busy}
            className="w-full rounded-sm border border-blood/35 px-2 py-1.5 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
          >
            Borrar sección
          </button>
        </div>
      )}
    </section>
  );
}
