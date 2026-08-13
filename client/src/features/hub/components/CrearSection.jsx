import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';

// Todas las puertas de entrada en un sitio: campaña larga, escaramuza en
// blanco, escenario ya montado y unirse con un código.
export default function CrearSection() {
  const { createCampaign, creating, joinCampaign } = useOutletContext();
  const [skirmishName, setSkirmishName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-ochre/40 bg-parchment-100/75 shadow-md">
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

      <section className="rounded-md border border-ochre/30 bg-parchment-100/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg text-ink">Escaramuza desde un escenario</h3>
            <p className="mt-1 max-w-xl text-sm text-ink/60">
              Tableros ya montados para hasta 6 jugadores: geometría, elevación, terreno, luces, trampas
              y enemigos colocados con sus estadísticas del SRD. Se abre y se dirige.
            </p>
          </div>
          <Link
            to="/campanas/escenarios"
            className="shrink-0 rounded-sm bg-ochre px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90"
          >
            Ver escenarios →
          </Link>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createCampaign('escaramuza', { name: skirmishName });
          }}
          className="rounded-md border border-ink/15 bg-parchment-100/45 p-4"
        >
          <h3 className="font-display text-lg text-ink">Escaramuza en blanco</h3>
          <p className="mt-1 text-sm text-ink/60">Un tablero vacío y el editor. Sin asistente, archivo ni mapa de mundo.</p>
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

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!joinCode.trim()) return;
            const result = await joinCampaign(joinCode);
            if (result?.ok) setJoinCode('');
          }}
          className="rounded-md border border-ink/15 bg-parchment-100/45 p-4"
        >
          <h3 className="font-display text-lg text-ink">Unirse a una mesa</h3>
          <p className="mt-1 text-sm text-ink/60">Introduce el código de invitación que te haya dado el DM.</p>
          <div className="mt-3 flex gap-2">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
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
    </div>
  );
}
