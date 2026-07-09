import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Hub de campañas: crearlas es un asistente guiado (como los personajes),
// no un formulario de una sola pantalla — aquí solo se elige el tipo y se
// entra al asistente con el borrador recién creado.
export default function HubPage() {
  const [campaigns, setCampaigns] = useState(null);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api('/campaigns').then(({ campaigns }) => setCampaigns(campaigns)).catch((e) => setError(e.message));
  }, []);

  async function createCampaign(hasWorldMap) {
    setCreating(true);
    setError('');
    try {
      const { campaign } = await api('/campaigns', { method: 'POST', body: { hasWorldMap } });
      navigate(`/campanas/${campaign.id}/asistente`);
    } catch (err) {
      setError(err.message);
      setCreating(false);
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
        <div className="flex flex-col gap-2 rounded-md border border-ink/15 bg-parchment-100/40 p-3">
          <p className="text-sm text-ink/70">Crear una campaña abre un asistente guiado, paso a paso.</p>
          <button
            type="button"
            onClick={() => createCampaign(false)}
            disabled={creating}
            title="Un solo tablero, para partidas rápidas sin lore ni objetivos"
            className="rounded-sm bg-ember px-4 py-2 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
          >
            + Nueva escaramuza
          </button>
          <button
            type="button"
            onClick={() => createCampaign(true)}
            disabled={creating}
            title="Lore, objetivos y un mapa de mundo con varios tableros enlazados"
            className="rounded-sm border border-ink/30 px-4 py-2 font-display tracking-wide text-ink hover:bg-ink/5 disabled:opacity-40"
          >
            + Nueva campaña
          </button>
        </div>
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
                {c.status === 'draft' ? (
                  <span className="shrink-0 rounded-sm border border-ochre/50 bg-ochre/10 px-1.5 py-0.5 font-mono text-xs text-ochre">
                    Borrador
                  </span>
                ) : (
                  c.isLive && (
                    <span className="flex items-center gap-1 text-xs font-medium text-ember">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> en vivo
                    </span>
                  )
                )}
              </div>
              <p className="mt-1 text-sm text-ink/70">
                {c.role === 'dm' ? 'Eres el DM' : 'Jugador'} · {c.hasWorldMap ? 'Campaña' : 'Escaramuza'}
                {c.role === 'dm' && (
                  <>
                    {' · invitación: '}
                    <span className="font-mono tracking-widest">{c.inviteCode}</span>
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={c.status === 'draft' ? `/campanas/${c.id}/asistente` : `/campanas/${c.id}`}
                  className="inline-block rounded-sm bg-ochre px-3 py-1.5 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90"
                >
                  {c.status === 'draft' ? 'Continuar asistente' : 'Ir a la mesa de juego'}
                </Link>
                <div className="flex items-center gap-2">
                  {c.role === 'dm' && c.status === 'complete' && (
                    <Link
                      to={c.hasWorldMap ? `/campanas/${c.id}/mundo` : `/campanas/${c.id}/editor`}
                      className="rounded-sm border border-ochre/50 px-2 py-1.5 text-xs text-ochre hover:bg-ochre/10"
                    >
                      {c.hasWorldMap ? 'Mapa de mundo' : 'Editor'}
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
