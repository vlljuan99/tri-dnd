import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';

function campaignTypeOf(campaign) {
  return campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza');
}

function CampaignCard({ campaign, compact = false, onDelete, onLeave }) {
  const isDm = campaign.role === 'dm';
  const isCampaign = campaignTypeOf(campaign) === 'campana';
  const isDraft = campaign.status === 'draft';

  // Una sola puerta para el DM: el Taller. Dentro está todo (identidad,
  // lore, mundo, reparto, mapas, eventos y jugadores).
  const primaryHref = isDm ? `/campanas/${campaign.id}/taller` : `/campanas/${campaign.id}`;
  const primaryLabel = isDm
    ? isDraft
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
        {isDraft ? (
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
        {isDm && (
          <>
            {' · invitación: '}
            <span className="font-mono tracking-widest">{campaign.inviteCode}</span>
          </>
        )}
      </p>

      {!compact && isDm && !isDraft && (
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
          {isDm && !isDraft && (
            <Link
              to={`/campanas/${campaign.id}`}
              className="rounded-sm border border-ochre/50 px-3 py-1.5 font-display text-sm text-ochre hover:bg-ochre/10"
            >
              Ir a la mesa
            </Link>
          )}
          {!isDm && isCampaign && !isDraft && (
            <Link
              to={`/campanas/${campaign.id}/archivo`}
              className="rounded-sm border border-ochre/40 px-3 py-1.5 font-display text-sm text-ochre hover:bg-ochre/10"
            >
              Artículos de campaña
            </Link>
          )}
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

export default function HubPage() {
  const [campaigns, setCampaigns] = useState(null);
  const [creating, setCreating] = useState(false);
  const [skirmishName, setSkirmishName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [campaignToLeave, setCampaignToLeave] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api('/campaigns').then(({ campaigns: rows }) => setCampaigns(rows)).catch((e) => setError(e.message));
  }, []);

  async function createCampaign(campaignType, name = '') {
    setCreating(true);
    setError('');
    try {
      const body = { campaignType };
      if (name.trim()) body.name = name.trim();
      const { campaign } = await api('/campaigns', { method: 'POST', body });
      // La escaramuza va directa al tablero; la campaña aterriza en su taller.
      navigate(
        campaignType === 'escaramuza'
          ? `/campanas/${campaign.id}/editor`
          : `/campanas/${campaign.id}/taller`
      );
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  async function deleteCampaign(campaign) {
    setDeleting(true);
    setError('');
    try {
      await api(`/campaigns/${campaign.id}`, { method: 'DELETE' });
      setCampaigns((rows) => rows.filter((c) => c.id !== campaign.id));
      setCampaignToDelete(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  function requestCampaignDeletion(campaign) {
    setError('');
    setCampaignToDelete(campaign);
  }

  async function leaveCampaign(campaign) {
    setLeaving(true);
    setError('');
    try {
      await api(`/campaigns/${campaign.id}/abandonar`, { method: 'DELETE' });
      setCampaigns((rows) => rows.filter((c) => c.id !== campaign.id));
      setCampaignToLeave(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLeaving(false);
    }
  }

  function requestLeaving(campaign) {
    setError('');
    setCampaignToLeave(campaign);
  }

  async function joinCampaign(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setError('');
    try {
      const { campaign } = await api('/campaigns/join', { method: 'POST', body: { code: joinCode } });
      setCampaigns((rows) =>
        rows?.some((c) => c.id === campaign.id) ? rows : [campaign, ...(rows ?? [])]
      );
      setJoinCode('');
    } catch (err) {
      setError(err.message);
    }
  }

  const adventures = (campaigns ?? []).filter((campaign) => campaignTypeOf(campaign) === 'campana');
  const skirmishes = (campaigns ?? []).filter((campaign) => campaignTypeOf(campaign) === 'escaramuza');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h2 className="font-display text-3xl font-semibold text-ink">Tus campañas</h2>
      <p className="mt-1 text-sm text-ink/60">Prepara el mundo del DM o abre una partida rápida.</p>

      <section className="mt-6 overflow-hidden rounded-lg border border-ochre/40 bg-parchment-100/75 shadow-md">
        <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-ochre">El taller del DM</p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-ink">Crear una campaña</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">
              Un taller con todos tus materiales en orden: identidad, lore, mundo, reparto, mapas y
              eventos, paso a paso y retomable cuando quieras, antes de abrir la mesa a los jugadores.
            </p>
          </div>
          <button
            type="button"
            onClick={() => createCampaign('campana')}
            disabled={creating}
            className="rounded-sm bg-ember px-5 py-3 font-display text-lg tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
          >
            + Nueva campaña
          </button>
        </div>
        <div className="grid border-t border-ochre/20 bg-ochre/5 text-xs text-ink/60 sm:grid-cols-3">
          <span className="px-5 py-2.5">Archivo narrativo estructurado</span>
          <span className="border-y border-ochre/15 px-5 py-2.5 sm:border-x sm:border-y-0">Mundo, reparto y sesiones</span>
          <span className="px-5 py-2.5">Imágenes, vídeo, música y enlaces</span>
        </div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createCampaign('escaramuza', skirmishName);
          }}
          className="rounded-md border border-ink/15 bg-parchment-100/45 p-4"
        >
          <h3 className="font-display text-lg text-ink">Escaramuza rápida</h3>
          <p className="mt-1 text-sm text-ink/60">Un tablero y a jugar. Sin asistente, archivo ni mapa de mundo.</p>
          <label htmlFor="skirmish-name" className="mt-3 block text-xs uppercase tracking-wider text-ink/50">
            Nombre de la partida
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="skirmish-name"
              value={skirmishName}
              onChange={(event) => setSkirmishName(event.target.value)}
              placeholder="Emboscada en el puerto"
              maxLength={80}
              required
              className="min-w-0 flex-1 rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-ochre focus:outline-none"
            />
            <button
              type="submit"
              disabled={creating || !skirmishName.trim()}
              className="shrink-0 rounded-sm border border-ink/30 px-4 py-2 font-display text-sm tracking-wide text-ink hover:bg-ink/5 disabled:opacity-40"
            >
              Crear y editar →
            </button>
          </div>
        </form>

        <form onSubmit={joinCampaign} className="rounded-md border border-ink/15 bg-parchment-100/45 p-4">
          <h3 className="font-display text-lg text-ink">Unirse a una mesa</h3>
          <p className="mt-1 text-sm text-ink/60">Introduce el código de invitación que te haya dado el DM.</p>
          <div className="mt-3 flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Código de invitación"
              maxLength={6}
              required
              className="min-w-0 flex-1 rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 font-mono uppercase tracking-widest text-ink placeholder:font-body placeholder:normal-case placeholder:tracking-normal placeholder:text-ink/40 focus:border-ochre focus:outline-none"
            />
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className="rounded-sm bg-sage px-4 font-display tracking-wide text-parchment-100 hover:bg-sage/90 disabled:opacity-40 disabled:hover:bg-sage"
            >
              Unirse
            </button>
          </div>
        </form>
      </div>

      {error && <p className="mt-4 text-sm text-ember">{error}</p>}
      {campaigns === null ? (
        <p className="mt-8 text-ink/60">Cargando…</p>
      ) : campaigns.length === 0 ? (
        <p className="mt-8 italic text-ink/60">
          Todavía no hay campañas. Crea tu archivo como DM o únete con un código de invitación.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {adventures.length > 0 && (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3 border-b border-ochre/25 pb-2">
                <h3 className="font-display text-2xl text-ink">Campañas</h3>
                <span className="text-xs text-ink/45">Tu trabajo de preparación y tus mesas</span>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {adventures.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    onDelete={requestCampaignDeletion}
                    onLeave={requestLeaving}
                  />
                ))}
              </ul>
            </section>
          )}

          {skirmishes.length > 0 && (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3 border-b border-ink/15 pb-2">
                <h3 className="font-display text-xl text-ink/80">Escaramuzas rápidas</h3>
                <span className="text-xs text-ink/45">Partidas de un solo tablero</span>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {skirmishes.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    compact
                    onDelete={requestCampaignDeletion}
                    onLeave={requestLeaving}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(campaignToDelete)}
        title={`Borrar «${campaignToDelete?.name ?? ''}»`}
        description={
          campaignToDelete
            ? `Vas a borrar esta ${campaignTypeOf(campaignToDelete) === 'campana' ? 'campaña' : 'escaramuza'} con su chat, mesa, mapas y contenido de preparación. Las fichas de personaje se conservarán.`
            : ''
        }
        detail={error || 'No existe papelera: esta acción no se puede deshacer.'}
        requiredText={campaignToDelete?.name}
        confirmLabel="Borrar definitivamente"
        busy={deleting}
        onCancel={() => setCampaignToDelete(null)}
        onConfirm={() => deleteCampaign(campaignToDelete)}
      />

      {/* Abandonar no pide escribir el nombre: se puede volver con el código
          de invitación, y la ficha no se pierde. No es irreversible. */}
      <ConfirmationDialog
        open={Boolean(campaignToLeave)}
        title={`Abandonar «${campaignToLeave?.name ?? ''}»`}
        description="Saldrás de la mesa y tu personaje se retirará del tablero y del tracker de iniciativa. Tu ficha se conserva en tu cuenta con todo su progreso."
        detail={error || 'Podrás volver a unirte si el DM te pasa el código de invitación.'}
        confirmLabel="Abandonar la mesa"
        tone="warning"
        busy={leaving}
        onCancel={() => setCampaignToLeave(null)}
        onConfirm={() => leaveCampaign(campaignToLeave)}
      />
    </div>
  );
}
