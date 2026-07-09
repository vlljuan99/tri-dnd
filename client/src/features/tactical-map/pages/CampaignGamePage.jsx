import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth } from '../../../store/auth.js';
import { useRoom } from '../../../store/socket.js';
import TacticalMap from '../components/TacticalMap.jsx';
import CampaignLobby from '../components/CampaignLobby.jsx';
import { useTacticalMap } from '../hooks/useTacticalMap.js';
import { useWorldState } from '../../world-map/hooks/useWorldState.js';
import WorldMapView from '../../world-map/components/WorldMapView.jsx';
import LoreScreen from '../../world-map/components/LoreScreen.jsx';

export default function CampaignGamePage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const user = useAuth((state) => state.user);
  const joinRoom = useRoom((s) => s.joinRoom);
  const mapVersion = useRoom((s) => s.mapVersion);
  const worldVersion = useRoom((s) => s.worldVersion);
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
  const [campaignMembers, setCampaignMembers] = useState([]);
  const [campaignError, setCampaignError] = useState('');
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [doorError, setDoorError] = useState('');
  const [floorId, setFloorId] = useState(null);
  const [playerView, setPlayerView] = useState(false);
  const combat = useRoom((s) => s.combat);
  const isDm = campaign?.role === 'dm';
  const ownCharacterId = campaignCharacters.find((c) => c.user_id === user?.id)?.id ?? null;
  const playerCount = campaignMembers.filter((m) => m.role === 'jugador').length;
  const activeCombatant = combat.active
    ? combat.combatants.find((c) => c.id === combat.turnId) ?? null
    : null;
  const isMyTurn = Boolean(activeCombatant && ownCharacterId && activeCombatant.characterId === ownCharacterId);

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
      .then(({ campaign: loadedCampaign, characters, members }) => {
        if (!cancelled) {
          setCampaign(loadedCampaign);
          setCampaignCharacters(characters ?? []);
          setCampaignMembers(members ?? []);
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

  // --- Mapa de campaña (mapa de mundo) -----------------------------------
  // Solo si la campaña "forma parte de un mapa". El flujo de pantallas
  // (lore → mundo → lore de ubicación → tablero) vive aquí; si no hay mundo,
  // se renderiza el tablero directo como siempre.
  const hasWorldMap = Boolean(campaign?.hasWorldMap);
  const { world, loading: worldLoading } = useWorldState(campaignId, {
    enabled: hasWorldMap,
    version: worldVersion,
  });
  const currentLocationId = world?.currentLocationId ?? null;
  const currentLocation = world?.locations?.find((l) => l.id === currentLocationId) ?? null;
  const [screen, setScreen] = useState(null); // 'lore' | 'world' | 'locationLore' | 'board'
  const [travelError, setTravelError] = useState('');
  const loreSeenRef = useRef(false);
  const seenLocationRef = useRef(undefined);

  // Decisión inicial de pantalla en cuanto carga el mundo
  useEffect(() => {
    if (!hasWorldMap || !world || screen !== null) return;
    seenLocationRef.current = currentLocationId;
    if (!loreSeenRef.current && campaign?.lore) {
      setScreen('lore');
    } else {
      loreSeenRef.current = true;
      setScreen(currentLocationId ? 'board' : 'world');
    }
  }, [hasWorldMap, world, screen, currentLocationId, campaign]);

  // El DM viaja (o el jugador lo recibe por socket): al cambiar la ubicación
  // actual, mostrar la pantalla de lore de destino antes del tablero.
  useEffect(() => {
    if (!hasWorldMap || screen === null) return;
    if (currentLocationId === seenLocationRef.current) return;
    seenLocationRef.current = currentLocationId;
    setScreen(currentLocationId ? 'locationLore' : 'world');
  }, [hasWorldMap, currentLocationId, screen]);

  async function travel(loc) {
    if (loc.id === currentLocationId) {
      setScreen('board');
      return;
    }
    setTravelError('');
    try {
      // El cambio de ubicación llega por socket y el efecto pasa a 'locationLore'
      await api(`/campaigns/${campaignId}/mundo/viajar`, {
        method: 'POST',
        body: { locationId: loc.id },
      });
    } catch (error) {
      setTravelError(error.message || 'No se pudo viajar a esa ubicación.');
    }
  }

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

  // Mientras el DM no ha abierto la sesión, el jugador ve el lore/objetivos
  // en vez del tablero (que sigue esperando a que empiece la partida); el DM
  // conserva su acceso directo al tablero para preparar la escena antes.
  if (!isDm && !isLive) {
    return <CampaignLobby campaign={campaign} playerCount={playerCount} />;
  }

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-sm border border-gold/25 px-2.5 py-1 font-display text-sm text-gold/80 hover:border-gold hover:text-gold"
            >
              ← Hub
            </Link>
            <h1 className="truncate font-display text-xl tracking-wide text-gold">
              {campaign?.name || 'Mesa de juego'}
            </h1>
            {isDm && isLive && (
              <span className="flex items-center gap-1.5 rounded-sm border border-ember/60 px-2 py-0.5 text-xs text-ember">
                <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> EN VIVO
              </span>
            )}
            {isDm && (
              <span className="rounded-sm border border-ember/50 bg-night-900/90 px-2 py-0.5 font-display text-xs uppercase tracking-widest text-ember">
                Modo DM
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-bone/60">
            {user?.displayName || user?.username || 'Usuario'} · {isDm ? 'DM' : 'Jugador'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {combat.active && activeCombatant && (
            <span className="font-display text-sm uppercase tracking-widest text-gold/90">
              Ronda {combat.round}
              {' · '}
              {isMyTurn ? (
                <span className="animate-pulse text-blood">¡TU TURNO!</span>
              ) : (
                <span className="text-bone/70">
                  turno de{' '}
                  <span className={activeCombatant.kind === 'enemigo' ? 'text-blood' : 'text-bone'}>
                    {activeCombatant.name}
                  </span>
                </span>
              )}
            </span>
          )}
          {hasWorldMap && screen === 'board' && (
            <button
              onClick={() => setScreen('world')}
              className="rounded-sm border border-gold/40 px-3 py-1 font-display text-sm tracking-wide text-gold hover:bg-gold/10"
            >
              Mapa de mundo
            </button>
          )}
          {isDm && (
            <button
              onClick={() => setLive(!isLive)}
              disabled={!isLive && playerCount < 1}
              title={!isLive && playerCount < 1 ? 'Necesitas al menos un jugador unido para empezar' : undefined}
              className={`rounded-sm border px-3 py-1 font-display text-sm tracking-wide transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${
                isLive
                  ? 'border-blood/60 text-blood hover:bg-blood/10'
                  : 'border-moss text-bone hover:bg-moss/20'
              }`}
            >
              {isLive ? 'Cerrar sesión de juego' : 'Abrir sesión de juego'}
            </button>
          )}
        </div>
      </header>

      {renderBody()}
    </div>
  );

  // Cuerpo de la mesa: con mundo, la máquina de pantallas; sin mundo, el
  // tablero directo de siempre.
  function renderBody() {
    if (hasWorldMap) {
      if (!world && worldLoading) {
        return (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-display text-lg text-gold">Cargando mapa de mundo...</p>
          </div>
        );
      }
      if (screen === 'lore') {
        return (
          <LoreScreen
            eyebrow="La historia comienza"
            title={campaign?.name || 'Campaña'}
            lore={campaign?.lore}
            continueLabel={currentLocationId ? 'Continuar' : 'Ver el mapa de mundo'}
            onContinue={() => {
              loreSeenRef.current = true;
              setScreen(currentLocationId ? 'board' : 'world');
            }}
          />
        );
      }
      if (screen === 'world') {
        return (
          <WorldMapView
            campaignId={campaignId}
            world={world}
            canTravel={isDm && !playerView}
            onTravel={travel}
            onEnterBoard={() => setScreen('board')}
            travelError={travelError}
          />
        );
      }
      if (screen === 'locationLore') {
        return (
          <LoreScreen
            eyebrow="Viajáis a…"
            title={currentLocation?.name || 'Ubicación'}
            lore={currentLocation?.lore}
            continueLabel="Entrar al tablero"
            onContinue={() => setScreen('board')}
          >
            <div className="rounded-sm border border-gold/20 bg-night-900/60 p-4 text-left text-sm text-bone/80">
              <p className="font-display text-xs uppercase tracking-widest text-gold/70">Tablero</p>
              {currentLocation?.mapId ? (
                <p className="mt-1">
                  {currentLocation.mapName} — {currentLocation.floorCount} planta
                  {currentLocation.floorCount === 1 ? '' : 's'}, {currentLocation.roomCount} sala
                  {currentLocation.roomCount === 1 ? '' : 's'}
                </p>
              ) : (
                <p className="mt-1 italic text-bone/50">Sin tablero asignado a esta ubicación.</p>
              )}
            </div>
          </LoreScreen>
        );
      }
      // screen === 'board' (o null tras decidir): cae al tablero de abajo
    }

    return renderBoard();
  }

  function renderBoard() {
    if (mapLoading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-display text-lg text-gold">Preparando mapa táctico...</p>
        </div>
      );
    }
    if (loadError || !map) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="font-display text-xl text-gold/90">{loadError || 'Mapa no disponible.'}</p>
          {hasWorldMap && (
            <button onClick={() => setScreen('world')} className="text-gold underline">
              Volver al mapa de mundo
            </button>
          )}
          {campaign?.role === 'dm' && (
            <Link to={`/campanas/${campaignId}/editor`} className="text-gold underline">
              Abrir el editor de campaña
            </Link>
          )}
          <Link to="/" className="text-bone/70 underline">
            Volver al hub
          </Link>
        </div>
      );
    }
    return (
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
        editorHref={`/campanas/${campaignId}/editor`}
        ownCharacterId={ownCharacterId}
        campaignId={campaignId}
      />
    );
  }
}
