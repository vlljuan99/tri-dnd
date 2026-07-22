import { Link, useParams } from 'react-router-dom';
import StepShell from './StepShell.jsx';

// Paso 3 — Mundo: resumen del mapa de mundo y sus capas. El editor en sí es
// un modo a pantalla completa (/campanas/:id/mundo) que al cerrarse devuelve
// aquí; este paso da el contexto y el estado sin abandonar el taller.
export default function MundoStep({ progress }) {
  const { id } = useParams();
  // TallerLayout ya cargó este recurso para calcular el progreso. Reutilizarlo
  // evita pedir /mundo dos veces cada vez que se abre el paso.
  const world = progress.world;

  const maps = world?.maps ?? [];
  const rootMap = maps.find((m) => m.id === world?.rootMapId) ?? maps[0] ?? null;
  const totalLocations = maps.reduce((sum, m) => sum + (m.locations ?? []).length, 0);

  return (
    <StepShell
      progress={progress}
      stepId="mundo"
      description="El mapa por el que viaja el grupo: una imagen con ubicaciones, y submapas para ciudades o regiones. Cada ubicación puede enlazar con un mapa táctico del paso Mapas."
    >
      <div className="rounded-md border border-gold/20 bg-night-900/70 p-4">
        {!world ? (
          <p className="text-sm text-bone/50">Cargando el mundo…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-24 w-36 shrink-0 overflow-hidden rounded-sm border border-gold/20 bg-night-950">
              {rootMap?.imageUrl ? (
                <img src={rootMap.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-2 text-center text-[0.65rem] text-bone/35">
                  Sin imagen del mundo todavía
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg text-bone">{rootMap?.name ?? 'Mapa de mundo'}</p>
              <p className="mt-1 text-sm text-bone/55">
                {maps.length} capa{maps.length === 1 ? '' : 's'} ·{' '}
                {totalLocations} {totalLocations === 1 ? 'ubicación' : 'ubicaciones'}
              </p>
              <p className="mt-1 text-xs text-bone/40">
                {rootMap?.imageUrl
                  ? 'Añade o recoloca ubicaciones desde el editor del mundo.'
                  : 'Empieza subiendo o generando la imagen del mundo en el editor.'}
              </p>
            </div>
            <Link
              to={`/campanas/${id}/mundo`}
              className="shrink-0 rounded-sm bg-gold px-4 py-2 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
            >
              Abrir el editor del mundo →
            </Link>
          </div>
        )}
      </div>

      {maps.length > 1 && (
        <ul className="mt-4 space-y-1.5">
          {maps.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-sm border border-bone/10 bg-night-900/60 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {m.name}
                {m.id === world.rootMapId && (
                  <span className="ml-2 rounded-sm border border-gold/25 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-gold/70">
                    raíz
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-bone/45">
                {(m.locations ?? []).length} {(m.locations ?? []).length === 1 ? 'ubicación' : 'ubicaciones'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StepShell>
  );
}
