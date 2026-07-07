import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth } from '../../../store/auth.js';
import { useRoom } from '../../../store/socket.js';
import TacticalMap from '../components/TacticalMap.jsx';
import { useTacticalMap } from '../hooks/useTacticalMap.js';

export default function CampaignGamePage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const user = useAuth((state) => state.user);
  const joinRoom = useRoom((s) => s.joinRoom);
  const mapVersion = useRoom((s) => s.mapVersion);

  // Unirse a la sala de la campaña para recibir 'mapa:actualizado' aunque
  // se llegue al tablero directamente, sin pasar por la mesa
  useEffect(() => {
    joinRoom(campaignId);
  }, [campaignId, joinRoom]);
  const [campaign, setCampaign] = useState(null);
  const [campaignError, setCampaignError] = useState('');
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [doorError, setDoorError] = useState('');

  // Abrir una puerta (o alternarla, si eres DM). El nuevo estado del mapa
  // llega a todos —incluido quien pulsa— por el evento de socket.
  async function openDoor(door) {
    if (campaign?.role !== 'dm' && door.isOpen) return;
    setDoorError('');
    try {
      await api(`/campaigns/${campaignId}/puertas/${door.id}/abrir`, {
        method: 'POST',
        body: { open: campaign?.role === 'dm' ? !door.isOpen : true },
      });
    } catch (error) {
      setDoorError(error.message || 'No se pudo abrir la puerta.');
    }
  }

  useEffect(() => {
    let cancelled = false;
    setCampaignLoading(true);
    setCampaignError('');

    api(`/campaigns/${campaignId}`)
      .then(({ campaign: loadedCampaign }) => {
        if (!cancelled) setCampaign(loadedCampaign);
      })
      .catch((error) => {
        if (!cancelled) setCampaignError(error.message || 'No se pudo cargar la campaña.');
      })
      .finally(() => {
        if (!cancelled) setCampaignLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const {
    map,
    loading: mapLoading,
    loadError,
    saveError,
    savingTokenId,
    moveToken,
  } = useTacticalMap(campaignId, {
    user,
    role: campaign?.role,
    enabled: Boolean(campaign),
    version: mapVersion,
  });

  if (campaignLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-night-950 text-bone">
        <p className="font-display text-lg tracking-wide text-gold">Cargando campaña...</p>
      </div>
    );
  }

  if (campaignError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 px-4 text-center text-bone">
        <p className="font-display text-xl text-blood">{campaignError}</p>
        <Link to="/" className="text-gold underline">
          Volver al hub
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Link to={`/campanas/${campaignId}`} className="font-display text-sm text-gold/70 hover:text-gold">
              Volver a mesa
            </Link>
            <h1 className="truncate font-display text-xl tracking-wide text-gold">
              {campaign?.name || 'Mapa táctico'}
            </h1>
          </div>
          <p className="mt-1 text-xs text-bone/60">
            {user?.displayName || user?.username || 'Usuario'} · {campaign?.role === 'dm' ? 'DM' : 'Jugador'}
          </p>
        </div>
        <span className="rounded-sm border border-gold/25 px-3 py-1 font-display text-xs uppercase tracking-widest text-gold/80">
          Tablero cenital
        </span>
      </header>

      {mapLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-display text-lg text-gold">Preparando mapa táctico...</p>
        </div>
      ) : loadError || !map ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="font-display text-xl text-gold/90">{loadError || 'Mapa no disponible.'}</p>
          {campaign?.role === 'dm' && (
            <Link to={`/campanas/${campaignId}/editor`} className="text-gold underline">
              Abrir el editor de campaña
            </Link>
          )}
          <Link to={`/campanas/${campaignId}`} className="text-bone/70 underline">
            Volver a la campaña
          </Link>
        </div>
      ) : (
        <TacticalMap
          map={map}
          user={user}
          role={campaign?.role}
          savingTokenId={savingTokenId}
          saveError={saveError}
          onMoveToken={moveToken}
          onOpenDoor={openDoor}
          doorError={doorError}
          backToCampaignHref={`/campanas/${campaignId}`}
          editorHref={`/campanas/${campaignId}/editor`}
        />
      )}
    </div>
  );
}
