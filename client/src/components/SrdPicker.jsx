import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api.js';

/**
 * Modal de búsqueda sobre el compendio SRD sincronizado.
 * `filters` se añade a la query (p. ej. { cat: 'weapon' } o { class: 'wizard' }).
 */
export default function SrdPicker({ title, category, filters = {}, onPick, onClose, renderMeta }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ ...(q ? { q } : {}), ...filters });
        const { results } = await api(`/srd/${category}?${params}`);
        setResults(results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, JSON.stringify(filters)]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-lg border border-gold/25 bg-night-900 p-4 text-bone sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg tracking-wide text-gold">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="px-2 text-bone/60 hover:text-bone">
            ✕
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          className="mb-3 w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none"
        />
        <div className="min-h-32 flex-1 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-bone/50">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-bone/50">Sin resultados</p>
          ) : (
            <ul className="divide-y divide-bone/10">
              {results.map((entry) => (
                <li key={entry.index}>
                  <button
                    onClick={() => onPick(entry)}
                    className="flex w-full items-baseline justify-between gap-3 px-2 py-2 text-left transition-colors hover:bg-gold/10"
                  >
                    <span>
                      {entry.name}
                      {!entry.translated && (
                        <span className="ml-2 rounded-sm border border-bone/20 px-1 text-xs text-bone/40" title="Traducción pendiente">
                          EN
                        </span>
                      )}
                    </span>
                    {renderMeta && (
                      <span className="shrink-0 font-mono text-xs text-bone/50">{renderMeta(entry)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
}
