import { useRef, useState } from 'react';

export default function CharacterAvatarPanel({ avatarUrl, editable, busy, error, onUpload, onGenerate, onRemove }) {
  const fileInputRef = useRef(null);
  const [open, setOpen] = useState(false);
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
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-gold/30 bg-night-950">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Icono del personaje" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-center text-xs text-bone/40">
            Sin icono
          </div>
        )}
      </div>

      {editable && (
        <div className="flex flex-1 flex-col items-center gap-2 sm:items-start">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="self-center rounded-sm border border-gold/25 px-3 py-1 font-display text-xs uppercase tracking-widest text-gold/80 hover:border-gold hover:text-gold sm:self-start"
          >
            {open ? 'Cerrar' : 'Cambiar icono'}
          </button>

          {open && (
            <div className="w-full max-w-sm space-y-2 rounded-sm border border-gold/15 bg-night-950/50 p-3 text-sm">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                disabled={busy}
                className="hidden"
                id="character-avatar-file-input"
              />
              <label
                htmlFor="character-avatar-file-input"
                className={`flex min-h-9 w-full cursor-pointer items-center justify-center rounded-sm border border-bone/20 px-3 text-sm hover:border-gold hover:text-gold ${
                  busy ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                Subir foto
              </label>

              <form onSubmit={handleGenerate} className="space-y-2 border-t border-bone/10 pt-2">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={busy}
                  placeholder="Ej: elfa guerrera pelirroja con armadura de cuero y una cicatriz en la ceja"
                  rows={2}
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
                    {busy ? 'Generando…' : 'Generar con IA'}
                  </button>
                </div>
              </form>

              <button
                type="button"
                onClick={onRemove}
                disabled={busy || !avatarUrl}
                className="min-h-9 w-full rounded-sm border border-blood/50 px-3 text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
              >
                Quitar icono
              </button>

              {error && <p className="text-xs text-blood">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
