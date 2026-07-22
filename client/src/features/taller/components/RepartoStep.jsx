import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { buildTallerReturnSearch } from '../../../lib/characterReturn.js';
import {
  REPARTO_CATEGORIES,
  filterRepartoCharacters,
  filterRepartoLibrary,
  repartoCategory,
  repartoCategoryCounts,
} from '../lib/reparto.js';
import StepShell from './StepShell.jsx';

const PAGE_SIZE = 8;
const CATEGORY_LABELS = { pnj: 'PNJ', enemigo: 'Enemigo', jefe: 'Jefe' };
const CATEGORY_STYLES = {
  pnj: 'border-sage/40 bg-sage/10 text-sage',
  enemigo: 'border-blood/45 bg-blood/10 text-blood',
  jefe: 'border-ochre/45 bg-ochre/10 text-ochre',
};

function libraryMeta(tipo, entry) {
  if (tipo === 'hechizos') {
    const level = entry.meta?.level;
    if (level === 0) return 'Truco';
    if (Number.isInteger(level)) return `Nivel ${level}`;
    return 'Hechizo';
  }
  return entry.meta?.damage?.dice ?? entry.meta?.equipmentCategory ?? 'Objeto';
}

function LibrarySection({
  tipo,
  title,
  entries,
  sourceCount,
  limit,
  query,
  onlyCampaign,
  busy,
  onToggle,
  onShowMore,
  onShowAll,
}) {
  const visible = entries.slice(0, limit);
  const remaining = Math.max(0, entries.length - visible.length);

  return (
    <section className="min-w-0 rounded-md border border-gold/15 bg-night-900/55">
      <header className="flex items-center justify-between gap-3 border-b border-gold/10 px-3 py-2.5">
        <div>
          <h4 className="font-display text-sm uppercase tracking-widest text-gold/80">{title}</h4>
          <p className="text-[0.65rem] text-bone/40">
            {entries.length} resultado{entries.length === 1 ? '' : 's'}
          </p>
        </div>
        <span className="rounded-full border border-gold/20 px-2 py-0.5 font-mono text-xs text-gold/65">
          {entries.length}
        </span>
      </header>

      {sourceCount === 0 ? (
        <p className="p-4 text-xs italic text-bone/40">
          Nada en tu biblioteca todavía. Créalo desde «Editar biblioteca».
        </p>
      ) : entries.length === 0 ? (
        <div className="p-4 text-center">
          <p className="text-xs italic text-bone/45">
            {query.trim()
              ? `No hay ${title.toLowerCase()} que coincidan con la búsqueda y los filtros.`
              : `No hay ${title.toLowerCase()} asignados a esta campaña.`}
          </p>
          {onlyCampaign && (
            <button type="button" onClick={onShowAll} className="mt-2 text-xs text-gold underline underline-offset-2">
              Ver toda la biblioteca
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-bone/10">
            {visible.map((entry) => (
              <li key={entry.index} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-bone">{entry.name}</p>
                  <p className="truncate text-[0.65rem] uppercase tracking-wider text-bone/35">
                    {libraryMeta(tipo, entry)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(tipo, entry)}
                  disabled={busy}
                  className={`shrink-0 rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
                    entry.assigned
                      ? 'border-sage/60 text-sage hover:bg-sage/10'
                      : 'border-bone/25 text-bone/70 hover:border-gold hover:text-gold'
                  }`}
                >
                  {entry.assigned ? 'En campaña ✓' : 'Añadir'}
                </button>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <button
              type="button"
              onClick={onShowMore}
              className="w-full border-t border-gold/10 px-3 py-2 text-xs text-gold/75 hover:bg-gold/5 hover:text-gold"
            >
              Mostrar más ({remaining})
            </button>
          )}
        </>
      )}
    </section>
  );
}

// Paso 4 — Reparto: un panel de trabajo para encontrar y asignar el elenco y
// sus recursos sin convertir las colecciones del DM en listas interminables.
export default function RepartoStep({ progress }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('todos');
  const [onlyCampaign, setOnlyCampaign] = useState(true);
  const [limits, setLimits] = useState({ characters: PAGE_SIZE, objetos: PAGE_SIZE, hechizos: PAGE_SIZE });
  const returnSearch = buildTallerReturnSearch(id, 'reparto');
  const data = progress.gestion;

  useEffect(() => {
    setLimits({ characters: PAGE_SIZE, objetos: PAGE_SIZE, hechizos: PAGE_SIZE });
  }, [query, category, onlyCampaign]);

  const characters = useMemo(
    () => filterRepartoCharacters(data?.characters, { query, category, onlyCampaign }),
    [data?.characters, query, category, onlyCampaign]
  );
  const categoryCounts = useMemo(
    () => repartoCategoryCounts(data?.characters, { query, onlyCampaign }),
    [data?.characters, query, onlyCampaign]
  );
  const objects = useMemo(
    () => filterRepartoLibrary(data?.library?.objetos, { query, onlyCampaign }),
    [data?.library?.objetos, query, onlyCampaign]
  );
  const spells = useMemo(
    () => filterRepartoLibrary(data?.library?.hechizos, { query, onlyCampaign }),
    [data?.library?.hechizos, query, onlyCampaign]
  );

  async function toggleCharacter(character) {
    setBusy(true);
    setError('');
    try {
      await api(`/characters/${character.id}`, {
        method: 'PUT',
        body: { campaign_id: character.assigned ? null : Number(id) },
      });
      await progress.refreshResource('gestion');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createDmCharacter(dmCategory) {
    setBusy(true);
    setError('');
    try {
      const { character } = await api('/characters', {
        method: 'POST',
        body: { kind: 'boss', dm_category: dmCategory },
      });
      await api(`/characters/${character.id}`, { method: 'PUT', body: { campaign_id: Number(id) } });
      navigate(`/personajes/${character.id}${returnSearch}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function toggleLibrary(tipo, entry) {
    const contentId = entry.index.replace('custom:', '');
    setBusy(true);
    setError('');
    try {
      await api(`/campaigns/${id}/biblioteca/${tipo}/${contentId}`, {
        method: entry.assigned ? 'DELETE' : 'PUT',
      });
      await progress.refreshResource('gestion');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const visibleCharacters = characters.slice(0, limits.characters);
  const remainingCharacters = Math.max(0, characters.length - visibleCharacters.length);
  const totalResults = characters.length + objects.length + spells.length;

  return (
    <StepShell
      progress={progress}
      stepId="reparto"
      description="Encuentra, organiza y asigna el elenco de la campaña y los recursos de tu biblioteca. Después podrás colocarlos como marcadores en los mapas."
    >
      {error && <p className="mb-4 text-sm text-blood">{error}</p>}
      {!data ? (
        <p className="text-bone/50">Cargando…</p>
      ) : (
        <div className="space-y-7">
          <section aria-labelledby="reparto-filtros" className="rounded-md border border-gold/20 bg-night-900/70 p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="min-w-0 flex-1">
                <span id="reparto-filtros" className="mb-1 block text-[0.65rem] uppercase tracking-widest text-bone/45">
                  Buscar en el reparto
                </span>
                <span className="relative block">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nombre de PNJ, enemigo, objeto o hechizo…"
                    className="w-full rounded-sm border border-bone/20 bg-night-950 py-2 pl-3 pr-9 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-bone/45 hover:text-bone"
                    >
                      ×
                    </button>
                  )}
                </span>
              </label>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-sm border border-sage/35 bg-sage/5 px-3 py-2 text-sm text-sage">
                <input
                  type="checkbox"
                  checked={onlyCampaign}
                  onChange={(event) => setOnlyCampaign(event.target.checked)}
                  className="h-4 w-4 accent-[#a9b67d]"
                />
                Solo esta campaña
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar fichas por categoría">
              {REPARTO_CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.id}
                  onClick={() => setCategory(item.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    category === item.id
                      ? 'border-gold bg-gold/15 text-gold'
                      : 'border-bone/15 text-bone/55 hover:border-gold/35 hover:text-bone'
                  }`}
                >
                  {item.label} <span className="font-mono opacity-60">{categoryCounts[item.id]}</span>
                </button>
              ))}
              <span className="ml-auto text-[0.65rem] text-bone/35">
                {totalResults} resultado{totalResults === 1 ? '' : 's'} · las categorías afectan al elenco
              </span>
            </div>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-display text-lg tracking-wide text-gold">PNJ, enemigos y jefes</h3>
                <p className="text-xs text-bone/45">
                  {characters.length} ficha{characters.length === 1 ? '' : 's'} con los filtros actuales
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => createDmCharacter('pnj')}
                  disabled={busy}
                  className="rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
                >
                  + PNJ
                </button>
                <button
                  type="button"
                  onClick={() => createDmCharacter('enemigo')}
                  disabled={busy}
                  className="rounded-sm border border-blood/50 px-3 py-1.5 font-display text-sm tracking-wide text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  + Enemigo
                </button>
                <button
                  type="button"
                  onClick={() => createDmCharacter('jefe')}
                  disabled={busy}
                  className="rounded-sm border border-ochre/50 px-3 py-1.5 font-display text-sm tracking-wide text-ochre hover:bg-ochre/10 disabled:opacity-40"
                >
                  + Jefe
                </button>
              </div>
            </div>

            {characters.length === 0 ? (
              <div className="rounded-md border border-dashed border-bone/15 p-5 text-center">
                <p className="text-sm italic text-bone/45">
                  {query.trim()
                    ? 'No hay fichas que coincidan con la búsqueda y la categoría elegida.'
                    : onlyCampaign
                      ? 'Todavía no hay fichas de esta categoría en la campaña.'
                      : 'Todavía no tienes fichas de esta categoría.'}
                </p>
                {onlyCampaign && (
                  <button type="button" onClick={() => setOnlyCampaign(false)} className="mt-2 text-xs text-gold underline underline-offset-2">
                    Ver todo mi elenco
                  </button>
                )}
              </div>
            ) : (
              <>
                <ul className="grid gap-2 xl:grid-cols-2">
                  {visibleCharacters.map((character) => {
                    const characterCategory = repartoCategory(character);
                    return (
                      <li key={character.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-gold/15 bg-night-900 p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/25 bg-night-950 font-display text-gold/60">
                          {character.avatarUrl ? (
                            <img src={character.avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            character.name?.trim()?.[0]?.toUpperCase() ?? '?'
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="min-w-0 flex-1 truncate font-display text-bone">{character.name}</p>
                            <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider ${CATEGORY_STYLES[characterCategory]}`}>
                              {CATEGORY_LABELS[characterCategory]}
                            </span>
                          </div>
                          <p className="font-mono text-xs text-bone/45">PG {character.hpMax} · CA {character.ac}</p>
                          {character.otherCampaign && !character.assigned && (
                            <p className="text-[0.65rem] text-ochre/75">Actualmente está en otra campaña</p>
                          )}
                        </div>
                        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                          <Link
                            to={`/personajes/${character.id}${returnSearch}`}
                            className="rounded-sm border border-gold/25 px-2 py-1 text-xs text-gold/80 hover:bg-gold/10"
                          >
                            Editar ficha
                          </Link>
                          <button
                            type="button"
                            onClick={() => toggleCharacter(character)}
                            disabled={busy}
                            className={`rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
                              character.assigned
                                ? 'border-sage/60 text-sage hover:bg-sage/10'
                                : 'border-bone/25 text-bone/70 hover:border-gold hover:text-gold'
                            }`}
                          >
                            {character.assigned ? 'En campaña ✓' : 'Añadir'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {remainingCharacters > 0 && (
                  <button
                    type="button"
                    onClick={() => setLimits((current) => ({ ...current, characters: current.characters + PAGE_SIZE }))}
                    className="mt-2 w-full rounded-sm border border-gold/15 px-3 py-2 text-xs text-gold/75 hover:bg-gold/5 hover:text-gold"
                  >
                    Mostrar más fichas ({remainingCharacters})
                  </button>
                )}
              </>
            )}
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-display text-lg tracking-wide text-gold">Equipo del elenco</h3>
                <p className="text-xs text-bone/45">Objetos y hechizos propios vinculados a esta campaña.</p>
              </div>
              <Link to="/biblioteca" className="rounded-sm border border-gold/25 px-3 py-1.5 text-sm text-gold/80 hover:bg-gold/10">
                Editar biblioteca ↗
              </Link>
            </div>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              <LibrarySection
                tipo="objetos"
                title="Objetos"
                entries={objects}
                sourceCount={data.library.objetos.length}
                limit={limits.objetos}
                query={query}
                onlyCampaign={onlyCampaign}
                busy={busy}
                onToggle={toggleLibrary}
                onShowMore={() => setLimits((current) => ({ ...current, objetos: current.objetos + PAGE_SIZE }))}
                onShowAll={() => setOnlyCampaign(false)}
              />
              <LibrarySection
                tipo="hechizos"
                title="Hechizos"
                entries={spells}
                sourceCount={data.library.hechizos.length}
                limit={limits.hechizos}
                query={query}
                onlyCampaign={onlyCampaign}
                busy={busy}
                onToggle={toggleLibrary}
                onShowMore={() => setLimits((current) => ({ ...current, hechizos: current.hechizos + PAGE_SIZE }))}
                onShowAll={() => setOnlyCampaign(false)}
              />
            </div>
          </section>
        </div>
      )}
    </StepShell>
  );
}
