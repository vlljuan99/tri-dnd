import { Link, useOutletContext } from 'react-router-dom';
import CampaignCard from './CampaignCard.jsx';

// Mesas en las que eres jugador y no DM. Van aparte porque lo que se hace en
// ellas es distinto: aquí no hay taller ni preparación, solo entrar a jugar.
export default function DondeJuegoSection() {
  const { groups, loading, requestDeletion, requestLeaving } = useOutletContext();

  if (loading) return <p className="text-ink/60">Cargando…</p>;

  if (groups.ajenas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-sage/40 bg-parchment-100/40 p-8 text-center">
        <p className="font-display text-lg text-ink">No juegas en ninguna mesa ajena</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ink/60">
          Cuando otro DM te pase su código de invitación, la mesa aparecerá aquí con tu personaje.
        </p>
        <Link
          to="/campanas/crear"
          className="mt-4 inline-block rounded-sm bg-sage px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-sage/90"
        >
          Unirse con un código
        </Link>
      </div>
    );
  }

  return (
    <section>
      <p className="mb-3 text-xs text-ink/45">Mesas en las que eres jugador</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {groups.ajenas.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            onDelete={requestDeletion}
            onLeave={requestLeaving}
          />
        ))}
      </ul>
    </section>
  );
}
