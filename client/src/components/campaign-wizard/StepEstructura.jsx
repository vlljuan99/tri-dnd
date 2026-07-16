import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { inputClass } from '../wizard/styles.js';

export function validateEstructura() {
  return {};
}

function sectionIcon(title) {
  const normalized = title.toLocaleLowerCase('es');
  if (normalized.includes('personaje')) return '♟';
  if (normalized.includes('faccion')) return '⚑';
  if (normalized.includes('lugar')) return '⌖';
  if (normalized.includes('trama') || normalized.includes('sesion')) return '✦';
  return '▤';
}

/** Paso 2 — Presenta y permite ampliar la raíz del archivo recién creado. */
export default function StepEstructura({ campaign }) {
  const [nodes, setNodes] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/campaigns/${campaign.id}/archivo`)
      .then(({ nodes: loaded }) => {
        if (!cancelled) setNodes(loaded ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar la estructura del archivo.');
      });
    return () => {
      cancelled = true;
    };
  }, [campaign.id]);

  async function addRootSection(e) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || busy) return;
    setBusy(true);
    setError('');
    try {
      const { node } = await api(`/campaigns/${campaign.id}/archivo/nodos`, {
        method: 'POST',
        body: { parentId: null, kind: 'seccion', title: cleanTitle, summary: '' },
      });
      setNodes((current) => [...(current ?? []), node]);
      setTitle('');
    } catch (e) {
      setError(e.message || 'No se pudo añadir la sección.');
    } finally {
      setBusy(false);
    }
  }

  const rootSections = (nodes ?? [])
    .filter((node) => node.kind === 'seccion' && node.parentId == null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-gold/60">Paso 2</p>
        <h2 className="font-display text-2xl tracking-wide text-gold">Estructura del archivo</h2>
      </div>

      <p className="text-sm leading-relaxed text-bone/70">
        Hemos preparado una estructura flexible para que el lore no termine en una única nota enorme.
        Dentro de cada sección podrás crear documentos, añadir medios y enlazar personajes o lugares.
      </p>

      {error && <p className="rounded-sm border border-blood/30 bg-blood/10 p-2 text-sm text-blood">{error}</p>}

      {nodes === null && !error ? (
        <p className="text-sm text-bone/45">Preparando el archivo…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rootSections.map((section) => (
            <div
              key={section.id}
              className="flex items-center gap-3 rounded-sm border border-gold/15 bg-night-950/55 px-3 py-2.5"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-gold/20 text-gold/70">
                {sectionIcon(section.title)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-sm text-bone">{section.title}</p>
                <p className="text-[0.65rem] text-bone/40">Sección raíz</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addRootSection} className="rounded-sm border border-dashed border-gold/25 p-3">
        <label htmlFor="new-root-section" className="text-xs uppercase tracking-wider text-bone/55">
          Añadir otra carpeta raíz
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="new-root-section"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Religiones, calendario, reglas de mesa…"
            className={`${inputClass} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="shrink-0 rounded-sm border border-gold/40 px-3 py-1.5 font-display text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            {busy ? 'Añadiendo…' : '+ Añadir'}
          </button>
        </div>
      </form>

      <p className="text-xs leading-relaxed text-bone/45">
        Nada queda bloqueado: en el archivo podrás renombrar, reordenar, anidar o borrar estas secciones.
      </p>
    </div>
  );
}
