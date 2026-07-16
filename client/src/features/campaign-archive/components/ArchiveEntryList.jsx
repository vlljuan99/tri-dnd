export default function ArchiveEntryList({
  entries,
  selectedEntryId,
  selectedSection,
  searchQuery,
  searchLoading,
  busy,
  onCreate,
  onSelect,
  onMove,
}) {
  const ordered = [...entries].sort((a, b) => a.position - b.position || a.id - b.id);
  const isSearching = Boolean(searchQuery.trim());

  return (
    <section className="flex min-h-0 flex-col border-b border-gold/15 bg-night-950/35 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-2 border-b border-gold/15 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-sm uppercase tracking-[0.16em] text-gold">
            {isSearching ? 'Resultados' : selectedSection?.title ?? 'Sin sección'}
          </p>
          <p className="text-[0.65rem] text-bone/40">
            {isSearching ? `Coincidencias para «${searchQuery.trim()}»` : `${ordered.length} entrada${ordered.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {!isSearching && (
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="shrink-0 rounded-sm bg-gold px-2.5 py-1.5 font-display text-xs tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
          >
            + Entrada
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {searchLoading ? (
          <p className="p-4 text-center text-xs text-bone/45">Buscando…</p>
        ) : ordered.length === 0 ? (
          <div className="m-2 rounded-sm border border-dashed border-bone/15 p-4 text-center">
            <p className="text-sm italic text-bone/45">
              {isSearching ? 'No hay coincidencias.' : 'Esta sección todavía no tiene entradas.'}
            </p>
            {!isSearching && (
              <button type="button" onClick={onCreate} className="mt-2 text-xs text-gold underline underline-offset-2">
                Crear la primera
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {ordered.map((entry, index) => (
              <li key={entry.id} className="group flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className={`min-w-0 flex-1 rounded-sm border px-3 py-2 text-left transition-colors ${
                    selectedEntryId === entry.id
                      ? 'border-gold/45 bg-gold/10'
                      : 'border-bone/10 bg-night-900/60 hover:border-gold/25 hover:bg-night-900'
                  }`}
                >
                  <span className="block truncate font-display text-sm text-bone">{entry.title || 'Entrada sin título'}</span>
                  {entry.summary && <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-bone/50">{entry.summary}</span>}
                  <span className="mt-1 block text-[0.6rem] uppercase tracking-widest text-bone/30">
                    {(entry.blocks ?? []).length} bloque{(entry.blocks ?? []).length === 1 ? '' : 's'}
                    {isSearching && entry.kind === 'seccion' ? ' · sección' : ''}
                  </span>
                </button>
                {!isSearching && (
                  <div className="flex w-6 shrink-0 flex-col justify-center opacity-55 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onMove(entry.id, 'up')}
                      disabled={busy || index === 0}
                      title="Subir entrada"
                      aria-label={`Subir ${entry.title}`}
                      className="flex-1 rounded-t-sm border border-bone/10 text-xs text-bone/50 hover:border-gold hover:text-gold disabled:opacity-20"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(entry.id, 'down')}
                      disabled={busy || index === ordered.length - 1}
                      title="Bajar entrada"
                      aria-label={`Bajar ${entry.title}`}
                      className="flex-1 rounded-b-sm border border-t-0 border-bone/10 text-xs text-bone/50 hover:border-gold hover:text-gold disabled:opacity-20"
                    >
                      ↓
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

