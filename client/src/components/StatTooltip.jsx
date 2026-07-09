import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STAT_GLOSSARY } from '../lib/statGlossary.js';

/**
 * Envuelve la etiqueta de una estadística y muestra su explicación al pasar el
 * cursor o al enfocarla con el teclado. La explicación puede venir del glosario
 * central (prop `stat`) o darse a mano (`term` + `desc`), para stats dinámicas
 * como salvaciones o habilidades.
 *
 * El globo se renderiza mediante portal en <body> con posición fija, para que
 * nunca lo recorten los modales o paneles con scroll donde aparecen las stats.
 */
export default function StatTooltip({
  stat,
  term,
  desc,
  children,
  className = '',
  as: Tag = 'span',
  focusable = true,
}) {
  const entry = stat ? STAT_GLOSSARY[stat] : null;
  const title = term ?? entry?.term;
  const body = desc ?? entry?.desc;

  const ref = useRef(null);
  const id = useId();
  const [tip, setTip] = useState(null); // { x, y, below } | null

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 96; // cerca del borde superior → coloca el globo debajo
    // Centramos el globo sobre la etiqueta pero lo acotamos al viewport para
    // que no se salga por los lados (las stats suelen ir pegadas a los bordes).
    const half = Math.min(124, window.innerWidth * 0.4);
    const center = r.left + r.width / 2;
    const x = Math.max(8 + half, Math.min(window.innerWidth - 8 - half, center));
    setTip({ x, y: below ? r.bottom : r.top, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  // Sin texto que explicar, no añadimos comportamiento ni foco extra.
  if (!body) return <Tag className={className}>{children}</Tag>;

  return (
    <Tag
      ref={ref}
      className={`cursor-help ${className}`}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={tip ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={focusable ? show : undefined}
      onBlur={focusable ? hide : undefined}
    >
      {children}
      {tip &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              position: 'fixed',
              left: tip.x,
              top: tip.y,
              transform: tip.below ? 'translate(-50%, 8px)' : 'translate(-50%, calc(-100% - 8px))',
            }}
            className="pointer-events-none z-[100] block w-60 max-w-[80vw] whitespace-normal rounded-sm border border-gold/30 bg-night-900 px-2.5 py-2 text-left font-sans text-xs normal-case leading-relaxed tracking-normal text-bone/80 shadow-xl"
          >
            {title && (
              <span className="mb-0.5 block font-display uppercase tracking-wider text-gold">{title}</span>
            )}
            {body}
          </span>,
          document.body,
        )}
    </Tag>
  );
}
