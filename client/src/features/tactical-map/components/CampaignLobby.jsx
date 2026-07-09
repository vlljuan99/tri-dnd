import { Link } from 'react-router-dom';

/**
 * Pantalla de espera del jugador (Fase 8.8): lore y objetivos de la
 * campaña mientras el DM no ha abierto la sesión. Sin acciones — solo
 * espera a que el DM la ponga en vivo, momento en que esta pantalla
 * desaparece sola (isLive llega por socket).
 */
export default function CampaignLobby({ campaign, playerCount }) {
  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-night-950 px-4 py-10 text-bone">
      <div className="w-full max-w-xl">
        <Link to="/" className="text-sm text-gold/80 underline hover:text-gold">
          ← Hub
        </Link>
        <h1 className="mt-3 font-display text-3xl tracking-wide text-gold">{campaign?.name}</h1>
        <p className="mt-1 text-sm text-bone/60">
          {playerCount} jugador{playerCount === 1 ? '' : 'es'} unido{playerCount === 1 ? '' : 's'}
          {campaign?.maxPlayers ? ` de ${campaign.maxPlayers} plazas` : ''} · esperando a que el DM empiece la
          partida…
        </p>

        {campaign?.lore && (
          <div className="mt-6 rounded-sm border border-gold/20 bg-night-900/60 p-4">
            <p className="mb-2 font-display text-xs uppercase tracking-widest text-gold/70">Lore</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone/85">{campaign.lore}</p>
          </div>
        )}

        {campaign?.objectives?.length > 0 && (
          <div className="mt-4 rounded-sm border border-gold/20 bg-night-900/60 p-4">
            <p className="mb-2 font-display text-xs uppercase tracking-widest text-gold/70">Objetivos</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-bone/85">
              {campaign.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}

        {!campaign?.lore && !campaign?.objectives?.length && (
          <p className="mt-6 text-sm italic text-bone/50">El DM aún no ha añadido lore ni objetivos.</p>
        )}
      </div>
    </div>
  );
}
