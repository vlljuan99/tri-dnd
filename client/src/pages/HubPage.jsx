import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// Lista funcional de campañas. La escena ilustrada de mapa de mundo con
// localizaciones seleccionables llega en la fase 9.
export default function HubPage() {
  const [campaigns, setCampaigns] = useState(null);
  const [newName, setNewName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('');
  const [lore, setLore] = useState('');
  const [objectives, setObjectives] = useState('');
  const [hasWorldMap, setHasWorldMap] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/campaigns').then(({ campaigns }) => setCampaigns(campaigns)).catch((e) => setError(e.message));
  }, []);

  async function createCampaign(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    try {
      const { campaign } = await api('/campaigns', {
        method: 'POST',
        body: {
          name: newName,
          maxPlayers: maxPlayers.trim() ? Number(maxPlayers) : null,
          lore,
          objectives: objectives
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          hasWorldMap,
        },
      });
      setCampaigns((cs) => [campaign, ...(cs ?? [])]);
      setNewName('');
      setMaxPlayers('');
      setLore('');
      setObjectives('');
      setHasWorldMap(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCampaign(campaign) {
    const sure = window.confirm(
      `¿Borrar la campaña "${campaign.name}"? Se perderán su chat, mesa y mapas. Las fichas de personaje se conservan.`
    );
    if (!sure) return;
    setError('');
    try {
      await api(`/campaigns/${campaign.id}`, { method: 'DELETE' });
      setCampaigns((cs) => cs.filter((c) => c.id !== campaign.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinCampaign(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setError('');
    try {
      const { campaign } = await api('/campaigns/join', { method: 'POST', body: { code: joinCode } });
      setCampaigns((cs) => (cs?.some((c) => c.id === campaign.id) ? cs : [campaign, ...(cs ?? [])]));
      setJoinCode('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h2 className="mb-6 font-display text-3xl font-semibold text-ink">Tus campañas</h2>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <form
          onSubmit={createCampaign}
          className="flex flex-col gap-2 rounded-md border border-ink/15 bg-parchment-100/40 p-3"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nueva campaña (serás el DM)"
            required
            className="rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-ink placeholder:text-ink/40 focus:border-ochre focus:outline-none"
          />
          <input
            type="number"
            min={1}
            max={20}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(e.target.value)}
            placeholder="Plazas (sin límite si se deja vacío)"
            className="rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-ink placeholder:text-ink/40 focus:border-ochre focus:outline-none"
          />
          <textarea
            value={lore}
            onChange={(e) => setLore(e.target.value)}
            placeholder="Lore de apertura (se enseña a los jugadores al entrar)"
            rows={3}
            className="rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-ink placeholder:text-ink/40 focus:border-ochre focus:outline-none"
          />
          <textarea
            value={objectives}
            onChange={(e) => setObjectives(e.target.value)}
            placeholder="Objetivos, uno por línea"
            rows={3}
            className="rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-ink placeholder:text-ink/40 focus:border-ochre focus:outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-ink/80">
            <input
              type="checkbox"
              checked={hasWorldMap}
              onChange={(e) => setHasWorldMap(e.target.checked)}
              className="h-4 w-4 accent-ochre"
            />
            Forma parte de un mapa de mundo (viajarás entre ubicaciones)
          </label>
          <button
            type="submit"
            disabled={!newName.trim()}
            className="rounded-sm bg-ember px-4 py-2 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40 disabled:hover:bg-ember"
          >
            Crear
          </button>
        </form>
        <form onSubmit={joinCampaign} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Código de invitación"
            maxLength={6}
            required
            className="flex-1 rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 font-mono uppercase tracking-widest text-ink placeholder:font-body placeholder:normal-case placeholder:tracking-normal placeholder:text-ink/40 focus:border-ochre focus:outline-none"
          />
          <button
            type="submit"
            disabled={!joinCode.trim()}
            className="rounded-sm bg-sage px-4 font-display tracking-wide text-parchment-100 hover:bg-sage/90 disabled:opacity-40 disabled:hover:bg-sage"
          >
            Unirse
          </button>
        </form>
      </div>

      {error && <p className="mb-4 text-sm text-ember">{error}</p>}
      {campaigns === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : campaigns.length === 0 ? (
        <p className="italic text-ink/60">
          Sin campañas todavía. Crea una para dirigirla o únete con el código que te pase tu DM.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {campaigns.map((c) => (
            <li key={c.id} className="rounded-md border border-ink/20 bg-parchment-100/70 p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg font-semibold text-ink">{c.name}</span>
                {c.isLive && (
                  <span className="flex items-center gap-1 text-xs font-medium text-ember">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> en vivo
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink/70">
                {c.role === 'dm' ? 'Eres el DM' : 'Jugador'}
                {c.role === 'dm' && (
                  <>
                    {' · invitación: '}
                    <span className="font-mono tracking-widest">{c.inviteCode}</span>
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={`/campanas/${c.id}`}
                  className="inline-block rounded-sm bg-ochre px-3 py-1.5 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90"
                >
                  Ir a la mesa de juego
                </Link>
                <div className="flex items-center gap-2">
                  {c.role === 'dm' && c.hasWorldMap && (
                    <Link
                      to={`/campanas/${c.id}/mundo`}
                      className="rounded-sm border border-ochre/50 px-2 py-1.5 text-xs text-ochre hover:bg-ochre/10"
                    >
                      Mapa de mundo
                    </Link>
                  )}
                  {c.role === 'dm' && (
                    <button
                      type="button"
                      onClick={() => deleteCampaign(c)}
                      className="rounded-sm border border-ember/40 px-2 py-1.5 text-xs text-ember hover:bg-ember/10"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
