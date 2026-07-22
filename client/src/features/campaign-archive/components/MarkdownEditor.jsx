import { useRef, useState } from 'react';
import { applyMarkdownAction } from '../lib/markdown.js';
import MarkdownPreview from './MarkdownPreview.jsx';

const toolButton =
  'rounded-sm border border-bone/15 bg-night-950/45 px-2 py-1 text-xs text-bone/70 hover:border-gold/45 hover:text-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-35';
const toolSelect =
  'min-w-0 rounded-sm border border-bone/15 bg-night-950/70 px-2 py-1 text-xs text-bone/70 focus:border-gold focus:outline-none';

export default function MarkdownEditor({
  value,
  onChange,
  entries = [],
  currentEntryId,
  onNavigateReference,
  rows = 10,
  maxLength = 50000,
}) {
  const [mode, setMode] = useState('write');
  const textareaRef = useRef(null);
  const referenceEntries = entries
    .filter((entry) => Number(entry.id) !== Number(currentEntryId))
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));

  function apply(action, payload) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const result = applyMarkdownAction({ value, start, end, action, payload });
    onChange(result.value);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  function handleShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const action = event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : event.key.toLowerCase() === 'k' ? 'link' : null;
    if (!action) return;
    event.preventDefault();
    apply(action);
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-sm border border-bone/20 bg-night-950 focus-within:border-gold">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-bone/10 bg-night-900/80 p-2">
        <div className="mr-1 flex rounded-sm border border-bone/15 p-0.5" aria-label="Modo del editor">
          <button
            type="button"
            onClick={() => setMode('write')}
            className={`rounded-sm px-2 py-1 text-xs ${mode === 'write' ? 'bg-gold text-night-950' : 'text-bone/55 hover:text-bone'}`}
          >
            Escribir
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`rounded-sm px-2 py-1 text-xs ${mode === 'preview' ? 'bg-gold text-night-950' : 'text-bone/55 hover:text-bone'}`}
          >
            Vista previa
          </button>
        </div>

        <select
          defaultValue=""
          aria-label="Estilo del párrafo"
          disabled={mode !== 'write'}
          onChange={(event) => {
            if (event.target.value) apply(event.target.value);
            event.target.value = '';
          }}
          className={toolSelect}
        >
          <option value="" disabled>Estilo de texto</option>
          <option value="paragraph">Párrafo</option>
          <option value="heading1">Título grande</option>
          <option value="heading2">Título</option>
          <option value="heading3">Subtítulo</option>
          <option value="quote">Cita</option>
          <option value="code">Código</option>
        </select>

        <button type="button" disabled={mode !== 'write'} onClick={() => apply('bold')} title="Negrita (Ctrl+B)" aria-label="Negrita" className={`${toolButton} font-bold`}>B</button>
        <button type="button" disabled={mode !== 'write'} onClick={() => apply('italic')} title="Cursiva (Ctrl+I)" aria-label="Cursiva" className={`${toolButton} italic`}>I</button>
        <button type="button" disabled={mode !== 'write'} onClick={() => apply('strike')} title="Tachado" aria-label="Tachado" className={`${toolButton} line-through`}>S</button>
        <button type="button" disabled={mode !== 'write'} onClick={() => apply('unorderedList')} title="Lista con viñetas" aria-label="Lista con viñetas" className={toolButton}>• Lista</button>
        <button type="button" disabled={mode !== 'write'} onClick={() => apply('orderedList')} title="Lista numerada" aria-label="Lista numerada" className={toolButton}>1. Lista</button>
        <button type="button" disabled={mode !== 'write'} onClick={() => apply('link')} title="Enlace externo (Ctrl+K)" aria-label="Enlace externo" className={toolButton}>Enlace</button>

        <select
          defaultValue=""
          aria-label="Insertar referencia a otra entrada"
          disabled={mode !== 'write' || referenceEntries.length === 0}
          onChange={(event) => {
            const target = referenceEntries.find((entry) => Number(entry.id) === Number(event.target.value));
            if (target) apply('reference', { id: target.id, title: target.title });
            event.target.value = '';
          }}
          className={`${toolSelect} max-w-full sm:ml-auto sm:max-w-56`}
        >
          <option value="">@ Referenciar entrada…</option>
          {referenceEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          rows={rows}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleShortcut}
          placeholder="Escribe el lore con Markdown. Usa la barra para dar formato o enlazar otra entrada…"
          className="block w-full resize-y bg-transparent px-3 py-3 font-body text-sm leading-7 text-bone placeholder:text-bone/30 focus:outline-none"
        />
      ) : (
        <div className="min-h-56 bg-night-950/45 px-4 py-4">
          {value.trim() ? (
            <MarkdownPreview value={value} entries={entries} onNavigateReference={onNavigateReference} />
          ) : (
            <p className="py-12 text-center text-sm italic text-bone/35">La vista previa aparecerá aquí cuando escribas contenido.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-bone/10 px-3 py-1.5 text-[0.65rem] text-bone/35">
        <span>Markdown · Ctrl+B negrita · Ctrl+I cursiva · Ctrl+K enlace</span>
        <span className="shrink-0">{value.length.toLocaleString('es-ES')} / {maxLength.toLocaleString('es-ES')}</span>
      </div>
    </div>
  );
}
