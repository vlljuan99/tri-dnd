import { useEffect, useRef, useState } from 'react';
import ArchiveBlockCard from './ArchiveBlockCard.jsx';
import { entryDraftFrom, keepDraftOnRefresh } from '../lib/drafts.js';

const inputClass =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none disabled:opacity-50';

const BLOCK_TYPES = [
  { type: 'texto', label: 'Texto', glyph: '¶' },
  { type: 'imagen', label: 'Imagen', glyph: '▧' },
  { type: 'video', label: 'Vídeo', glyph: '▶' },
  { type: 'enlace', label: 'Enlace', glyph: '↗' },
  { type: 'musica', label: 'Música', glyph: '♫' },
];

export default function ArchiveEntryEditor({
  entry,
  sections,
  busy,
  privateImageUrl,
  onPatchEntry,
  onDeleteEntry,
  onCreateBlock,
  onPatchBlock,
  onDeleteBlock,
  onMoveBlock,
  onUploadImage,
}) {
  const [draft, setDraft] = useState(() => entryDraftFrom(entry));
  const [saving, setSaving] = useState(false);
  const activeEntryIdRef = useRef(entry?.id ?? null);

  useEffect(() => {
    setDraft((current) => keepDraftOnRefresh(current, activeEntryIdRef.current, entry, entryDraftFrom));
    activeEntryIdRef.current = entry?.id ?? null;
  }, [entry]);

  if (!entry) {
    return (
      <section className="flex min-h-[18rem] items-center justify-center bg-night-950/20 p-6 text-center lg:min-h-0">
        <div className="max-w-sm">
          <p className="font-display text-xl text-gold/70">Elige una entrada</p>
          <p className="mt-2 text-sm text-bone/45">
            Selecciona una entrada de la lista o crea una nueva para empezar a construir la narrativa.
          </p>
        </div>
      </section>
    );
  }

  const { title, summary, parentId } = draft;
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const blocks = [...(entry.blocks ?? [])].sort((a, b) => a.position - b.position || a.id - b.id);
  const detailsChanged =
    title !== entry.title || summary !== entry.summary || (parentId === '' ? null : Number(parentId)) !== entry.parentId;

  async function saveDetails() {
    if (!title.trim()) return;
    const body = {
      title: title.trim(),
      summary: summary.trim(),
      parentId: parentId === '' ? null : Number(parentId),
    };
    setSaving(true);
    try {
      const result = await onPatchEntry(body);
      if (result?.node) setDraft(entryDraftFrom(result.node));
    } finally {
      setSaving(false);
    }
  }

  function discardDetails() {
    setDraft(entryDraftFrom(entry));
  }

  function removeEntry() {
    if (!window.confirm(`¿Borrar la entrada «${entry.title}» y todos sus bloques?`)) return;
    onDeleteEntry();
  }

  function removeBlock(block) {
    if (!window.confirm(`¿Borrar este bloque de ${block.type}?`)) return;
    onDeleteBlock(block.id);
  }

  return (
    <section className="min-h-0 overflow-y-auto bg-night-950/20">
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-5">
        <div className="rounded-md border border-gold/15 bg-night-900/70 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="block">
              <span className="mb-1 block text-[0.65rem] uppercase tracking-widest text-bone/45">Título</span>
              <input
                value={title}
                maxLength={120}
                onChange={(event) => set('title', event.target.value)}
                placeholder="Título de la entrada"
                className={`${inputClass} font-display text-xl text-gold`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.65rem] uppercase tracking-widest text-bone/45">Sección</span>
              <select value={parentId} onChange={(event) => set('parentId', event.target.value)} className={`${inputClass} text-sm`}>
                <option value="">Sin sección</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>{section.optionLabel ?? section.title}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[0.65rem] uppercase tracking-widest text-bone/45">Resumen</span>
            <textarea
              rows={3}
              value={summary}
              maxLength={2000}
              onChange={(event) => set('summary', event.target.value)}
              placeholder="Una frase para reconocer rápidamente esta pieza de lore…"
              className={`${inputClass} resize-y text-sm`}
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-bone/10 pt-3">
            {detailsChanged && <span className="mr-auto text-xs text-ochre">Cabecera sin guardar</span>}
            {!detailsChanged && <span className="mr-auto text-xs text-sage/70">Cabecera guardada</span>}
            <button
              type="button"
              onClick={discardDetails}
              disabled={!detailsChanged || saving}
              className="rounded-sm border border-bone/20 px-3 py-1.5 text-xs text-bone/60 hover:text-bone disabled:opacity-30"
            >
              Descartar cambios
            </button>
            <button
              type="button"
              onClick={removeEntry}
              disabled={busy}
              className="rounded-sm border border-blood/35 px-3 py-1.5 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
            >
              Borrar entrada
            </button>
            <button
              type="button"
              onClick={saveDetails}
              disabled={busy || saving || !detailsChanged || !title.trim()}
              className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-35"
            >
              {saving ? 'Guardando…' : 'Guardar cabecera'}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <h2 className="font-display text-lg tracking-wide text-gold">Contenido</h2>
              <p className="text-xs text-bone/40">Combina y ordena bloques para construir esta entrada.</p>
            </div>
            {BLOCK_TYPES.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => onCreateBlock({ type: item.type, content: '', url: '', caption: '', altText: '' })}
                disabled={busy}
                className="rounded-sm border border-gold/25 px-2.5 py-1.5 text-xs text-gold/80 hover:border-gold hover:bg-gold/10 disabled:opacity-40"
              >
                <span aria-hidden="true" className="mr-1 text-gold/55">{item.glyph}</span>
                {item.label}
              </button>
            ))}
          </div>

          {blocks.length === 0 ? (
            <div className="rounded-md border border-dashed border-bone/15 p-8 text-center">
              <p className="font-display text-bone/60">Entrada vacía</p>
              <p className="mt-1 text-sm text-bone/35">Añade texto, imágenes, vídeo, enlaces o música con los botones superiores.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {blocks.map((block, index) => (
                <ArchiveBlockCard
                  key={block.id}
                  block={block}
                  index={index}
                  total={blocks.length}
                  busy={busy}
                  privateImageUrl={block.imageUrl || privateImageUrl(block.id)}
                  onSave={(body) => onPatchBlock(block.id, body)}
                  onDelete={() => removeBlock(block)}
                  onMove={(direction) => onMoveBlock(block.id, { direction })}
                  onUpload={(file) => onUploadImage(block.id, file)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
