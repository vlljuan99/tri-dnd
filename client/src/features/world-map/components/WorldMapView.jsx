import { Link } from 'react-router-dom';

// Vista del mapa de mundo en la mesa: la imagen con los pins de ubicación. El
// DM (canTravel) puede pulsar un pin para viajar; el jugador solo consulta. La
// ubicación actual del grupo se resalta.
export default function WorldMapView({
  campaignId,
  world,
  canTravel,
  onTravel,
  onEnterBoard,
  travelError,
}) {
  const locations = world?.locations ?? [];
  const currentId = world?.currentLocationId ?? null;

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div>
          <h2 className="font-display text-lg tracking-wide text-gold">Mapa de mundo</h2>
          <p className="text-xs text-bone/60">
            {canTravel
              ? 'Pulsa una ubicación para viajar allí con el grupo.'
              : currentId
                ? 'El grupo está en una ubicación. Espera a que el DM decida moverse.'
                : 'Esperando a que el DM elija destino…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canTravel && (
            <Link
              to={`/campanas/${campaignId}/mundo`}
              className="rounded-sm border border-gold/30 px-2.5 py-1 text-xs text-gold hover:bg-gold/10"
            >
              Editar mundo
            </Link>
          )}
          {currentId && (
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

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {world?.worldMapUrl ? (
          <div className="relative max-h-full max-w-full">
            <img
              src={world.worldMapUrl}
              alt="Mapa de mundo"
              className="max-h-[calc(100vh-9rem)] w-auto rounded-md border border-gold/20"
              draggable={false}
            />
            {locations.map((loc) => {
              const isCurrent = loc.id === currentId;
              return (
                <button
                  key={loc.id}
                  type="button"
                  disabled={!canTravel}
                  onClick={() => canTravel && onTravel(loc)}
                  style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-full ${
                    canTravel ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  title={loc.name}
                >
                  <span className="flex flex-col items-center">
                    <span
                      className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[0.7rem] font-display tracking-wide ${
                        isCurrent
                          ? 'bg-gold text-night-950'
                          : 'border border-gold/40 bg-night-900/90 text-gold'
                      } ${canTravel ? 'hover:bg-gold hover:text-night-950' : ''}`}
                    >
                      {loc.name}
                      {isCurrent && ' · aquí'}
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
          </div>
        ) : (
          <div className="text-center text-bone/50">
            <p className="font-display text-lg">El DM aún no ha preparado el mapa de mundo.</p>
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
