/**
 * Bloque de ayuda contextual breve, plegado por defecto ("¿Qué significa esto?").
 * Accesible: botón con aria-expanded/aria-controls, contenido asociado por id.
 */
import { useId, useState } from 'react';

export default function HelpBlock({ title = '¿Qué significa esto?', children }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs text-gold/80 underline decoration-dotted underline-offset-2 hover:text-gold"
      >
        <span aria-hidden="true">{open ? '▾' : 'ⓘ'}</span> {title}
      </button>
      {open && (
        <div id={id} className="mt-1.5 rounded-sm border border-gold/15 bg-night-950/60 p-2.5 text-xs leading-relaxed text-bone/70">
          {children}
        </div>
      )}
    </div>
  );
}
