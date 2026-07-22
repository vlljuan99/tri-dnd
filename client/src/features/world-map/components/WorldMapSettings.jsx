import { useEffect, useRef, useState } from 'react';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-3 py-2 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';
const cardClass = 'rounded-md border border-gold/15 bg-night-900/55 p-4';

// Configuración de una capa del mundo fuera del inspector de ubicaciones.
// Imagen, plantillas y acciones de la capa son conceptos globales y por eso
// ocupan una vista propia, con espacio y jerarquía suficientes.
export default function WorldMapSettings({
  map,
  busy,
  templates,
  onUpload,
  onRemoveImage,
  onGenerate,
  onRename,
  onDelete,
  onSaveTemplate,
  onApplyTemplate,
  onBack,
}) {
  const [name, setName] = useState(map.name);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  const [style, setStyle] = useState(map.isRoot ? 'region' : 'ciudad');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    setName(map.name);
    setPrompt('');
    setStyle(map.isRoot ? 'region' : 'ciudad');
    setNotice('');
  }, [map.id, map.isRoot, map.name]);

  async function run(action, success) {
    try {
      await action();
      if (success) setNotice(success);
    } catch (error) {
      setNotice(error.message || 'No se pudo completar la acción.');
    }
  }

  function saveName() {
    const next = name.trim();
    if (next && next !== map.name) onRename(map.id, next);
    else setName(map.name);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.22em] text-gold/55">Configuración de la capa</p>
            <h2 className="mt-1 font-display text-2xl text-gold">{map.name}</h2>
            <p className="mt-1 max-w-2xl text-sm text-bone/55">
              Prepara la imagen y reutiliza plantillas aquí. Las ubicaciones se editan por separado sobre el mapa.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-sm border border-gold/35 px-3 py-1.5 font-display text-sm text-gold hover:bg-gold/10"
          >
            ← Volver a ubicaciones
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <section className={cardClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-base text-gold">Imagen base</p>
                <p className="mt-1 text-xs text-bone/45">
                  Es el lienzo sobre el que colocarás ciudades, regiones, campamentos y tableros.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-sm bg-gold px-4 py-2 font-display text-sm text-night-950 hover:bg-gold/90 disabled:opacity-40"
              >
                {map.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(map.id, file);
                event.target.value = '';
              }}
            />

            {map.imageUrl ? (
              <div className="mt-4 overflow-hidden rounded-md border border-gold/15 bg-night-950">
                <img src={map.imageUrl} alt={`Vista previa de ${map.name}`} className="max-h-64 w-full object-contain" />
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-bone/20 px-4 py-10 text-center text-sm text-bone/45">
                Esta capa todavía no tiene imagen.
              </div>
            )}

            <form
              className="mt-4 space-y-2 border-t border-gold/10 pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (prompt.trim()) onGenerate(map.id, { prompt: prompt.trim(), provider, estilo: style });
              }}
            >
              <label className={labelClass} htmlFor="world-image-prompt">O generar una imagen con IA</label>
              <textarea
                id="world-image-prompt"
                rows={3}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={style === 'ciudad' ? 'Describe la ciudad y sus barrios…' : 'Describe el mundo o la región…'}
                className={`${inputClass} resize-y`}
              />
              <div className="flex flex-wrap gap-2">
                <select value={style} onChange={(event) => setStyle(event.target.value)} className="min-w-32 flex-1 rounded-sm border border-gold/20 bg-night-950 px-2 py-2 text-sm text-bone focus:border-gold focus:outline-none">
                  <option value="region">Región</option>
                  <option value="ciudad">Ciudad</option>
                </select>
                <select value={provider} onChange={(event) => setProvider(event.target.value)} className="min-w-32 flex-1 rounded-sm border border-gold/20 bg-night-950 px-2 py-2 text-sm text-bone focus:border-gold focus:outline-none">
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                </select>
                <button
                  type="submit"
                  disabled={busy || !prompt.trim()}
                  className="rounded-sm border border-gold/35 px-4 py-2 font-display text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
                >
                  Generar
                </button>
              </div>
            </form>

            {map.imageUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('¿Quitar la imagen de esta capa? Las ubicaciones se conservarán.')) {
                    onRemoveImage(map.id);
                  }
                }}
                className="mt-4 text-xs text-blood/70 hover:text-blood disabled:opacity-40"
              >
                Quitar imagen
              </button>
            )}
          </section>

          <div className="space-y-4">
            {!map.isRoot && (
              <section className={cardClass}>
                <p className="font-display text-base text-gold">Identidad del submapa</p>
                <label className={`${labelClass} mt-3`} htmlFor="world-map-name">Nombre</label>
                <input
                  id="world-map-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={saveName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  className={`${inputClass} mt-1`}
                />
                {map.parent && (
                  <p className="mt-2 text-[0.7rem] text-bone/40">Cuelga del pin «{map.parent.locationName}».</p>
                )}
              </section>
            )}

            <section className={cardClass}>
              <p className="font-display text-base text-gold">Biblioteca de mundos</p>
              <p className="mt-1 text-xs text-bone/45">Guarda esta capa o sustituye su contenido por una plantilla.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onSaveTemplate(map.id), `«${map.name}» guardada en la biblioteca.`)}
                className="mt-3 w-full rounded-sm border border-gold/35 px-3 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
              >
                Guardar como plantilla
              </button>
              <label className={`${labelClass} mt-4`} htmlFor="world-apply-template">Aplicar una plantilla</label>
              <select
                id="world-apply-template"
                value=""
                disabled={busy || templates.length === 0}
                onChange={(event) => {
                  const template = templates.find((item) => item.id === Number(event.target.value));
                  event.target.value = '';
                  if (!template) return;
                  const confirmed = window.confirm(
                    `¿Aplicar «${template.name}» sobre «${map.name}»? Se sustituirán la imagen y las ubicaciones de esta capa.`
                  );
                  if (confirmed) run(() => onApplyTemplate(map.id, template.id), `«${template.name}» aplicada.`);
                }}
                className={`${inputClass} mt-1`}
              >
                <option value="">{templates.length ? 'Elegir plantilla…' : 'No hay plantillas guardadas'}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.meta?.pins ?? 0} ubicaciones)
                  </option>
                ))}
              </select>
              {notice && <p className="mt-2 text-xs text-sage">{notice}</p>}
            </section>

            {!map.isRoot && (
              <section className="rounded-md border border-blood/20 bg-blood/5 p-4">
                <p className="font-display text-base text-blood/85">Zona peligrosa</p>
                <p className="mt-1 text-xs text-bone/45">Esta acción elimina el submapa y todas sus ubicaciones.</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`¿Borrar el submapa «${map.name}» y todas sus ubicaciones?`)) onDelete();
                  }}
                  className="mt-3 w-full rounded-sm border border-blood/40 px-3 py-2 text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  Borrar submapa
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
