import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import ArchiveWorkspace from '../components/ArchiveWorkspace.jsx';

// Crónicas de campaña: la vista de LECTURA del jugador sobre lo que el DM ha
// publicado. El DM ya no edita aquí: su archivo vive en el paso «Lore y
// trama» del taller, así que se le redirige.
export default function CampaignArchivePage() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/campaigns/${id}`)
      .then(({ campaign: loaded }) => setCampaign(loaded))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center bg-night-950 p-6 text-bone">
        <div className="text-center">
          <p className="font-display text-xl text-blood">{error}</p>
          <Link to="/" className="mt-3 inline-block text-gold underline">Volver a campañas</Link>
        </div>
      </div>
    );
  }
  if (!campaign) {
    return <div className="min-h-full bg-night-950 p-6 text-bone/55">Abriendo las Crónicas…</div>;
  }
  if (campaign.role === 'dm') {
    return <Navigate to={`/campanas/${id}/taller/lore`} replace />;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-night-950 text-bone">
      <header className="shrink-0 border-b border-gold/20 bg-night-900/95 px-4 py-3 shadow-lg shadow-black/20">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-display text-2xl tracking-wide text-gold">Crónicas de campaña</h1>
              <span className="truncate text-sm text-bone/55">{campaign.name}</span>
            </div>
            <p className="text-xs text-bone/40">
              Lore, lugares y relatos que el DM ha compartido con el grupo.
            </p>
          </div>
          <Link
            to={`/campanas/${id}`}
            className="shrink-0 rounded-sm border border-gold/30 px-2.5 py-1.5 text-xs text-gold hover:bg-gold/10"
          >
            Mesa
          </Link>
        </div>
      </header>

      <div className="mx-auto h-full min-h-0 w-full min-w-0 max-w-[1600px] flex-1 overflow-hidden lg:border-x lg:border-gold/10">
        <ArchiveWorkspace campaignId={id} canEdit={false} />
      </div>
    </div>
  );
}
