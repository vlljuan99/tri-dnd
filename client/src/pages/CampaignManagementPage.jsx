import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Panel de gestión del DM dentro de una campaña (Fase 16): organiza sus
// PNJ/jefes (personajes kind='boss') y qué objetos/hechizos de su biblioteca
// están asignados a esta campaña. Solo el DM.
export default function CampaignManagementPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reload() {
    api(`/campaigns/${id}/gestion`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    api(`/campaigns/${id}`).then(({ campaign: c }) => setCampaign(c)).catch((e) => setError(e.message));
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function toggleCharacter(character) {
    setBusy(true);
    setError('');
    try {
      await api(`/characters/${character.id}`, {
        method: 'PUT',
        body: { campaign_id: character.assigned ? null : Number(id) },
      });
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createNpc() {
    setBusy(true);
    setError('');
    try {
      const { character } = await api('/characters', { method: 'POST', body: { kind: 'boss' } });
      await api(`/characters/${character.id}`, { method: 'PUT', body: { campaign_id: Number(id) } });
      navigate(`/personajes/${character.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function toggleLibrary(tipo, entry) {
    const contentId = entry.index.replace('custom:', '');
    setBusy(true);
    setError('');
    try {
      await api(`/campaigns/${id}/biblioteca/${tipo}/${contentId}`, {
        method: entry.assigned ? 'DELETE' : 'PUT',
      });
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (campaign && campaign.role !== 'dm') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">Solo el DM puede gestionar la campaña.</p>
        <Link to={`/campanas/${id}`} className="text-gold underline">Volver a la mesa</Link>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-night-950 text-bone">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-2 flex items-center justify-between">
          <Link to={`/campanas/${id}`} className="font-display text-sm text-gold/80 hover:text-gold">← Mesa</Link>
          <Link to={`/campanas/${id}/editor`} className="font-display text-sm text-gold/80 hover:text-gold">Editor de mapas →</Link>
        </div>
        <h1 className="font-display text-2xl tracking-wide text-gold">Gestión de la campaña</h1>
        {campaign && <p className="mb-6 text-sm text-bone/60">{campaign.name}</p>}

        {error && <p className="mb-4 text-sm text-blood">{error}</p>}
        {!data ? (
          <p className="text-bone/50">Cargando…</p>
        ) : (
          <div className="space-y-8">
            {/* PNJ y jefes */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg tracking-wide text-gold">PNJ y jefes</h2>
                <div className="flex gap-2">
                  <button
                    onClick={createNpc}
                    disabled={busy}
                    className="rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
                  >
                    + Crear PNJ
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-bone/50">
                Los personajes del DM sirven como jefes (marcador enemigo) o como PNJ aliados (marcador aliado)
                en el editor. Asignar uno a esta campaña lo agrupa aquí para tenerlo a mano.
              </p>
              {data.characters.length === 0 ? (
                <p className="italic text-bone/50">Aún no tienes personajes de DM. Crea el primero arriba.</p>
              ) : (
                <ul className="space-y-2">
                  {data.characters.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-md border border-gold/15 bg-night-900 p-3"
                    >
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-gold/25 bg-night-950">
                        {c.avatarUrl && <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-bone">{c.name}</p>
                        <p className="font-mono text-xs text-bone/50">PG {c.hpMax} · CA {c.ac}</p>
                      </div>
                      {c.otherCampaign && !c.assigned && (
                        <span className="text-[0.65rem] uppercase tracking-widest text-ochre/80" title="Asignado a otra campaña">
                          en otra campaña
                        </span>
                      )}
                      <Link
                        to={`/personajes/${c.id}`}
                        className="rounded-sm border border-gold/25 px-2 py-1 text-xs text-gold/80 hover:bg-gold/10"
                      >
                        Editar ficha
                      </Link>
                      <button
                        onClick={() => toggleCharacter(c)}
                        disabled={busy}
                        className={`rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
                          c.assigned
                            ? 'border-sage/60 text-sage hover:bg-sage/10'
                            : 'border-bone/25 text-bone/70 hover:border-gold hover:text-gold'
                        }`}
                      >
                        {c.assigned ? 'En la campaña ✓' : 'Añadir a la campaña'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Biblioteca asignada */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg tracking-wide text-gold">Biblioteca en esta campaña</h2>
                <Link
                  to="/biblioteca"
                  className="rounded-sm border border-gold/25 px-3 py-1.5 text-sm text-gold/80 hover:bg-gold/10"
                >
                  Editar biblioteca ↗
                </Link>
              </div>
              <p className="mb-3 text-xs text-bone/50">
                Marca qué objetos y hechizos de tu biblioteca pertenecen a esta campaña, para tenerlos
                reunidos (por ejemplo, el botín o los hechizos de tus PNJ).
              </p>
              {['objetos', 'hechizos'].map((tipo) => (
                <div key={tipo} className="mb-4">
                  <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold/70">
                    {tipo === 'objetos' ? 'Objetos' : 'Hechizos'}
                  </h3>
                  {data.library[tipo].length === 0 ? (
                    <p className="text-xs italic text-bone/40">
                      Nada en tu biblioteca todavía. Créalos desde «Editar biblioteca».
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {data.library[tipo].map((entry) => (
                        <li
                          key={entry.index}
                          className="flex items-center gap-3 rounded-sm border border-bone/10 bg-night-900/60 px-3 py-2"
                        >
                          <span className="flex-1 truncate text-sm">{entry.name}</span>
                          <button
                            onClick={() => toggleLibrary(tipo, entry)}
                            disabled={busy}
                            className={`rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
                              entry.assigned
                                ? 'border-sage/60 text-sage hover:bg-sage/10'
                                : 'border-bone/25 text-bone/70 hover:border-gold hover:text-gold'
                            }`}
                          >
                            {entry.assigned ? 'En la campaña ✓' : 'Añadir'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
