import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../../api.js';
import ConfirmationDialog from '../../../components/ConfirmationDialog.jsx';
import { HUB_SECTIONS, campaignTypeOf, splitCampaigns } from '../sections.js';

// Zona de campañas con sub-navegación. El listado se pide UNA vez aquí y baja
// por contexto a cada sección: cambiar de pestaña no vuelve a llamar a la API,
// y crear o borrar desde cualquiera de ellas actualiza el recuento de todas.
export default function HubLayout() {
  const [campaigns, setCampaigns] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [campaignToLeave, setCampaignToLeave] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api('/campaigns')
      .then(({ campaigns: rows }) => setCampaigns(rows))
      .catch((cause) => setError(cause.message));
  }, []);

  const groups = useMemo(() => splitCampaigns(campaigns), [campaigns]);

  // Crea una campaña o escaramuza y lleva a donde toque: la campaña aterriza
  // en su taller y la escaramuza va directa a su tablero (al editor si nace en
  // blanco, a la mesa si ya viene poblada por un escenario o una plantilla).
  const createCampaign = useCallback(
    async (campaignType, { name = '', presetId = null, templateId = null } = {}) => {
      setCreating(true);
      setError('');
      try {
        const body = { campaignType };
        if (name.trim()) body.name = name.trim();
        if (presetId) body.presetId = presetId;
        if (templateId != null) body.templateId = templateId;
        const { campaign } = await api('/campaigns', { method: 'POST', body });
        const seeded = Boolean(presetId || templateId != null);
        navigate(
          campaignType === 'escaramuza'
            ? seeded
              ? `/campanas/${campaign.id}`
              : `/campanas/${campaign.id}/editor`
            : `/campanas/${campaign.id}/taller`
        );
      } catch (cause) {
        setError(cause.message);
        setCreating(false);
      }
    },
    [navigate]
  );

  const joinCampaign = useCallback(async (code) => {
    setError('');
    try {
      const { campaign } = await api('/campaigns/join', { method: 'POST', body: { code } });
      setCampaigns((rows) => (rows?.some((row) => row.id === campaign.id) ? rows : [campaign, ...(rows ?? [])]));
      return { ok: true };
    } catch (cause) {
      setError(cause.message);
      return { error: cause.message };
    }
  }, []);

  async function deleteCampaign(campaign) {
    setDeleting(true);
    setError('');
    try {
      await api(`/campaigns/${campaign.id}`, { method: 'DELETE' });
      setCampaigns((rows) => rows.filter((row) => row.id !== campaign.id));
      setCampaignToDelete(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setDeleting(false);
    }
  }

  async function leaveCampaign(campaign) {
    setLeaving(true);
    setError('');
    try {
      await api(`/campaigns/${campaign.id}/abandonar`, { method: 'DELETE' });
      setCampaigns((rows) => rows.filter((row) => row.id !== campaign.id));
      setCampaignToLeave(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLeaving(false);
    }
  }

  const counts = {
    campanas: groups.campanas.length,
    escaramuzas: groups.escaramuzas.length,
    'donde-juego': groups.ajenas.length,
    escenarios: null,
  };

  const context = {
    campaigns,
    groups,
    loading: campaigns === null,
    creating,
    error,
    setError,
    createCampaign,
    joinCampaign,
    requestDeletion: (campaign) => {
      setError('');
      setCampaignToDelete(campaign);
    },
    requestLeaving: (campaign) => {
      setError('');
      setCampaignToLeave(campaign);
    },
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-semibold text-ink">Tus campañas</h2>
          <p className="mt-1 text-sm text-ink/60">
            Prepara el mundo del DM, abre una partida rápida o entra en una mesa ajena.
          </p>
        </div>
        <NavLink
          to="/campanas/crear"
          className={({ isActive }) =>
            `rounded-sm px-4 py-2 font-display text-sm tracking-wide ${
              isActive
                ? 'bg-ember text-parchment-100 ring-2 ring-ember/40'
                : 'bg-ember text-parchment-100 hover:bg-ember/90'
            }`
          }
        >
          + Crear o unirse
        </NavLink>
      </div>

      <nav className="mt-5 flex flex-wrap gap-1 border-b border-ochre/25 pb-px">
        {HUB_SECTIONS.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            end={section.path === '/campanas'}
            title={section.hint}
            className={({ isActive }) =>
              `-mb-px rounded-t-sm border-b-2 px-3 py-2 font-display text-sm tracking-wide ${
                isActive
                  ? 'border-ochre text-ink'
                  : 'border-transparent text-ink/55 hover:border-ochre/40 hover:text-ink/80'
              }`
            }
          >
            {section.label}
            {counts[section.id] != null && (
              <span className="ml-1.5 font-mono text-[0.7rem] text-ink/40">{counts[section.id]}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {error && <p className="mt-4 text-sm text-ember">{error}</p>}

      <div className="mt-6">
        <Outlet context={context} />
      </div>

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
