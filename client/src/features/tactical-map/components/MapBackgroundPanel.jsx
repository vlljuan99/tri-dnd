import { useRef, useState } from 'react';

export default function MapBackgroundPanel({
  map,
  busy,
  error,
  onUpload,
  onGenerate,
  onRemove,
  onClose,
}) {
  const fileInputRef = useRef(null);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(file);
  }

  function handleGenerate(event) {
    event.preventDefault();
    const clean = prompt.trim();
    if (!clean || busy) return;
    onGenerate({ prompt: clean, provider });
  }

  return (
    <div className="pointer-events-auto absolute left-3 top-20 z-20 w-[min(22rem,calc(100vw-1.5rem))] rounded-sm border border-gold/25 bg-night-900/95 p-3 text-bone shadow-xl backdrop-blur sm:left-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-sm uppercase tracking-widest text-gold">Imagen del mapa</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-bone/60 hover:text-bone"
          aria-label="Cerrar panel de imagen del mapa"
        >
          Cerrar
        </button>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            disabled={busy}
            className="hidden"
            id="tactical-map-file-input"
          />
          <label
            htmlFor="tactical-map-file-input"
            className={`flex min-h-10 w-full cursor-pointer items-center justify-center rounded-sm border border-bone/20 px-3 font-display text-sm hover:border-gold hover:text-gold ${
              busy ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            Subir imagen desde el dispositivo
          </label>
        </div>

        <form onSubmit={handleGenerate} className="space-y-2 border-t border-bone/10 pt-3">
          <label className="block text-xs uppercase tracking-widest text-bone/60" htmlFor="tactical-map-prompt">
            Generar con IA
          </label>
          <textarea
            id="tactical-map-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            placeholder="Ej: cripta en ruinas con un altar sombrío, antorchas y niebla baja"
            rows={3}
            className="w-full resize-none rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-sm text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none"
          />
          <div className="flex gap-2">
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              disabled={busy}
              className="rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none"
            >
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
            </select>
            <button
              type="submit"
              disabled={busy || !prompt.trim()}
              className="flex-1 rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
            >
              {busy ? 'Generando…' : 'Generar'}
            </button>
          </div>
        </form>

        <button
          type="button"
          onClick={onRemove}
          disabled={busy || !map.backgroundUrl}
          className="min-h-10 w-full rounded-sm border border-blood/50 px-3 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Quitar imagen y volver al mapa base
        </button>

        {error && <p className="text-xs text-blood">{error}</p>}
      </div>
    </div>
  );
}
