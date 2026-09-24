import { useEffect, useId, useRef, useState } from 'react';
import {
  FIGURE_IMAGE_ACCEPT,
  fetchPresetFigures,
  groupFigures,
  removePresetFigureImage,
  uploadPresetFigureImage,
} from '../lib/presetFigures.js';

// Panel del administrador para vestir las figuras de un escenario de fábrica:
// una imagen por enemigo u objeto (los cuatro «Bandido arquero» comparten la
// suya). La ve cualquiera que juegue el escenario, también en las partidas ya
// montadas, que repintan su tablero al momento.

// Los mismos colores que el disco del marcador sin imagen en el tablero
const DISC_COLORS = { enemigo: '#8c2f2f', objeto: '#b9862f' };

function FigureRow({ figure, busy, onUpload, onRemove }) {
  const inputRef = useRef(null);
  const hasImage = Boolean(figure.imageUrl);

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ochre/40 font-display text-lg text-parchment-100"
        style={hasImage ? undefined : { backgroundColor: DISC_COLORS[figure.kind] }}
      >
        {hasImage ? (
          <img src={figure.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          figure.name.charAt(0).toUpperCase()
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base text-ink">{figure.name}</p>
        <p className="truncate text-xs text-ink/55">
          {figure.count > 1 ? `${figure.count} en el mapa` : '1 en el mapa'} · {figure.rooms.join(', ')}
        </p>
        {hasImage && figure.originalName && (
          <p className="truncate text-[0.7rem] text-ink/40">{figure.originalName}</p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={FIGURE_IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onUpload(figure, file);
        }}
      />
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-sm border border-ink/25 px-3 py-1.5 text-sm text-ink/80 hover:border-ochre hover:text-ochre disabled:opacity-40"
        >
          {busy ? 'Guardando…' : hasImage ? 'Cambiar' : 'Subir'}
        </button>
        {hasImage && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(figure)}
            className="px-2 py-1 text-xs text-ink/50 hover:text-ember disabled:opacity-40"
          >
            Quitar
          </button>
        )}
      </div>
    </li>
  );
}

export default function PresetFiguresDialog({ preset, onClose }) {
  const titleId = useId();
  const [figures, setFigures] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchPresetFigures(preset.id)
      .then((rows) => {
        if (!cancelled) setFigures(rows);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [preset.id]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function run(figure, action) {
    setBusyKey(figure.key);
    setError('');
    try {
      setFigures(await action());
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusyKey(null);
    }
  }

  const groups = groupFigures(figures);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night-950/80 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-lg border border-ochre/45 bg-parchment-100 text-ink shadow-2xl shadow-black/50 sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ochre/25 bg-ochre/10 px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-ochre">
              Administración · imágenes del escenario
            </p>
            <h2 id={titleId} className="mt-1 font-display text-2xl text-ink">{preset.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="px-2 text-ink/50 hover:text-ink">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm leading-relaxed text-ink/65">
            Cada figura lleva su imagen en el marcador del tablero, la barra de iniciativa y el HUD. Las copias de
            una misma figura comparten la suya, y las partidas ya montadas se actualizan al momento. Sin imagen se
            sigue viendo el disco de color de siempre.
          </p>

          {error && (
            <p className="mt-3 rounded-sm border border-ember/30 bg-ember/10 px-3 py-2 text-sm text-ember">{error}</p>
          )}

          {figures === null && !error ? (
            <p className="mt-4 text-ink/60">Cargando…</p>
          ) : (
            groups.map((group) => (
              <section key={group.kind} className="mt-4">
                <h3 className="border-b border-ochre/25 pb-1 font-display text-lg text-ink/80">{group.label}</h3>
                <ul className="divide-y divide-ink/10">
                  {group.figures.map((figure) => (
                    <FigureRow
                      key={figure.key}
                      figure={figure}
                      busy={busyKey === figure.key}
                      onUpload={(target, file) =>
                        run(target, () => uploadPresetFigureImage(preset.id, target.key, file))
                      }
                      onRemove={(target) => run(target, () => removePresetFigureImage(preset.id, target.key))}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
