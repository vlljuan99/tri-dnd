import { useEffect, useId, useRef, useState } from 'react';
import { matchesRequiredText } from '../lib/confirmations.js';

// Confirmación visual compartida para acciones que cambian la mesa o borran
// contenido. El texto obligatorio permite proteger operaciones irreversibles
// sin depender de window.confirm ni de la apariencia del navegador.
export default function ConfirmationDialog({
  open,
  title,
  description,
  detail,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  requiredText,
  busy = false,
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const descriptionId = useId();
  const inputRef = useRef(null);
  const cancelRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return undefined;
    setTyped('');
    const focusId = window.requestAnimationFrame(() => {
      (requiredText ? inputRef.current : cancelRef.current)?.focus();
    });
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busyRef.current) onCancelRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, requiredText]);

  if (!open) return null;
  const canConfirm = !busy && matchesRequiredText(typed, requiredText);
  const warning = tone === 'warning';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md overflow-hidden rounded-lg border border-ochre/45 bg-parchment-100 text-ink shadow-2xl shadow-black/50"
      >
        <div className="border-b border-ochre/25 bg-ochre/10 px-5 py-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-ochre">
            {warning ? 'Cambio visible en la mesa' : 'Acción irreversible'}
          </p>
          <h2 id={titleId} className="mt-1 font-display text-2xl text-ink">{title}</h2>
        </div>

        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canConfirm) onConfirm();
          }}
        >
          <p id={descriptionId} className="text-sm leading-relaxed text-ink/70">{description}</p>
          {detail && (
            <div className={`rounded-sm border px-3 py-2 text-sm ${
              warning
                ? 'border-ochre/35 bg-ochre/10 text-ink/75'
                : 'border-ember/30 bg-ember/10 text-ember'
            }`}>
              {detail}
            </div>
          )}

          {requiredText !== undefined && (
            <label className="block text-sm text-ink/70">
              Escribe <strong className="font-semibold text-ink">{requiredText}</strong> para confirmar
              <input
                ref={inputRef}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 w-full rounded-sm border border-ink/25 bg-parchment-50 px-3 py-2 text-ink focus:border-ember focus:outline-none"
              />
            </label>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-ochre/20 pt-4 sm:flex-row sm:justify-end">
            <button
              ref={cancelRef}
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-sm border border-ink/25 px-4 py-2 font-display text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-40"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              className={`rounded-sm px-4 py-2 font-display text-sm text-parchment-100 disabled:cursor-not-allowed disabled:opacity-35 ${
                warning ? 'bg-ochre hover:bg-ochre/90' : 'bg-ember hover:bg-ember/90'
              }`}
            >
              {busy ? 'Procesando…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
