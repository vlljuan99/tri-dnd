import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CompendiumDetail, {
  COMPENDIUM_CATEGORY_GROUPS,
  COMPENDIUM_CATEGORIES,
  COMPENDIUM_LABELS,
  CompendiumMeta,
  readableCompendiumIndex,
} from '../components/CompendiumDetail.jsx';
import { useRoom } from '../store/socket.js';

const ALL_CATEGORIES = COMPENDIUM_CATEGORIES.map(([key]) => key);
const PAGE_SIZE = 60;
const EMPTY_FILTERS = Object.freeze({
  nivelMin: '',
  nivelMax: '',
  escuela: '',
  clase: '',
  vdMin: '',
  vdMax: '',
  tipoMonstruo: '',
  rareza: '',
});

const MONSTER_TYPE_LABELS = {
  aberration: 'Aberración', beast: 'Bestia', celestial: 'Celestial', construct: 'Constructo',
  dragon: 'Dragón', elemental: 'Elemental', fey: 'Feérico', fiend: 'Infernal', giant: 'Gigante',
  humanoid: 'Humanoide', monstrosity: 'Monstruosidad', ooze: 'Cieno', plant: 'Planta', undead: 'No muerto',
};
const RARITY_LABELS = {
  Common: 'Común', Uncommon: 'Poco común', Rare: 'Raro', 'Very Rare': 'Muy raro',
  Legendary: 'Legendario', Artifact: 'Artefacto', Varies: 'Variable',
};

function searchParams(q, categories, offset, filters) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (q.trim()) params.set('q', q.trim());
  if (categories.length !== ALL_CATEGORIES.length) params.set('categorias', categories.join(','));
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '') params.set(key, String(value));
  }
  return params;
}

function formatLastSync(value) {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="grid gap-1 text-xs text-ink/55">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-sm border border-ink/20 bg-parchment-50 px-2 py-1.5 text-sm text-ink outline-none focus:border-ember"
      >
        {children}
      </select>
    </label>
  );
}

