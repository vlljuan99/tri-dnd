import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import CampaignCard from './CampaignCard.jsx';
import { isDraft } from '../sections.js';

// Campañas largas donde eres el DM. Los borradores NO viven en una sección
// aparte: se quedan aquí con su distintivo y un filtro, para que una campaña
// no cambie de sitio justo cuando terminas de prepararla.
const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: 'listas', label: 'Listas' },
  { id: 'borradores', label: 'En borrador' },
];

export default function CampanasSection() {
  const { groups, loading, requestDeletion, requestLeaving } = useOutletContext();
  const [filter, setFilter] = useState('todas');

  const all = groups.campanas;
  const drafts = all.filter(isDraft).length;
  const visible =
    filter === 'borradores' ? all.filter(isDraft) : filter === 'listas' ? all.filter((c) => !isDraft(c)) : all;

  if (loading) return <p className="text-ink/60">Cargando…</p>;

  if (all.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ochre/40 bg-parchment-100/40 p-8 text-center">
        <p className="font-display text-lg text-ink">Todavía no diriges ninguna campaña</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ink/60">
          Una campaña trae taller de preparación, archivo narrativo, mapa de mundo y sesiones. Si solo
          quieres un combate esta tarde, empieza por una escaramuza.
        </p>
        <Link
          to="/campanas/crear"
          className="mt-4 inline-block rounded-sm bg-ember px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ember/90"
        >
          Crear una campaña
        </Link>
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              aria-pressed={filter === entry.id}
              className={`rounded-sm border px-2.5 py-1 text-xs ${
                filter === entry.id
                  ? 'border-ochre bg-ochre/10 text-ink'
                  : 'border-ink/15 text-ink/55 hover:border-ochre/50'
              }`}
            >
              {entry.label}
              {entry.id === 'borradores' && drafts > 0 && (
                <span className="ml-1 font-mono text-[0.65rem] text-ochre">{drafts}</span>
              )}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink/45">Tu trabajo de preparación y tus mesas</span>
      </div>

      {visible.length === 0 ? (
        <p className="italic text-ink/55">No hay campañas en ese estado.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onDelete={requestDeletion}
              onLeave={requestLeaving}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
