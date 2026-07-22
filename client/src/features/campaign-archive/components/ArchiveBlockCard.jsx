import { useEffect, useRef, useState } from 'react';
import MediaPreview from './MediaPreview.jsx';
import MarkdownEditor from './MarkdownEditor.jsx';
import {
  blockDraftAfterPrivateUpload,
  blockDraftFrom,
  keepDraftOnRefresh,
} from '../lib/drafts.js';

const inputClass =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-2.5 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none disabled:opacity-50';
const labelClass = 'block text-[0.65rem] uppercase tracking-[0.16em] text-bone/45';

const TYPE_LABELS = {
  texto: 'Texto',
  imagen: 'Imagen',
  video: 'Vídeo',
  enlace: 'Enlace',
  musica: 'Música',
};

export default function ArchiveBlockCard({
  block,
  index,
  total,
  busy,
  privateImageUrl,
  onSave,
  onDelete,
  onMove,
  onUpload,
  referenceEntries = [],
  currentEntryId,
  onNavigateReference,
}) {
  const [draft, setDraft] = useState(() => blockDraftFrom(block));
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const activeBlockIdRef = useRef(block.id);

  useEffect(() => {
    setDraft((current) => keepDraftOnRefresh(current, activeBlockIdRef.current, block, blockDraftFrom));
    activeBlockIdRef.current = block.id;
  }, [block]);

  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const changed = ['content', 'url', 'caption', 'altText'].some((key) => (draft[key] ?? '') !== (block[key] ?? ''));

  async function save() {
    const body = {
      type: block.type,
      content: draft.content ?? '',
      url: draft.url?.trim() ?? '',
      caption: draft.caption ?? '',
      altText: draft.altText ?? '',
    };
    setSaving(true);
    try {
      const result = await onSave(body);
      if (result?.block) setDraft(blockDraftFrom(result.block));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file) {
    if (!file) return;
    try {
      const result = await onUpload(file);
      if (result?.block) setDraft((current) => blockDraftAfterPrivateUpload(current));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const previewBlock = { ...block, ...draft };

  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-gold/15 bg-night-900/80 p-3 shadow-sm">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 border-b border-bone/10 pb-2">
        <span className="rounded-sm border border-gold/25 bg-gold/5 px-2 py-0.5 font-display text-xs uppercase tracking-widest text-gold/80">
          {TYPE_LABELS[block.type] ?? block.type}
        </span>
        <span className="text-xs text-bone/35">Bloque {index + 1}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={busy || index === 0}
            title="Subir bloque"
            aria-label="Subir bloque"
            className="rounded-sm border border-bone/15 px-2 py-1 text-xs text-bone/60 hover:border-gold hover:text-gold disabled:opacity-25"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={busy || index === total - 1}
            title="Bajar bloque"
            aria-label="Bajar bloque"
            className="rounded-sm border border-bone/15 px-2 py-1 text-xs text-bone/60 hover:border-gold hover:text-gold disabled:opacity-25"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-sm border border-blood/35 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
          >
            Borrar
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {block.type === 'texto' && (
          <div className="min-w-0 space-y-1">
            <span className={labelClass}>Contenido enriquecido</span>
            <MarkdownEditor
              rows={9}
              value={draft.content ?? ''}
              onChange={(value) => set('content', value)}
              entries={referenceEntries}
              currentEntryId={currentEntryId}
              onNavigateReference={onNavigateReference}
            />
          </div>
        )}

        {block.type === 'imagen' && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block space-y-1">
                <span className={labelClass}>URL externa de la imagen</span>
                <input
                  type="url"
                  maxLength={2048}
                  value={draft.url ?? ''}
                  onChange={(event) => set('url', event.target.value)}
                  placeholder="https://…"
                  className={inputClass}
                />
              </label>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(event) => upload(event.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-sm border border-gold/35 px-3 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
                >
                  {block.hasPrivateImage ? 'Sustituir subida' : 'Subir imagen privada'}
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className={labelClass}>Pie de imagen</span>
                <input
                  value={draft.caption ?? ''}
                  maxLength={500}
                  onChange={(event) => set('caption', event.target.value)}
                  placeholder="Texto visible bajo la imagen"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Descripción accesible</span>
                <input
                  value={draft.altText ?? ''}
                  maxLength={500}
                  onChange={(event) => set('altText', event.target.value)}
                  placeholder="Describe brevemente lo que aparece"
                  className={inputClass}
                />
              </label>
            </div>
            {block.hasPrivateImage && (
              <p className="text-xs text-sage">
                La imagen subida es privada. Si guardas una URL externa, esa URL sustituirá la subida.
              </p>
            )}
          </>
        )}

        {(block.type === 'video' || block.type === 'musica') && (
          <>
            <label className="block space-y-1">
              <span className={labelClass}>{block.type === 'video' ? 'URL del vídeo' : 'URL de la música o audio'}</span>
              <input
                type="url"
                maxLength={2048}
                value={draft.url ?? ''}
                onChange={(event) => set('url', event.target.value)}
                placeholder={block.type === 'video' ? 'YouTube, Vimeo o vídeo directo…' : 'Spotify o archivo de audio directo…'}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Nota o descripción</span>
              <textarea
                rows={2}
                maxLength={50000}
                value={draft.content ?? ''}
                onChange={(event) => set('content', event.target.value)}
                placeholder="Por qué está aquí o cuándo utilizarlo…"
                className={`${inputClass} resize-y`}
              />
            </label>
          </>
        )}

        {block.type === 'enlace' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className={labelClass}>Texto del enlace</span>
              <input
                value={draft.content ?? ''}
                maxLength={50000}
                onChange={(event) => set('content', event.target.value)}
                placeholder="Documento de referencia"
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>URL</span>
              <input
                type="url"
                maxLength={2048}
                value={draft.url ?? ''}
                onChange={(event) => set('url', event.target.value)}
                placeholder="https://…"
                className={inputClass}
              />
            </label>
          </div>
        )}

        {block.type !== 'texto' && <MediaPreview block={previewBlock} privateImageUrl={privateImageUrl} />}

        <div className="flex items-center justify-end gap-2 border-t border-bone/10 pt-2">
          {changed && <span className="mr-auto text-xs text-ochre">Cambios sin guardar</span>}
          <button
            type="button"
            onClick={() => setDraft(blockDraftFrom(block))}
            disabled={!changed || saving}
            className="rounded-sm border border-bone/20 px-3 py-1.5 text-xs text-bone/60 hover:text-bone disabled:opacity-30"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!changed || busy || saving}
            className="rounded-sm bg-gold px-3 py-1.5 font-display text-xs tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-35"
          >
            {saving ? 'Guardando…' : 'Guardar bloque'}
          </button>
        </div>
      </div>
    </article>
  );
}
