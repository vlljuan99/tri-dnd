import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth } from '../../../store/auth.js';
import { useRoom } from '../../../store/socket.js';
import TacticalMap from '../components/TacticalMap.jsx';
import CampScene from '../../camp/components/CampScene.jsx';
import { useTacticalMap } from '../hooks/useTacticalMap.js';
import { useWorldState } from '../../world-map/hooks/useWorldState.js';
import WorldMapView from '../../world-map/components/WorldMapView.jsx';
import LoreScreen from '../../world-map/components/LoreScreen.jsx';
import { initialCampaignScreen } from '../../../lib/gameContext.js';

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
  const removedCampaignId = useRoom((s) => s.removedCampaignId);

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
  const currentLocation =
    world?.maps?.flatMap((m) => m.locations).find((l) => l.id === currentLocationId) ?? null;
  // Un pin de ciudad salta a un submapa: al continuar tras su lore se vuelve
  // al mapa de mundo (la capa nueva) en vez de al tablero
  const currentJumpsToSubmap = Boolean(currentLocation?.targetMapId);
  const currentHasBoard = Boolean(currentLocation?.mapId);
  // Entrar a /campanas/:id significa entrar a jugar: el tablero es el destino
  // inicial. El campamento sigue disponible desde la cabecera, pero ya no es
  // una antesala obligatoria.
  const [screen, setScreen] = useState('board'); // 'camp' | 'lore' | 'world' | 'locationLore' | 'board'
  const [travelError, setTravelError] = useState('');
  const loreSeenRef = useRef(false);
  const seenLocationRef = useRef(undefined);

  function screenForCurrentLocation() {
    if (!currentLocationId) return 'world';
    if (currentJumpsToSubmap) return 'world';
    if (currentLocation?.kind === 'campamento') return 'camp';
    return currentHasBoard ? 'board' : 'world';
  }

  // El DM viaja (o el jugador lo recibe por socket): al cambiar la ubicación
  // actual, mostrar la pantalla de lore de destino antes del tablero. En la
  // primera carga vamos directamente al contenido jugable apropiado para la
  // ubicación actual, sin pasar primero por el campamento.
  useEffect(() => {
    if (!hasWorldMap || !world) return;
    const isFirstLoad = seenLocationRef.current === undefined;
    if (currentLocationId === seenLocationRef.current) return;
    seenLocationRef.current = currentLocationId;
    if (isFirstLoad) {
      setScreen(initialCampaignScreen({ hasWorldMap, currentLocationId, currentLocation }));
      return;
    }
    if (!isDm && !isLive) return;
    setScreen(currentLocationId ? 'locationLore' : 'world');
  }, [hasWorldMap, world, currentLocationId, isDm, isLive]);

  // Tomar el camino del campamento: el lore de campaña se muestra la primera
  // vez, después la decisión de siempre (tablero si hay ubicación con mapa,
  // mapa de mundo si no; tablero directo sin mundo)
  function takePath() {
    if (!hasWorldMap) {
      setScreen('board');
      return;
    }
    if (!loreSeenRef.current && campaign?.lore) {
      setScreen('lore');
      return;
    }
    loreSeenRef.current = true;
    setScreen(screenForCurrentLocation());
  }

  async function travel(loc, { skipRoute = false } = {}) {
    if (loc.id === currentLocationId) {
      setScreen(screenForCurrentLocation());
      return true;
    }
    setTravelError('');
    try {
      // El cambio de ubicación llega por socket y el efecto pasa a 'locationLore'
      await api(`/campaigns/${campaignId}/mundo/viajar`, {
        method: 'POST',
        body: { locationId: loc.id, skipRoute },
      });
      return true;
    } catch (error) {
      setTravelError(error.message || 'No se pudo viajar a esa ubicación.');
    }
  }

  // Subir del submapa actual a la capa de arriba (solo DM); el cambio llega
  // por socket y el efecto de ubicación (queda NULL) pasa a 'world'
  async function travelBack() {
    setTravelError('');
    try {
      await api(`/campaigns/${campaignId}/mundo/volver`, { method: 'POST' });
    } catch (error) {
      setTravelError(error.message || 'No se pudo volver al mapa anterior.');
    }
  }

  if (campaignLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-night-950 text-bone">
        <p className="font-display text-lg tracking-wide text-gold">Cargando campaña...</p>
      </div>
    );
  }

  if (removedCampaignId === campaignId) {
    return <Navigate to="/" replace />;
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

  // Campaña todavía en borrador: solo el DM puede llegar aquí (es el único
  // miembro) y vuelve a su taller en vez de ver una mesa a medio montar.
  if (campaign?.status === 'draft') {
    return <Navigate to={`/campanas/${campaignId}/taller`} replace />;
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
          {screen !== 'camp' && (
            <button
              onClick={() => setScreen('camp')}
              className="rounded-sm border border-gold/40 px-3 py-1 font-display text-sm tracking-wide text-gold hover:bg-gold/10"
            >
              ⛺ Campamento
            </button>
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

  // Cuerpo de la mesa. El campamento es ahora un destino voluntario; el flujo
  // principal abre el tablero o el mapa de mundo correspondiente.
  function renderBody() {
    if (screen === 'camp') {
      return (
        <CampScene
          campaign={campaign}
          members={campaignMembers}
          characters={campaignCharacters}
          user={user}
          isDm={isDm}
          isLive={isLive}
          playerCount={playerCount}
          campaignId={campaignId}
          onTakePath={takePath}
        />
      );
    }
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
              setScreen(screenForCurrentLocation());
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
            onGoBack={travelBack}
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
            continueLabel={
              currentJumpsToSubmap
                ? 'Entrar al mapa'
                : currentLocation?.kind === 'campamento'
                  ? 'Acampar'
                  : currentHasBoard
                    ? 'Entrar al tablero'
                    : 'Volver al mapa de mundo'
            }
            onContinue={() =>
              setScreen(
                screenForCurrentLocation()
              )
            }
          >
            <div className="rounded-sm border border-gold/20 bg-night-900/60 p-4 text-left text-sm text-bone/80">
              {currentJumpsToSubmap ? (
                <>
                  <p className="font-display text-xs uppercase tracking-widest text-gold/70">Mapa</p>
                  <p className="mt-1">{currentLocation.targetMapName ?? 'Submapa'}</p>
                </>
              ) : (
                <>
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
                </>
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
      const emptyMessage =
        campaign?.role === 'dm'
          ? 'La mesa todavía no tiene un tablero preparado.'
          : 'El DM todavía no ha preparado un tablero para esta mesa.';
      return (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
          <section className="w-full max-w-xl rounded-md border border-gold/20 bg-night-900/70 p-6 shadow-xl">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-gold/55">
              Mesa sin tablero
            </p>
            <h2 className="mt-2 font-display text-2xl text-gold/90">{emptyMessage}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-bone/60">
              {campaign?.role === 'dm'
                ? 'Crea el primero o elige cuál quieres llevar a la mesa desde el paso Mapas del Taller.'
                : 'Puedes visitar el campamento mientras el DM termina de prepararlo.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {hasWorldMap && (
                <button
                  onClick={() => setScreen('world')}
                  className="rounded-sm border border-gold/35 px-4 py-2 font-display text-sm text-gold hover:bg-gold/10"
                >
                  Volver al mapa de mundo
                </button>
              )}
              {campaign?.role === 'dm' && (
                <Link
                  to={`/campanas/${campaignId}/taller/mapas`}
                  className="rounded-sm bg-gold px-4 py-2 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
                >
                  Crear o elegir tablero →
                </Link>
              )}
              {campaign?.role === 'dm' && (
                <Link
                  to={`/campanas/${campaignId}/editor`}
                  className="rounded-sm border border-gold/35 px-4 py-2 font-display text-sm text-gold hover:bg-gold/10"
                >
                  Abrir editor avanzado
                </Link>
              )}
              {campaign?.role !== 'dm' && (
                <button
                  type="button"
                  onClick={() => setScreen('camp')}
                  className="rounded-sm border border-gold/35 px-4 py-2 font-display text-sm text-gold hover:bg-gold/10"
                >
                  Ir al campamento
                </button>
              )}
            </div>
            {loadError && <p className="mt-4 text-xs text-bone/35">{loadError}</p>}
            <Link to="/" className="mt-5 inline-block text-xs text-bone/50 underline hover:text-bone">
              Volver al hub
            </Link>
          </section>
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
        showArchive={
          (campaign?.campaignType ?? (campaign?.hasWorldMap ? 'campana' : 'escaramuza')) === 'campana'
        }
        ownCharacterId={ownCharacterId}
        campaignId={campaignId}
      />
    );
  }
}
