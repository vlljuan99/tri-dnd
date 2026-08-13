import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../../api.js';
import CampaignCard from './CampaignCard.jsx';

// Escaramuzas ya creadas. Desde aquí también se guarda cualquiera de ellas
// como escenario propio: se fotografía su tablero activo entero y queda en
// «Escenarios» para volver a montarla cuando quieras.
export default function EscaramuzasSection() {
  const { groups, loading, requestDeletion, requestLeaving, setError } = useOutletContext();
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  async function saveAsTemplate(campaign) {
    setSavingId(campaign.id);
    setSavedId(null);
    setError('');
    try {
      await api(`/campaigns/${campaign.id}/guardar-plantilla`, { method: 'POST', body: { name: campaign.name } });
      setSavedId(campaign.id);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <p className="text-ink/60">Cargando…</p>;

  if (groups.escaramuzas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ink/25 bg-parchment-100/40 p-8 text-center">
        <p className="font-display text-lg text-ink">Ninguna escaramuza abierta</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ink/60">
          Una escaramuza es un solo tablero y a jugar: sin asistente, sin archivo y sin mapa de mundo.
          Puedes empezar de cero o montar uno de los escenarios ya preparados.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            to="/campanas/escenarios"
            className="rounded-sm bg-ochre px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90"
          >
            Ver escenarios listos
          </Link>
          <Link
            to="/campanas/crear"
            className="rounded-sm border border-ink/30 px-4 py-2 font-display text-sm text-ink hover:bg-ink/5"
          >
            Empezar en blanco
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink/45">Partidas de un solo tablero</span>
        <Link to="/campanas/escenarios" className="text-xs text-ochre hover:underline">
          Montar una desde un escenario →
        </Link>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {groups.escaramuzas.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            compact
            onDelete={requestDeletion}
            onLeave={requestLeaving}
            extra={!campaign.soloMode ? (
              <button
                type="button"
                disabled={savingId === campaign.id}
                onClick={() => saveAsTemplate(campaign)}
                title="Guarda el tablero de esta escaramuza como escenario reutilizable"
                className="rounded-sm border border-sage/50 px-3 py-1.5 font-display text-sm text-sage hover:bg-sage/10 disabled:opacity-40"
              >
                {savingId === campaign.id
                  ? 'Guardando…'
                  : savedId === campaign.id
                    ? 'Guardado ✓'
                    : 'Guardar como escenario'}
              </button>
            ) : null}
          />
        ))}
      </ul>
    </section>
  );
}
