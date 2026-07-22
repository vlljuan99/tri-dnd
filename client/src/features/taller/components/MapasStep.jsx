import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import ConfirmationDialog from '../../../components/ConfirmationDialog.jsx';
import { mapActivationContext } from '../../../lib/confirmations.js';
import { useRoom } from '../../../store/socket.js';
import StepShell from './StepShell.jsx';

// Paso 5 — Mapas: los tableros tácticos de la campaña. Crear, activar y
// borrar se hace aquí; el dibujado fino (salas, muros, luces…) es el editor
// a pantalla completa, que al cerrarse devuelve a este paso.
export default function MapasStep({ progress }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const maps = progress.maps;
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [mapToDelete, setMapToDelete] = useState(null);
  const [activationRequest, setActivationRequest] = useState(null);
  const joinRoom = useRoom((state) => state.joinRoom);
  const roomCampaignId = useRoom((state) => state.campaignId);
  const roomIsLive = useRoom((state) => state.isLive);
  const online = useRoom((state) => state.online);
  const campaignId = Number(id);

  useEffect(() => {
    joinRoom(campaignId);
  }, [campaignId, joinRoom]);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      await progress.refreshResource('maps');
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createMap(event, openEditor = false) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const result = await run(() => api(`/campaigns/${id}/mapas`, { method: 'POST', body: { name } }));
    setNewName('');
    if (openEditor && result?.map) navigate(`/campanas/${id}/editor?mapa=${result.map.id}`);
  }

  async function renameMap(event, map) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || name === map.name) {
      setRenamingId(null);
      return;
    }
    const result = await run(() =>
      api(`/campaigns/${id}/mapas/${map.id}`, { method: 'PATCH', body: { name } })
    );
    if (result?.map) setRenamingId(null);
  }

  async function activateMap(map) {
    const result = await run(() =>
      api(`/campaigns/${id}/mapas/${map.id}/activar`, { method: 'POST' })
    );
    if (result?.map) setActivationRequest(null);
  }

  function requestActivation(map) {
    const sessionIsLive =
      roomCampaignId === campaignId ? roomIsLive : Boolean(progress.campaign?.isLive);
    const context = mapActivationContext({
      isLive: sessionIsLive,
      online: roomCampaignId === campaignId ? online : [],
      dmUserId: progress.campaign?.dmUserId,
    });
    if (context.requiresConfirmation) {
      setActivationRequest({ map, playerCount: context.playerCount, isLive: context.isLive });
    } else {
      activateMap(map);
    }
  }

  return (
    <StepShell
      progress={progress}
      stepId="mapas"
      description="Los tableros donde ocurren las escenas y los combates. «En la mesa» marca cuál está viendo el grupo ahora mismo. Ábrelos en el editor para dibujar salas, puertas, muros y colocar el reparto."
      maxWidth="max-w-4xl"
    >
      {error && <p className="mb-4 text-sm text-blood">{error}</p>}

      {maps?.length > 0 && <form onSubmit={createMap} className="mb-4 flex gap-2">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Nombre del nuevo mapa (Cripta inferior, Taberna del puerto…)"
          maxLength={80}
          className="min-w-0 flex-1 rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="shrink-0 rounded-sm bg-gold px-4 py-2 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
        >
          + Crear mapa
        </button>
      </form>}

      {maps === null ? (
        <p className="text-bone/50">Cargando…</p>
      ) : maps.length === 0 ? (
        <div className="rounded-md border border-dashed border-gold/25 bg-night-900/40 p-6 text-center">
          <p className="font-display text-xl text-gold">Crea tu primer tablero</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-bone/55">
            Ponle un nombre y entrarás directamente al lienzo. Allí podrás añadir la primera sala, importar un UVTT o usar una plantilla.
          </p>
          <form onSubmit={(event) => createMap(event, true)} className="mx-auto mt-4 flex max-w-xl flex-col gap-2 sm:flex-row">
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Cripta inferior, Taberna del puerto…"
              maxLength={80}
              className="min-w-0 flex-1 rounded-sm border border-gold/25 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="rounded-sm bg-gold px-4 py-2 font-display text-sm text-night-950 hover:bg-gold/90 disabled:opacity-40"
            >
              Crear y empezar →
            </button>
          </form>
          <Link
            to={`/campanas/${id}/editor`}
            className="mt-3 inline-block text-xs text-gold/70 underline hover:text-gold"
          >
            O abrir el editor para importar o usar una plantilla
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {maps.map((m) => (
            <li key={m.id} className="rounded-md border border-gold/15 bg-night-900 p-3">
              <div className="flex min-h-7 items-center justify-between gap-2">
                {renamingId === m.id ? (
                  <form onSubmit={(event) => renameMap(event, m)} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <input
                      autoFocus
                      value={renameValue}
                      maxLength={80}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                      aria-label={`Nuevo nombre para ${m.name}`}
                      className="min-w-0 flex-1 rounded-sm border border-gold/35 bg-night-950 px-2 py-1 font-display text-sm text-bone focus:border-gold focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busy || !renameValue.trim()}
                      className="rounded-sm bg-gold px-2 py-1 text-xs text-night-950 disabled:opacity-40"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenamingId(null)}
                      className="px-1 py-1 text-xs text-bone/50 hover:text-bone disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <p className="min-w-0 truncate font-display text-base text-bone">{m.name}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(m.id);
                        setRenameValue(m.name);
                      }}
                      className="shrink-0 rounded-sm px-1.5 py-0.5 text-[0.65rem] text-bone/45 hover:bg-bone/5 hover:text-gold disabled:opacity-40"
                      aria-label={`Renombrar ${m.name}`}
                    >
                      Renombrar
                    </button>
                  </div>
                )}
                {m.isActive && (
                  <span className="shrink-0 text-[0.65rem] font-medium uppercase tracking-widest text-sage">
                    ● En la mesa
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-bone/50">
                {m.floorCount} planta{m.floorCount === 1 ? '' : 's'} · {m.roomCount} sala
                {m.roomCount === 1 ? '' : 's'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to={`/campanas/${id}/editor?mapa=${m.id}`}
                  className="rounded-sm bg-gold/90 px-3 py-1.5 font-display text-xs tracking-wide text-night-950 hover:bg-gold"
                >
                  Abrir en el editor →
                </Link>
                {!m.isActive && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => requestActivation(m)}
                    className="rounded-sm border border-gold/30 px-2.5 py-1.5 text-xs text-gold/80 hover:bg-gold/10 disabled:opacity-40"
                  >
                    Llevar a la mesa
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMapToDelete(m)}
                  className="ml-auto rounded-sm border border-blood/30 px-2.5 py-1.5 text-xs text-blood/70 hover:text-blood disabled:opacity-40"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={Boolean(activationRequest)}
        tone="warning"
        title={`Llevar «${activationRequest?.map.name ?? ''}» a la mesa`}
        description={
          activationRequest
            ? activationRequest.isLive
              ? `La sesión está en vivo y ${activationRequest.playerCount} ${
                  activationRequest.playerCount === 1 ? 'jugador conectado verá' : 'jugadores conectados verán'
                } el cambio inmediatamente.`
              : `La sesión está cerrada, pero hay ${activationRequest.playerCount} ${
                  activationRequest.playerCount === 1 ? 'jugador conectado' : 'jugadores conectados'
                }. El cambio de tablero también se enviará a su mesa.`
            : ''
        }
        detail={
          activationRequest
            ? `El tablero activo cambiará de «${maps?.find((map) => map.isActive)?.name ?? 'sin mapa'}» a «${activationRequest.map.name}».`
            : null
        }
        confirmLabel="Cambiar tablero ahora"
        busy={busy}
        onCancel={() => setActivationRequest(null)}
        onConfirm={() => activateMap(activationRequest.map)}
      />

      <ConfirmationDialog
        open={Boolean(mapToDelete)}
        title={`Borrar «${mapToDelete?.name ?? ''}»`}
        description="Se eliminarán todas sus plantas, salas, puertas y marcadores. Esta acción no se puede deshacer."
        detail={mapToDelete?.isActive ? 'Este es el tablero activo: la mesa se quedará sin mapa.' : null}
        confirmLabel="Borrar mapa"
        busy={busy}
        onCancel={() => setMapToDelete(null)}
        onConfirm={async () => {
          const result = await run(() => api(`/campaigns/${id}/mapas/${mapToDelete.id}`, { method: 'DELETE' }));
          if (result?.ok) setMapToDelete(null);
        }}
      />
    </StepShell>
  );
}