export default function CompendiumPage() {
  const shareCompendiumReference = useRoom((state) => state.shareCompendiumReference);
  const [q, setQ] = useState('');
  const [categories, setCategories] = useState(ALL_CATEGORIES);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState({ total: null, counts: {}, facets: {}, lastSync: null, syncError: null });
  const [liveCampaigns, setLiveCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState(null);
  const [openingIndex, setOpeningIndex] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const [error, setError] = useState('');
  const searchVersion = useRef(0);

  function storeLiveCampaigns(campaigns) {
    const active = (campaigns ?? []).filter((campaign) => campaign.isLive);
    setLiveCampaigns(active);
    setSelectedCampaignId((current) => active.some((campaign) => String(campaign.id) === current)
      ? current
      : String(active[0]?.id ?? ''));
  }

  async function refreshLiveCampaigns() {
    try {
      const response = await api('/campaigns');
      storeLiveCampaigns(response.campaigns);
    } catch {
      // El detalle sigue siendo útil aunque no se pueda refrescar este dato.
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api('/srd/status'), api('/campaigns')]).then(([srdResult, campaignsResult]) => {
      if (cancelled) return;
      if (srdResult.status === 'fulfilled') setStatus(srdResult.value);
      if (campaignsResult.status === 'fulfilled') {
        storeLiveCampaigns(campaignsResult.value.campaigns);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const version = ++searchVersion.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api(`/srd/buscar?${searchParams(q, categories, 0, filters)}`);
        if (version !== searchVersion.current) return;
        setResults(response.results ?? []);
        setTotal(response.total ?? response.results?.length ?? 0);
      } catch (err) {
        if (version !== searchVersion.current) return;
        setResults([]);
        setTotal(0);
        setError(err.message || 'No se pudo consultar el compendio.');
      } finally {
        if (version === searchVersion.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q, categories, filters]);

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleCategory(category) {
    setCategories((current) => current.includes(category)
      ? (current.length === 1 ? current : current.filter((item) => item !== category))
      : [...current, category]);
  }

  async function loadMore() {
    const version = searchVersion.current;
    setLoadingMore(true);
    setError('');
    try {
      const response = await api(`/srd/buscar?${searchParams(q, categories, results.length, filters)}`);
      if (version !== searchVersion.current) return;
      setResults((current) => [...current, ...(response.results ?? [])]);
      setTotal(response.total ?? total);
    } catch (err) {
      if (version === searchVersion.current) setError(err.message || 'No se pudieron cargar más entradas.');
    } finally {
      if (version === searchVersion.current) setLoadingMore(false);
    }
  }

  async function openDetail(entry) {
    const key = `${entry.category}:${entry.index}`;
    setOpeningIndex(key);
    setError('');
    setShareNotice('');
    refreshLiveCampaigns();
    try {
      setDetail(await api(`/srd/${entry.category}/${encodeURIComponent(entry.index)}`));
    } catch (err) {
      setError(err.message || 'No se pudo abrir la entrada.');
    } finally {
      setOpeningIndex(null);
    }
  }

  async function shareDetail() {
    if (!detail || !selectedCampaignId || detail.custom) return;
    setSharing(true);
    setShareNotice('');
    const response = await shareCompendiumReference(Number(selectedCampaignId), detail);
    setSharing(false);
    if (response?.error) {
      setShareNotice(response.error);
      refreshLiveCampaigns();
      return;
    }
    const campaign = liveCampaigns.find((item) => item.id === Number(selectedCampaignId));
    setShareNotice(`Compartido en ${campaign?.name ?? 'la mesa'}.`);
  }

  const syncedAt = formatLastSync(status.lastSync);
  const facetCount = Object.values(filters).filter((value) => value !== '').length;
  const facets = status.facets ?? {};
  const levelOptions = Array.from({ length: 10 }, (_, level) => level);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold">Compendio</h2>
          <p className="mt-1 max-w-2xl text-ink/65">
            Busca en toda la prosa del SRD y acota por magia, criaturas u objetos.
          </p>
        </div>
        {status.total != null && (
          <p className="text-right text-sm text-ink/55">
            <strong className="font-display text-lg text-ink/80">{status.total.toLocaleString('es-ES')}</strong> entradas SRD
            {syncedAt && <span className="block text-xs">Actualizado: {syncedAt}</span>}
          </p>
        )}
      </div>

      {status.syncError && (
        <p className="mt-4 rounded-sm border border-ochre/35 bg-ochre/10 px-3 py-2 text-sm text-ink/70">
          La última sincronización quedó incompleta: {status.syncError}.
        </p>
      )}

      <label className="mt-6 block">
        <span className="sr-only">Buscar en el compendio</span>
        <input
          autoFocus
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar nombres, acciones, rasgos, efectos o reglas…"
          className="w-full rounded-sm border border-ink/25 bg-parchment-50 px-4 py-3 text-lg outline-none focus:border-ember"
        />
      </label>

      <section className="mt-4 rounded-sm border border-ink/10 bg-parchment-50/50 p-4" aria-label="Filtros del compendio">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink/65">Categorías ({categories.length} de {ALL_CATEGORIES.length})</p>
          <button
            onClick={() => setCategories(ALL_CATEGORIES)}
            disabled={categories.length === ALL_CATEGORIES.length}
            className="text-sm text-ember underline-offset-2 hover:underline disabled:cursor-default disabled:text-ink/35 disabled:no-underline"
          >
            Seleccionar todas
          </button>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          {COMPENDIUM_CATEGORY_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/45">{group.label}</h3>
                <button onClick={() => setCategories(group.categories.map(([key]) => key))} className="text-xs text-ember/80 hover:underline">
                  Solo este grupo
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {group.categories.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => toggleCategory(key)}
                    aria-pressed={categories.includes(key)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${categories.includes(key) ? 'border-ember bg-ember/10 text-ember' : 'border-ink/15 text-ink/45 hover:border-ink/30'}`}
                  >
                    {label}{status.counts?.[key] != null ? ` · ${status.counts[key]}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 pt-4">
          <p className="text-sm font-semibold text-ink/65">Facetas de preparación{facetCount ? ` · ${facetCount} activas` : ''}</p>
          <button
            onClick={() => setFilters({ ...EMPTY_FILTERS })}
            disabled={!facetCount}
            className="text-xs text-ember hover:underline disabled:text-ink/30 disabled:no-underline"
          >
            Limpiar facetas
          </button>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <fieldset className="grid grid-cols-2 gap-2 rounded-sm border border-ink/10 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink/45">Hechizos</legend>
            <FilterSelect label="Nivel mínimo" value={filters.nivelMin} onChange={(value) => setFilter('nivelMin', value)}>
              <option value="">Cualquiera</option>
              {levelOptions.map((level) => <option key={level} value={level}>{level === 0 ? 'Truco' : level}</option>)}
            </FilterSelect>
            <FilterSelect label="Nivel máximo" value={filters.nivelMax} onChange={(value) => setFilter('nivelMax', value)}>
              <option value="">Cualquiera</option>
              {levelOptions.map((level) => <option key={level} value={level}>{level === 0 ? 'Truco' : level}</option>)}
            </FilterSelect>
            <FilterSelect label="Escuela" value={filters.escuela} onChange={(value) => setFilter('escuela', value)}>
              <option value="">Todas</option>
              {(facets.spellSchools ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Clase" value={filters.clase} onChange={(value) => setFilter('clase', value)}>
              <option value="">Todas</option>
              {(facets.spellClasses ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-2 rounded-sm border border-ink/10 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink/45">Monstruos</legend>
            <label className="grid gap-1 text-xs text-ink/55">
              <span>VD mínimo</span>
              <input type="number" min="0" max="30" step="0.125" value={filters.vdMin} onChange={(event) => setFilter('vdMin', event.target.value)} className="rounded-sm border border-ink/20 bg-parchment-50 px-2 py-1.5 text-sm text-ink outline-none focus:border-ember" />
            </label>
            <label className="grid gap-1 text-xs text-ink/55">
              <span>VD máximo</span>
              <input type="number" min="0" max="30" step="0.125" value={filters.vdMax} onChange={(event) => setFilter('vdMax', event.target.value)} className="rounded-sm border border-ink/20 bg-parchment-50 px-2 py-1.5 text-sm text-ink outline-none focus:border-ember" />
            </label>
            <div className="col-span-2">
              <FilterSelect label="Tipo" value={filters.tipoMonstruo} onChange={(value) => setFilter('tipoMonstruo', value)}>
                <option value="">Todos</option>
                {(facets.monsterTypes ?? []).map((option) => <option key={option.value} value={option.value}>{MONSTER_TYPE_LABELS[option.value] ?? readableCompendiumIndex(option.label)}</option>)}
              </FilterSelect>
            </div>
          </fieldset>

          <fieldset className="rounded-sm border border-ink/10 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink/45">Objetos mágicos</legend>
            <FilterSelect label="Rareza" value={filters.rareza} onChange={(value) => setFilter('rareza', value)}>
              <option value="">Todas</option>
              {(facets.magicItemRarities ?? []).map((option) => <option key={option.value} value={option.value}>{RARITY_LABELS[option.value] ?? option.label}</option>)}
            </FilterSelect>
          </fieldset>
        </div>
      </section>

      {error && <p className="mt-4 text-blood">{error}</p>}

      {loading ? (
        <p className="py-12 text-center text-ink/45">Buscando…</p>
      ) : results.length > 0 ? (
        <>
          <div className="mt-6 flex items-baseline justify-between gap-3">
            <p className="text-sm text-ink/55">Mostrando {results.length.toLocaleString('es-ES')} de {total.toLocaleString('es-ES')} resultados</p>
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((entry) => {
              const key = `${entry.category}:${entry.index}`;
              return (
                <li key={key}>
                  <button
                    onClick={() => openDetail(entry)}
                    disabled={openingIndex === key}
                    className="h-full w-full rounded-sm border border-ink/15 bg-parchment-50 p-4 text-left transition hover:border-ember/50 hover:shadow-sm disabled:opacity-60"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-display text-lg font-semibold leading-tight">{entry.name}</span>
                      <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-ember">{COMPENDIUM_LABELS[entry.category]}</span>
                    </span>
                    <span className="mt-2 block text-sm text-ink/55">
                      <CompendiumMeta entry={entry} />{!entry.translated ? ' · EN' : ''}{entry.custom ? ' · Propio' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {results.length < total && (
            <div className="py-8 text-center">
              <button onClick={loadMore} disabled={loadingMore} className="rounded-sm border border-ember px-5 py-2 text-ember transition hover:bg-ember/10 disabled:opacity-50">
                {loadingMore ? 'Cargando…' : `Cargar más (${(total - results.length).toLocaleString('es-ES')} restantes)`}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-ink/50">
          {status.total === 0 ? (
            <>
              <p className="font-semibold text-ink/70">El compendio local aún está vacío.</p>
              <p className="mt-1">Ejecuta <code className="rounded bg-ink/5 px-1.5 py-0.5">npm run sync-srd</code> para descargar el SRD completo.</p>
            </>
          ) : <p>No hay resultados con esos filtros.</p>}
        </div>
      )}

      {detail && (
        <CompendiumDetail
          entry={detail}
          onClose={() => setDetail(null)}
          actions={(
            <div className="rounded-sm border border-ember/20 bg-ember/5 p-3">
              <div className="flex flex-wrap items-end gap-2">
                {liveCampaigns.length > 1 && (
                  <label className="grid min-w-48 flex-1 gap-1 text-xs text-ink/55">
                    <span>Mesa en vivo</span>
                    <select value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)} className="rounded-sm border border-ink/20 bg-parchment-50 px-2 py-2 text-sm">
                      {liveCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                    </select>
                  </label>
                )}
                <button
                  onClick={shareDetail}
                  disabled={sharing || !selectedCampaignId || detail.custom}
                  className="rounded-sm bg-ember px-3 py-2 text-sm font-semibold text-parchment-50 hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {sharing ? 'Compartiendo…' : 'Compartir en la mesa'}
                </button>
              </div>
              {liveCampaigns.length === 1 && <p className="mt-2 text-xs text-ink/50">Destino: {liveCampaigns[0].name}.</p>}
              {!selectedCampaignId && <p className="mt-2 text-xs text-ink/50">No tienes ninguna mesa en vivo ahora mismo.</p>}
              {detail.custom && <p className="mt-2 text-xs text-ink/50">La biblioteca privada del DM no se comparte como referencia pública.</p>}
              {shareNotice && <p className={`mt-2 text-xs ${shareNotice.startsWith('Compartido') ? 'text-moss' : 'text-blood'}`}>{shareNotice}</p>}
            </div>
          )}
        />
      )}
    </main>
  );
}
