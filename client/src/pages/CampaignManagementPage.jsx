import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import CampaignEventsPanel from '../components/CampaignEventsPanel.jsx';

const settingsInputClass =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none disabled:opacity-50';
const settingsLabelClass = 'flex flex-col gap-1 text-xs uppercase tracking-wider text-bone/50';

function settingsFromCampaign(campaign) {
  return {
    name: campaign.name ?? '',
    description: campaign.description ?? '',
    maxPlayers: campaign.maxPlayers == null ? '' : String(campaign.maxPlayers),
    lore: campaign.lore ?? '',
    objectives: (campaign.objectives ?? []).join('\n'),
  };
}

// Panel permanente del DM: identidad y presentación pública de la campaña,
// PNJ/enemigos, eventos y recursos asignados. Solo el DM.
export default function CampaignManagementPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reload() {
    api(`/campaigns/${id}/gestion`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    api(`/campaigns/${id}`)
      .then(({ campaign: c }) => {
        setCampaign(c);
        setSettings(settingsFromCampaign(c));
      })
      .catch((e) => setError(e.message));
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

  async function createDmCharacter(dmCategory) {
    setBusy(true);
    setError('');
    try {
      const { character } = await api('/characters', {
        method: 'POST',
        body: { kind: 'boss', dm_category: dmCategory },
      });
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

  function changeSetting(field, value) {
    setSettings((current) => ({ ...current, [field]: value }));
    setError('');
    setSettingsNotice('');
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!settings) return;

    const name = settings.name.trim();
    if (!name) {
      setError('La campaña necesita un nombre.');
      return;
    }

    const maxPlayers = settings.maxPlayers === '' ? null : Number(settings.maxPlayers);
    if (maxPlayers !== null && (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 20)) {
      setError('Las plazas deben ser un número entre 1 y 20.');
      return;
    }

    const objectives = settings.objectives
      .split('\n')
      .map((objective) => objective.trim())
      .filter(Boolean);
    if (objectives.length > 30) {
      setError('Puedes publicar como máximo 30 objetivos.');
      return;
    }
    if (objectives.some((objective) => objective.length > 200)) {
      setError('Cada objetivo puede ocupar como máximo 200 caracteres.');
      return;
    }

    const narrativeCampaign =
      (campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza')) === 'campana';
    const body = { name, maxPlayers };
    if (narrativeCampaign) {
      Object.assign(body, {
        description: settings.description,
        lore: settings.lore,
        objectives,
      });
    }

    setBusy(true);
    setError('');
    setSettingsNotice('');
    try {
      const { campaign: updated } = await api(`/campaigns/${id}`, { method: 'PATCH', body });
      setCampaign(updated);
      setSettings(settingsFromCampaign(updated));
      setSettingsNotice('Ajustes guardados ✓');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const narrativeCampaign =
    campaign && (campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza')) === 'campana';

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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to={`/campanas/${id}`} className="font-display text-sm text-gold/80 hover:text-gold">← Mesa</Link>
            {campaign &&
              (campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza')) === 'campana' && (
                <Link
                  to={`/campanas/${id}/archivo`}
                  className="rounded-sm border border-gold/30 px-2.5 py-1 font-display text-sm text-gold hover:bg-gold/10"
                >
                  Archivo del DM
                </Link>
              )}
          </div>
          <Link to={`/campanas/${id}/editor`} className="font-display text-sm text-gold/80 hover:text-gold">Editor de mapas →</Link>
        </div>
        <h1 className="font-display text-2xl tracking-wide text-gold">Gestión de la campaña</h1>
        {campaign && <p className="mb-6 text-sm text-bone/60">{campaign.name}</p>}

        {error && <p className="mb-4 text-sm text-blood">{error}</p>}
        {!data ? (
          <p className="text-bone/50">Cargando…</p>
        ) : (
          <div className="space-y-8">
            {/* Ajustes permanentes: el asistente solo es la primera visita. */}
            {settings && (
              <section className="rounded-md border border-gold/20 bg-night-900/70 p-4">
                <form onSubmit={saveSettings}>
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg tracking-wide text-gold">
                        {narrativeCampaign ? 'Ajustes de campaña' : 'Ajustes de la escaramuza'}
                      </h2>
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-bone/50">
                        {narrativeCampaign
                          ? 'Edita aquí la identidad y la presentación pública. El lore privado y los recursos narrativos siguen en el Archivo del DM.'
                          : 'La partida rápida solo necesita su nombre y el número de plazas.'}
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={busy || !settings.name.trim()}
                      className="rounded-sm bg-gold px-4 py-2 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
                    >
                      {busy ? 'Guardando…' : 'Guardar ajustes'}
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <label className={settingsLabelClass}>
                      Nombre
                      <input
                        value={settings.name}
                        onChange={(event) => changeSetting('name', event.target.value)}
                        maxLength={80}
                        required
                        className={`${settingsInputClass} normal-case tracking-normal`}
                      />
                    </label>
                    <label className={settingsLabelClass}>
                      Plazas
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={settings.maxPlayers}
                        onChange={(event) => changeSetting('maxPlayers', event.target.value)}
                        placeholder="Sin límite"
                        className={`${settingsInputClass} font-mono normal-case tracking-normal`}
                      />
                    </label>
                  </div>

                  {narrativeCampaign && (
                    <div className="mt-4 space-y-4 border-t border-bone/10 pt-4">
                      <label className={settingsLabelClass}>
                        Concepto / sinopsis
                        <textarea
                          value={settings.description}
                          onChange={(event) => changeSetting('description', event.target.value)}
                          rows={4}
                          maxLength={2000}
                          placeholder="La premisa central de la campaña…"
                          className={`${settingsInputClass} resize-y normal-case tracking-normal`}
                        />
                        <span className="text-right font-mono text-[0.65rem] text-bone/35">
                          {settings.description.length}/2000
                        </span>
                      </label>

                      <label className={settingsLabelClass}>
                        Introducción pública
                        <textarea
                          value={settings.lore}
                          onChange={(event) => changeSetting('lore', event.target.value)}
                          rows={7}
                          maxLength={5000}
                          placeholder="Lo que el grupo conoce al comenzar la aventura…"
                          className={`${settingsInputClass} resize-y normal-case tracking-normal`}
                        />
                        <span className="text-xs normal-case tracking-normal text-bone/40">
                          Aparece en el diario del campamento; no incluyas aquí secretos del DM.
                        </span>
                      </label>

                      <label className={settingsLabelClass}>
                        Objetivos conocidos
                        <textarea
                          value={settings.objectives}
                          onChange={(event) => changeSetting('objectives', event.target.value)}
                          rows={5}
                          placeholder={'Encontrar la espada perdida\nDescubrir quién controla el puerto'}
                          className={`${settingsInputClass} resize-y normal-case tracking-normal`}
                        />
                        <span className="text-xs normal-case tracking-normal text-bone/40">
                          Un objetivo por línea, hasta 30.
                        </span>
                      </label>
                    </div>
                  )}

                  {settingsNotice && <p className="mt-3 text-sm text-sage">{settingsNotice}</p>}
                </form>
              </section>
            )}

            {/* PNJ, enemigos y jefes */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg tracking-wide text-gold">PNJ, enemigos y jefes</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => createDmCharacter('pnj')}
                    disabled={busy}
                    className="rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
                  >
                    + Crear PNJ
                  </button>
                  <button
                    onClick={() => createDmCharacter('enemigo')}
                    disabled={busy}
                    className="rounded-sm border border-blood/50 px-3 py-1.5 font-display text-sm tracking-wide text-blood hover:bg-blood/10 disabled:opacity-40"
                  >
                    + Crear enemigo
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-bone/50">
                Las fichas del DM se organizan como PNJ, enemigos o jefes y después pueden colocarse como
                marcadores aliados u hostiles. Asignarlas a esta campaña las agrupa aquí para tenerlas a mano.
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
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate font-display text-bone">{c.name}</p>
                          <span className="rounded-sm border border-gold/25 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-gold/70">
                            {c.dmCategory === 'enemigo' ? 'Enemigo' : c.dmCategory === 'pnj' ? 'PNJ' : 'Jefe'}
                          </span>
                        </div>
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

            {/* Eventos y efectos (Fases 18/19) */}
            <CampaignEventsPanel campaignId={id} />

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
