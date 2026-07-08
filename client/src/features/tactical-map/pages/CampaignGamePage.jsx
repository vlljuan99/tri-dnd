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
  const pings = useRoom((s) => s.pings);
  const sendPing = useRoom((s) => s.sendPing);
  const isLive = useRoom((s) => s.isLive);
  const setLive = useRoom((s) => s.setLive);

  // Unirse a la sala de la campaña para recibir 'mapa:actualizado' aunque
  // se llegue al tablero directamente, sin pasar por la mesa
  useEffect(() => {
    joinRoom(campaignId);
  }, [campaignId, joinRoom]);
  const [campaign, setCampaign] = useState(null);
  const [campaignCharacters, setCampaignCharacters] = useState([]);
  const [campaignError, setCampaignError] = useState('');
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [doorError, setDoorError] = useState('');
  const [floorId, setFloorId] = useState(null);
  const [playerView, setPlayerView] = useState(false);

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
      .then(({ campaign: loadedCampaign, characters }) => {
        if (!cancelled) {
          setCampaign(loadedCampaign);
          setCampaignCharacters(characters ?? []);
        }
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
    floorId,
    playerView: campaign?.role === 'dm' && playerView,
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
            <Link to="/" className="font-display text-sm text-gold/70 hover:text-gold">
              ← Hub
            </Link>
            <h1 className="truncate font-display text-xl tracking-wide text-gold">
              {campaign?.name || 'Mesa de juego'}
            </h1>
            {isLive && (
              <span className="flex items-center gap-1.5 rounded-sm border border-ember/60 px-2 py-0.5 text-xs text-ember">
                <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> EN VIVO
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-bone/60">
            {user?.displayName || user?.username || 'Usuario'} · {campaign?.role === 'dm' ? 'DM' : 'Jugador'}
          </p>
        </div>
        {campaign?.role === 'dm' && (
          <button
            onClick={() => setLive(!isLive)}
            className={`rounded-sm border px-3 py-1 font-display text-sm tracking-wide transition-colors ${
              isLive
                ? 'border-blood/60 text-blood hover:bg-blood/10'
                : 'border-moss text-bone hover:bg-moss/20'
            }`}
          >
            {isLive ? 'Cerrar sesión de juego' : 'Abrir sesión de juego'}
          </button>
        )}
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
          <Link to="/" className="text-bone/70 underline">
            Volver al hub
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
          onSelectFloor={setFloorId}
          playerView={playerView}
          onTogglePlayerView={() => setPlayerView((v) => !v)}
          pings={pings}
          onPing={(world) =>
            sendPing({
              floorId: map.floorId,
              x: Math.floor(world.x / map.gridSize) + (map.origin?.x ?? 0),
              y: Math.floor(world.z / map.gridSize) + (map.origin?.y ?? 0),
            })
          }
          backToCampaignHref="/"
          editorHref={`/campanas/${campaignId}/editor`}
          ownCharacterId={campaignCharacters.find((c) => c.user_id === user?.id)?.id ?? null}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
