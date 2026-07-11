import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Eventos del DM (Fases 18/19) en la gestión de la campaña: biblioteca
// reutilizable (crear/editar/borrar) y enlaces a esta campaña (toda la
// campaña, una sala o un marcador). Los disparadores automáticos ('rondas',
// 'revelar') publican un mensaje de sistema en el chat al cumplirse; los
// 'manual' son recordatorios a la vista del DM.

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50 mb-1';

const TRIGGER_LABELS = {
  manual: 'Manual (a la vista del DM)',
  rondas: 'Cada N rondas',
  revelar: 'Al revelarse la sala',
};

const emptyForm = () => ({ name: '', effect: '', description: '', triggerKind: 'manual', triggerEvery: 3, hidden: false });

function EventForm({ initial, busy, onSave, onCancel }) {
  const [form, setForm] = useState(() => (initial ? { ...initial } : emptyForm()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-2.5 rounded-sm border border-gold/25 bg-night-950/40 p-3">
      <label className="block">
        <span className={labelClass}>Nombre</span>
        <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Oscuridad total" />
      </label>
      <label className="block">
        <span className={labelClass}>Efecto / consecuencia</span>
        <input className={inputClass} value={form.effect} onChange={(e) => set('effect', e.target.value)} placeholder="-1 a percepción para todos" />
      </label>
      <label className="block">
        <span className={labelClass}>Descripción (opcional)</span>
        <textarea className={`${inputClass} resize-y`} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Notas largas para ti" />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={labelClass}>Disparador</span>
          <select className={inputClass} value={form.triggerKind} onChange={(e) => set('triggerKind', e.target.value)}>
            {Object.entries(TRIGGER_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        {form.triggerKind === 'rondas' && (
          <label className="block">
            <span className={labelClass}>Cada</span>
            <span className="flex items-center gap-1 text-xs text-bone/60">
              <input
                type="number"
                min={1}
                max={100}
                value={form.triggerEvery}
                onChange={(e) => set('triggerEvery', Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-16 rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-center font-mono text-sm text-bone"
              />
              rondas
            </span>
          </label>
        )}
        <label className="flex items-center gap-1.5 pb-2 text-xs text-bone/70">
          <input type="checkbox" checked={form.hidden} onChange={(e) => set('hidden', e.target.checked)} />
          Aviso oculto (solo lo ves tú)
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !form.name.trim()}
          onClick={() => onSave(form)}
          className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
        >
          Guardar
        </button>
        <button type="button" onClick={onCancel} className="rounded-sm border border-bone/25 px-4 py-1.5 text-sm text-bone/70 hover:bg-bone/5">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function CampaignEventsPanel({ campaignId }) {
  const [events, setEvents] = useState([]);
  const [links, setLinks] = useState([]);
  const [targets, setTargets] = useState({ rooms: [], tokens: [] });
  const [editing, setEditing] = useState(null); // null | 'new' | event
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Formulario de enlace: qué evento y dónde
  const [linkEventId, setLinkEventId] = useState('');
  const [linkTargetType, setLinkTargetType] = useState('campana');
  const [linkTargetId, setLinkTargetId] = useState('');

  function reload() {
    api('/eventos').then(({ events }) => setEvents(events)).catch((e) => setError(e.message));
    api(`/campaigns/${campaignId}/eventos`)
      .then((data) => {
        setLinks(data.links);
        setTargets(data.targets);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const saveEvent = (form) =>
    run(async () => {
      if (editing === 'new') await api('/eventos', { method: 'POST', body: form });
      else await api(`/eventos/${editing.id}`, { method: 'PUT', body: form });
      setEditing(null);
    });

  const deleteEvent = (event) => {
    if (!window.confirm(`¿Borrar el evento "${event.name}" y todos sus enlaces?`)) return;
    run(() => api(`/eventos/${event.id}`, { method: 'DELETE' }));
  };

  const addLink = () =>
    run(() =>
      api(`/campaigns/${campaignId}/eventos`, {
        method: 'POST',
        body: {
          eventId: Number(linkEventId),
          targetType: linkTargetType,
          targetId: linkTargetType === 'campana' ? null : Number(linkTargetId),
        },
      })
    );

  const triggerSummary = (event) =>
    event.triggerKind === 'rondas'
      ? `cada ${event.triggerEvery} ronda${event.triggerEvery === 1 ? '' : 's'}`
      : event.triggerKind === 'revelar'
        ? 'al revelarse'
        : 'manual';

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg tracking-wide text-gold">Eventos y efectos</h2>
        <button
          onClick={() => setEditing('new')}
          className="rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
        >
          + Crear evento
        </button>
      </div>
      <p className="mb-3 text-xs text-bone/50">
        Pasivas y consecuencias reutilizables (ej.: «oscuridad total: −1 a percepción»). Cuélgalos de la
        campaña, una sala o un enemigo; los de rondas y revelado saltan solos como mensaje en el chat.
      </p>

      {error && <p className="mb-3 text-sm text-blood">{error}</p>}
      {editing && (
        <div className="mb-4">
          <EventForm
            initial={editing === 'new' ? null : editing}
            busy={busy}
            onSave={saveEvent}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {/* Biblioteca de eventos */}
      {events.length === 0 ? (
        <p className="mb-4 text-xs italic text-bone/40">Sin eventos todavía: crea el primero arriba.</p>
      ) : (
        <ul className="mb-4 space-y-1.5">
          {events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 rounded-sm border border-bone/10 bg-night-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-bone">
                  {event.name}
                  {event.hidden && <span className="ml-1.5 text-[0.6rem] uppercase tracking-widest text-bone/40">oculto</span>}
                </p>
                <p className="truncate text-xs text-bone/50">
                  {triggerSummary(event)}
                  {event.effect ? ` · ${event.effect}` : ''}
                </p>
              </div>
              <button onClick={() => setEditing(event)} className="rounded-sm border border-bone/25 px-2 py-1 text-xs text-bone/70 hover:border-gold hover:text-gold">
                Editar
              </button>
              <button onClick={() => deleteEvent(event)} disabled={busy} className="rounded-sm border border-blood/40 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40">
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Colgar un evento en esta campaña */}
      {events.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-sm border border-gold/15 bg-night-950/40 p-3">
          <label className="block">
            <span className={labelClass}>Evento</span>
            <select className={inputClass} value={linkEventId} onChange={(e) => setLinkEventId(e.target.value)}>
              <option value="">— elegir —</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Dónde</span>
            <select
              className={inputClass}
              value={linkTargetType}
              onChange={(e) => {
                setLinkTargetType(e.target.value);
                setLinkTargetId('');
              }}
            >
              <option value="campana">Toda la campaña</option>
              <option value="sala">Una sala</option>
              <option value="marcador">Un marcador</option>
            </select>
          </label>
          {linkTargetType !== 'campana' && (
            <label className="block">
              <span className={labelClass}>{linkTargetType === 'sala' ? 'Sala' : 'Marcador'}</span>
              <select className={inputClass} value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                <option value="">— elegir —</option>
                {(linkTargetType === 'sala' ? targets.rooms : targets.tokens).map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={addLink}
            disabled={busy || !linkEventId || (linkTargetType !== 'campana' && !linkTargetId)}
            className="rounded-sm border border-gold/30 px-3 py-1.5 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Colgar en la campaña
          </button>
        </div>
      )}

      {/* Enlaces activos */}
      <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold/70">En esta campaña</h3>
      {links.length === 0 ? (
        <p className="text-xs italic text-bone/40">Nada colgado todavía.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-3 rounded-sm border border-bone/10 bg-night-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-bone">
                  {link.event.name} <span className="text-bone/40">→</span>{' '}
                  <span className="text-bone/70">{link.targetName}</span>
                </p>
                <p className="text-xs text-bone/50">
                  {triggerSummary(link.event)}
                  {link.fired && ' · ya disparado'}
                  {link.lastFiredRound != null && ` · última ronda ${link.lastFiredRound}`}
                </p>
              </div>
              {(link.fired || link.lastFiredRound != null) && (
                <button
                  onClick={() => run(() => api(`/campaigns/${campaignId}/eventos/${link.id}/rearmar`, { method: 'POST' }))}
                  disabled={busy}
                  className="rounded-sm border border-sage/60 px-2 py-1 text-xs text-sage hover:bg-sage/10 disabled:opacity-40"
                >
                  Rearmar
                </button>
              )}
              <button
                onClick={() => run(() => api(`/campaigns/${campaignId}/eventos/${link.id}`, { method: 'DELETE' }))}
                disabled={busy}
                className="rounded-sm border border-blood/40 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
