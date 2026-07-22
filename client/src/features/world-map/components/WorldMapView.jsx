import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { kindGlyph } from '../kinds.js';
import { findTravelRoute, routeGeometry } from '../domain/routes.js';
import { useRoom } from '../../../store/socket.js';

// Vista de mesa del mundo por capas. Los pins y las aristas ocultos se filtran
// en servidor. El jugador puede señalar; solo el DM recorre una ruta válida o
// confirma explícitamente el escape hatch para saltar la red.
export default function WorldMapView({
  campaignId,
  world,
  canTravel,
  onTravel,
  onGoBack,
  onEnterBoard,
  travelError,
}) {
  const worldPings = useRoom((state) => state.worldPings);
  const worldTravel = useRoom((state) => state.worldTravel);
  const sendWorldPing = useRoom((state) => state.sendWorldPing);
  const [jumpTarget, setJumpTarget] = useState(null);
  const [pendingTravel, setPendingTravel] = useState(false);

  const currentId = world?.currentLocationId ?? null;
  const currentLocation =
    world?.maps?.flatMap((map) => map.locations ?? []).find((location) => location.id === currentId) ?? null;
  const currentMap =
    world?.maps?.find((map) => map.id === world.currentMapId) ??
    world?.maps?.find((map) => map.id === world.rootMapId) ??
    null;
  const locations = currentMap?.locations ?? [];
  const routes = currentMap?.routes ?? [];
  const pings = worldPings.filter((ping) => ping.worldMapId === currentMap?.id);
  const activeTravel = worldTravel?.worldMapId === currentMap?.id ? worldTravel : null;
  const routeArrowId = `world-route-arrow-${currentMap?.id ?? 'map'}`;

  function pingAt(event) {
    if (!currentMap) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    sendWorldPing({ worldMapId: currentMap.id, x, y });
  }

  async function chooseLocation(location) {
    if (!canTravel) {
      sendWorldPing({ worldMapId: currentMap.id, x: location.x, y: location.y, locationId: location.id });
      return;
    }
    if (location.id === currentId) {
      onTravel(location);
      return;
    }

    const route = findTravelRoute(routes, currentId, location.id);
    if (!route) {
      setJumpTarget(location);
      return;
    }

    setJumpTarget(null);
    setPendingTravel(true);
    try {
      await onTravel(location, { skipRoute: false });
    } finally {
      setPendingTravel(false);
    }
  }

  async function jumpWithoutRoute() {
    if (!jumpTarget) return;
    setPendingTravel(true);
    try {
      const completed = await onTravel(jumpTarget, { skipRoute: true });
      if (completed !== false) setJumpTarget(null);
    } finally {
      setPendingTravel(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div>
          <h2 className="font-display text-lg tracking-wide text-gold">
            {currentMap && !currentMap.isRoot ? currentMap.name : 'Mapa de mundo'}
          </h2>
          <p className="text-xs text-bone/60">
            {canTravel
              ? currentId
                ? 'Elige un destino conectado. Las flechas marcan rutas de un solo sentido.'
                : 'Sitúa al grupo con «Saltar sin ruta» para comenzar a recorrer la red.'
              : currentId
                ? 'El grupo está en una ubicación. Pulsa el mapa para señalar dónde ir.'
                : 'Pulsa una ubicación para proponerla al DM.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canTravel && currentMap?.parent && (
            <button
              type="button"
              onClick={onGoBack}
              className="rounded-sm border border-gold/30 px-2.5 py-1 text-xs text-gold hover:bg-gold/10"
            >
              ← Volver a {world.maps.find((map) => map.id === currentMap.parent.mapId)?.name ?? 'mapa anterior'}
            </button>
          )}
          {canTravel && (
            <Link
              to={`/campanas/${campaignId}/mundo`}
              className="rounded-sm border border-gold/30 px-2.5 py-1 text-xs text-gold hover:bg-gold/10"
            >
              Editar mundo
            </Link>
          )}
          {currentLocation?.mapId && (
            <button
              type="button"
              onClick={onEnterBoard}
              className="rounded-sm border border-sage/60 px-3 py-1 font-display text-sm text-sage hover:bg-sage/10"
            >
              Entrar al tablero
            </button>
          )}
        </div>
      </div>

      {travelError && <p className="bg-blood/10 px-4 py-1.5 text-sm text-blood">{travelError}</p>}
      {jumpTarget && canTravel && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ember/30 bg-ember/10 px-4 py-2 text-sm">
          <p className="text-bone/80">
            <span className="font-display text-ember">Sin ruta recorrible:</span> {jumpTarget.name}. El salto recoloca al
            grupo sin jornadas ni eventos automáticos.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendingTravel}
              onClick={() => setJumpTarget(null)}
              className="rounded-sm border border-bone/20 px-3 py-1 text-xs text-bone/70 hover:bg-bone/5"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pendingTravel}
              onClick={() => jumpWithoutRoute().catch(() => {})}
              className="rounded-sm border border-ember/60 bg-ember/15 px-3 py-1 font-display text-xs text-ember hover:bg-ember/25 disabled:opacity-40"
            >
              Saltar sin ruta
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {currentMap?.imageUrl ? (
          <div className="relative max-h-full max-w-full">
            <img
              src={currentMap.imageUrl}
              alt={currentMap.name}
              onClick={pingAt}
              className="max-h-[calc(100vh-9rem)] w-auto cursor-crosshair rounded-md border border-gold/20"
              draggable={false}
            />

            <svg
              className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker id={routeArrowId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="#d6b45d" />
                </marker>
              </defs>
              {routes.map((route) => {
                const geometry = routeGeometry(route, locations);
                if (!geometry) return null;
                const available = Boolean(findTravelRoute([route], currentId, geometry.from.id === currentId ? geometry.to.id : geometry.from.id));
                return (
                  <line
                    key={route.id}
                    x1={geometry.from.x}
                    y1={geometry.from.y}
                    x2={geometry.to.x}
                    y2={geometry.to.y}
                    stroke={available ? '#f0cd70' : '#927d4d'}
                    strokeWidth={available ? 3 : 2}
                    strokeDasharray={route.oneWay ? 'none' : '5 3'}
                    markerEnd={route.oneWay ? `url(#${routeArrowId})` : undefined}
                    opacity={available ? 0.95 : 0.62}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {routes.map((route) => {
              const geometry = routeGeometry(route, locations);
              if (!geometry) return null;
              return (
                <span
                  key={`route-label-${route.id}`}
                  style={{ left: `${geometry.midX}%`, top: `${geometry.midY}%` }}
                  className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/30 bg-night-950/85 px-1.5 py-0.5 text-[0.6rem] text-gold/80 shadow-md"
                  title={route.label || 'Ruta'}
                >
                  {route.oneWay ? '→ ' : '↔ '}{route.cost}j{route.label ? ` · ${route.label}` : ''}
                </span>
              );
            })}

            {locations.map((location) => {
              const isCurrent = location.id === currentId;
              const dim = !isCurrent && !location.visited;
              const unprepared =
                canTravel &&
                ((location.kind === 'dungeon' && !location.mapId) ||
                  (location.kind === 'ciudad' && !location.targetMapId));
              const route = findTravelRoute(routes, currentId, location.id);
              const titleParts = [location.name];
              if (location.hidden) titleParts.push('(oculta para los jugadores)');
              if (unprepared) titleParts.push('(sin tablero preparado)');
              if (canTravel && !isCurrent && !route) titleParts.push('(sin ruta recorrible)');
              return (
                <button
                  key={location.id}
                  type="button"
                  disabled={pendingTravel || Boolean(activeTravel)}
                  onClick={() => chooseLocation(location)}
                  style={{ left: `${location.x}%`, top: `${location.y}%` }}
                  className={`absolute z-10 -translate-x-1/2 -translate-y-full cursor-pointer disabled:cursor-wait ${
                    dim ? 'opacity-45 hover:opacity-100' : ''
                  }`}
                  title={titleParts.join(' ')}
                >
                  <span className="flex flex-col items-center">
                    <span
                      className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[0.7rem] font-display tracking-wide hover:bg-gold hover:text-night-950 ${
                        location.hidden ? 'border-dashed' : 'border-solid'
                      } ${
                        isCurrent
                          ? 'bg-gold text-night-950'
                          : route || !canTravel
                            ? 'border border-gold/40 bg-night-900/90 text-gold'
                            : 'border border-ember/40 bg-night-900/90 text-ember'
                      }`}
                    >
                      {kindGlyph(location.kind)} {location.name}
                      {isCurrent && ' · aquí'}
                      {unprepared && <span className="ml-1 text-ember" title="Sin tablero preparado">⚠</span>}
                    </span>
                    <span
                      className={`h-3 w-3 rotate-45 border ${
                        isCurrent ? 'border-gold bg-gold' : 'border-gold/60 bg-blood'
                      }`}
                    />
                  </span>
                </button>
              );
            })}

            {pings.map((ping) => (
              <div
                key={ping.id}
                style={{ left: `${ping.x}%`, top: `${ping.y}%` }}
                className="pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              >
                <span className="relative flex h-5 w-5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember/70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ember" />
                </span>
                <span className="mt-0.5 whitespace-nowrap rounded-sm bg-night-950/85 px-1.5 py-0.5 text-[0.65rem] font-display tracking-wide text-ember">
                  {ping.by}{ping.locationName ? ` → ${ping.locationName}` : ''}
                </span>
              </div>
            ))}

            {activeTravel && (
              <motion.div
                key={activeTravel.id}
                initial={{ left: `${activeTravel.from.x}%`, top: `${activeTravel.from.y}%` }}
                animate={{ left: `${activeTravel.to.x}%`, top: `${activeTravel.to.y}%` }}
                transition={{ duration: activeTravel.durationMs / 1000, ease: 'easeInOut' }}
                className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-night-950 bg-gold text-xs text-night-950 shadow-[0_0_18px_rgba(214,180,93,0.95)]">
                  ✦
                </span>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="text-center text-bone/50">
            <p className="font-display text-lg">
              {currentMap && !currentMap.isRoot
                ? `El DM aún no ha preparado el mapa de "${currentMap.name}".`
                : 'El DM aún no ha preparado el mapa de mundo.'}
            </p>
            {canTravel && (
              <Link to={`/campanas/${campaignId}/mundo`} className="mt-2 inline-block text-gold underline">
                Preparar el mapa de mundo
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
