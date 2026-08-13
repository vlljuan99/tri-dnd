import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../../api.js';

// Escenarios de escaramuza: los que vienen con la app (de fábrica, listos para
// jugar) y los que el DM haya guardado desde una escaramuza suya. Crear desde
// cualquiera de ellos monta el tablero completo, revela las salas de inicio y
// mete a los enemigos a la vista en el tracker de iniciativa.
function PresetCard({ preset, onCreate, busy }) {
  return (
    <li className="flex flex-col rounded-md border border-ochre/30 bg-parchment-100/70 p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-lg font-semibold text-ink">{preset.name}</h4>
        <span className="shrink-0 font-mono text-[0.65rem] uppercase tracking-widest text-ochre">
          nivel {preset.suggestedLevel}
        </span>
      </div>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink/70">{preset.summary}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {preset.tags.map((tag) => (
          <span key={tag} className="rounded-sm border border-ink/15 px-1.5 py-0.5 text-[0.65rem] text-ink/55">
            {tag}
          </span>
        ))}
      </div>

      <p className="mt-3 font-mono text-[0.7rem] text-ink/45">
        hasta {preset.players} jugadores · {preset.floors} {preset.floors === 1 ? 'planta' : 'plantas'} ·{' '}
        {preset.rooms} {preset.rooms === 1 ? 'sala' : 'salas'} · {preset.enemies} enemigos
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => onCreate(preset)}
        className="mt-3 rounded-sm bg-ochre px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90 disabled:opacity-40"
      >
        {busy ? 'Montando la mesa…' : 'Montar esta partida'}
      </button>
    </li>
  );
}

export default function EscenariosSection() {
  const { createCampaign, creating, setError } = useOutletContext();
  const [presets, setPresets] = useState(null);
  const [templates, setTemplates] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api('/campaigns/escaramuzas/predefinidas'), api('/plantillas?tipo=escaramuza')])
      .then(([presetResponse, templateResponse]) => {
        if (cancelled) return;
        setPresets(presetResponse.presets ?? []);
        setTemplates(templateResponse.templates ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  async function removeTemplate(template) {
    setError('');
    try {
      await api(`/plantillas/${template.id}`, { method: 'DELETE' });
      setTemplates((rows) => rows.filter((row) => row.id !== template.id));
    } catch (cause) {
      setError(cause.message);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3 border-b border-ochre/25 pb-2">
          <h3 className="font-display text-2xl text-ink">Listos para jugar</h3>
          <span className="text-xs text-ink/45">Escenarios de fábrica, pensados para 6 jugadores</span>
        </div>
        {presets === null ? (
          <p className="text-ink/60">Cargando…</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                busy={creating}
                onCreate={(chosen) => createCampaign('escaramuza', { presetId: chosen.id })}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3 border-b border-ink/15 pb-2">
          <h3 className="font-display text-xl text-ink/80">Tus escenarios guardados</h3>
          <span className="text-xs text-ink/45">Desde «Escaramuzas», con «Guardar como escenario»</span>
        </div>
        {templates === null ? (
          <p className="text-ink/60">Cargando…</p>
        ) : templates.length === 0 ? (
          <p className="italic text-ink/55">
            Todavía no has guardado ninguno. Monta una escaramuza a tu gusto en el editor y guárdala desde
            la pestaña «Escaramuzas» para volver a usarla cuando quieras.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <li key={template.id} className="rounded-md border border-ink/15 bg-parchment-100/60 p-3">
                <p className="font-display text-base text-ink">{template.name}</p>
                <p className="mt-1 font-mono text-[0.7rem] text-ink/45">
                  {template.meta?.floors ?? 1} plantas · {template.meta?.rooms ?? 0} salas ·{' '}
                  {template.meta?.tokens ?? 0} marcadores
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => createCampaign('escaramuza', { templateId: template.id })}
                    className="rounded-sm bg-ochre px-3 py-1.5 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90 disabled:opacity-40"
                  >
                    Montar partida
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTemplate(template)}
                    className="rounded-sm border border-ember/40 px-2 py-1.5 text-xs text-ember hover:bg-ember/10"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
