import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CATEGORIES = [
  ['spells', 'Hechizos'],
  ['monsters', 'Monstruos'],
  ['equipment', 'Equipo'],
  ['conditions', 'Condiciones'],
];
const LABELS = Object.fromEntries(CATEGORIES);

function Meta({ entry }) {
  const meta = entry.meta ?? {};
  if (entry.category === 'spells') return <>{meta.level === 0 ? 'Truco' : `Nivel ${meta.level}`}{meta.concentration ? ' \u00b7 concentraci\u00f3n' : ''}</>;
  if (entry.category === 'monsters') return <>VD {meta.cr ?? '\u2014'} &middot; {meta.hp ?? '\u2014'} PG</>;
  if (entry.category === 'equipment') return <>{meta.equipmentCategory?.replaceAll('-', ' ') ?? 'Equipo'}</>;
  return <>{LABELS[entry.category]}</>;
}

function Detail({ entry, onClose }) {
  const data = entry.data ?? {};
  const description = entry.descEs || (Array.isArray(data.desc) ? data.desc.join('\n\n') : data.desc);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
      <article className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-lg border border-ink/20 bg-parchment-100 p-5 shadow-2xl sm:rounded-lg" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xs uppercase tracking-widest text-ember">{LABELS[entry.category]}</p>
            <h2 className="font-display text-2xl font-bold">{entry.name}</h2>
            {entry.nameEn !== entry.name && <p className="text-sm italic text-ink/55">{entry.nameEn}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar detalle" className="text-xl text-ink/60">&times;</button>
        </div>
        <p className="mt-3 text-sm font-semibold text-ink/65"><Meta entry={entry} /></p>
        {description
          ? <div className="mt-5 whitespace-pre-line leading-relaxed text-ink/85">{description}</div>
          : <p className="mt-5 italic text-ink/50">Esta entrada no incluye una descripci&oacute;n resumida.</p>}
      </article>
    </div>
  );
}

export default function CompendiumPage() {
  const [q, setQ] = useState('');
  const [categories, setCategories] = useState(CATEGORIES.map(([key]) => key));
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ q, categorias: categories.join(',') });
        const response = await api(`/srd/buscar?${params}`);
        setResults(response.results);
      } catch (err) {
        setResults([]);
        setError(err.message || 'No se pudo consultar el compendio.');
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q, categories]);

  function toggleCategory(category) {
    setCategories((current) => current.includes(category)
      ? (current.length === 1 ? current : current.filter((item) => item !== category))
      : [...current, category]);
  }

  async function openDetail(entry) {
    try {
      setDetail(await api(`/srd/${entry.category}/${encodeURIComponent(entry.index)}`));
    } catch (err) {
      setError(err.message || 'No se pudo abrir la entrada.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h2 className="font-display text-3xl font-bold">Compendio</h2>
      <p className="mt-1 text-ink/65">Busca a la vez entre hechizos, monstruos, equipo y condiciones.</p>
      <input autoFocus value={q} onChange={(event) => setQ(event.target.value)}
        placeholder={'Buscar por nombre en espa\u00f1ol o ingl\u00e9s...'}
        className="mt-6 w-full rounded-sm border border-ink/25 bg-parchment-50 px-4 py-3 text-lg outline-none focus:border-ember" />
      <div className="mt-3 flex flex-wrap gap-2">
        {CATEGORIES.map(([key, label]) => (
          <button key={key} onClick={() => toggleCategory(key)} className={`rounded-full border px-3 py-1 text-sm ${categories.includes(key) ? 'border-ember bg-ember/10 text-ember' : 'border-ink/20 text-ink/50'}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-blood">{error}</p>}
      {loading ? <p className="py-12 text-center text-ink/45">Buscando&hellip;</p> : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {results.map((entry) => (
            <li key={`${entry.category}:${entry.index}`}>
              <button onClick={() => openDetail(entry)} className="w-full rounded-sm border border-ink/15 bg-parchment-50 p-4 text-left transition hover:border-ember/50 hover:shadow-sm">
                <span className="flex items-start justify-between gap-3">
                  <span className="font-display text-lg font-semibold">{entry.name}</span>
                  <span className="shrink-0 text-xs uppercase tracking-wide text-ember">{LABELS[entry.category]}</span>
                </span>
                <span className="mt-1 block text-sm text-ink/55"><Meta entry={entry} />{!entry.translated ? ' \u00b7 EN' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && results.length === 0 && !error && <p className="py-12 text-center text-ink/45">No hay resultados con esos filtros.</p>}
      {detail && <Detail entry={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}
