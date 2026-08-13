import { Link } from 'react-router-dom';
import { campaignTypeOf, isDraft } from '../sections.js';

// Tarjeta de una mesa en el Hub. Es la misma para campañas y escaramuzas: lo
// que cambia es la puerta principal (el Taller para el DM, la mesa para el
// jugador) y el detalle que se muestra debajo.
export default function CampaignCard({ campaign, compact = false, onDelete, onLeave, extra = null }) {
  const isDm = campaign.role === 'dm';
  const isCampaign = campaignTypeOf(campaign) === 'campana';
  const draft = isDraft(campaign);

  // Una sola puerta para el DM: el Taller. Dentro está todo (identidad,
  // lore, mundo, reparto, mapas, eventos y jugadores).
  const primaryHref = isDm ? `/campanas/${campaign.id}/taller` : `/campanas/${campaign.id}`;
  const primaryLabel = isDm
    ? draft
      ? 'Continuar preparación'
      : 'Abrir el taller'
    : 'Ir a la mesa de juego';

  return (
    <li
      className={`rounded-md border bg-parchment-100/70 shadow-sm ${
        compact ? 'border-ink/15 p-3' : 'border-ochre/30 p-4'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-display font-semibold text-ink ${compact ? 'text-base' : 'text-xl'}`}>
          {campaign.name}
        </span>
        {draft ? (
          <span className="shrink-0 rounded-sm border border-ochre/50 bg-ochre/10 px-1.5 py-0.5 font-mono text-xs text-ochre">
            Borrador
          </span>
        ) : (
          campaign.isLive && (
            <span className="flex items-center gap-1 text-xs font-medium text-ember">
              <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> en vivo
            </span>
          )
        )}
      </div>

      <p className="mt-1 text-sm text-ink/70">
        {isDm ? 'Eres el DM' : 'Jugador'} · {isCampaign ? 'Campaña' : 'Escaramuza'}
        {campaign.maxPlayers ? ` · ${campaign.maxPlayers} plazas` : ''}
        {isDm && (
          <>
            {' · invitación: '}
            <span className="font-mono tracking-widest">{campaign.inviteCode}</span>
          </>
        )}
      </p>

      {!compact && isDm && !draft && (
        <p className="mt-2 text-xs leading-relaxed text-ink/55">
          Tu taller reúne en un solo sitio el lore, el mundo, el reparto, los mapas y los eventos de la campaña.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Link
            to={primaryHref}
            className={`inline-block rounded-sm px-3 py-1.5 font-display text-sm tracking-wide ${
              isCampaign && isDm
                ? 'bg-ember text-parchment-100 hover:bg-ember/90'
                : 'bg-ochre text-parchment-100 hover:bg-ochre/90'
            }`}
          >
            {primaryLabel}
          </Link>
          {isDm && !draft && (
            <Link
              to={`/campanas/${campaign.id}`}
              className="rounded-sm border border-ochre/50 px-3 py-1.5 font-display text-sm text-ochre hover:bg-ochre/10"
            >
              Ir a la mesa
            </Link>
          )}
          {!isDm && isCampaign && !draft && (
            <Link
              to={`/campanas/${campaign.id}/archivo`}
              className="rounded-sm border border-ochre/40 px-3 py-1.5 font-display text-sm text-ochre hover:bg-ochre/10"
            >
              Artículos de campaña
            </Link>
          )}
          {extra}
        </div>
        {isDm ? (
          <button
            type="button"
            onClick={() => onDelete(campaign)}
            className="rounded-sm border border-ember/40 px-2 py-1.5 text-xs text-ember hover:bg-ember/10"
          >
            Borrar
          </button>
        ) : (
          // Salir por decisión propia, sin tener que pedirle al DM que te
          // expulse: la limpieza en el servidor es exactamente la misma.
          <button
            type="button"
            onClick={() => onLeave(campaign)}
            className="rounded-sm border border-ink/25 px-2 py-1.5 text-xs text-ink/60 hover:border-ember/40 hover:text-ember"
          >
            Abandonar
          </button>
        )}
      </div>
    </li>
  );
}
