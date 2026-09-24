import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../../api.js';
import PresetFiguresDialog from './PresetFiguresDialog.jsx';

// Los tres escenarios de fábrica son partidas sin DM y exigen elegir un PJ.
// Las plantillas propias conservan el flujo de escaramuza dirigida de siempre.
function PresetCard({ preset, onCreate, onEditImages, busy, disabled, characterLevel }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-md border border-ochre/30 bg-parchment-100/70 shadow-sm">
      {preset.previewUrl && (
        <img
          src={preset.previewUrl}
          alt={`Mapa de ${preset.name}`}
          className="aspect-[4/3] w-full border-b border-ochre/20 object-cover"
        />
      )}
      <div className="flex flex-1 flex-col p-4">
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
          1 aventurero · {preset.floors} {preset.floors === 1 ? 'planta' : 'plantas'} ·{' '}
          {preset.rooms} {preset.rooms === 1 ? 'sala' : 'salas'} · {preset.enemies} enemigos
        </p>
        {preset.enemyAi && (
          <p className="mt-2 text-xs font-semibold text-ember">
            Director automático incluido · no hace falta DM
          </p>
        )}
        {Number.isInteger(characterLevel) && !matchesSuggestedLevel(characterLevel, preset.suggestedLevel) && (
          <p className="mt-2 text-xs text-blood">
            Tu PJ es nivel {characterLevel}; este escenario está pensado para nivel {preset.suggestedLevel} y todavía no ajusta su dificultad automáticamente.
          </p>
        )}

        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => onCreate(preset)}
          className="mt-3 rounded-sm bg-ochre px-4 py-2 font-display text-sm tracking-wide text-parchment-100 hover:bg-ochre/90 disabled:opacity-40"
        >
          {busy ? 'Montando la mesa…' : 'Jugar sin DM'}
        </button>
        {onEditImages && (
          <button
            type="button"
            onClick={() => onEditImages(preset)}
            title="Solo el administrador de la instalación ve este botón"
            className="mt-2 rounded-sm border border-ink/25 px-4 py-1.5 font-display text-sm text-ink/75 hover:border-ochre hover:text-ochre"
          >
            Imágenes de enemigos y objetos
          </button>
        )}
      </div>
    </li>
  );
}

function matchesSuggestedLevel(level, suggestedLevel) {
  const [minimum, maximum = minimum] = String(suggestedLevel).split('-').map(Number);
  return Number.isInteger(level) && level >= minimum && level <= maximum;
}

export default function EscenariosSection() {
  const { createCampaign, creating, setError } = useOutletContext();
  const [presets, setPresets] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [characters, setCharacters] = useState(null);
  const [characterId, setCharacterId] = useState('');
  // Solo el administrador de la instalación viste las figuras de los escenarios
  const [canEditImages, setCanEditImages] = useState(false);
  const [editingPreset, setEditingPreset] = useState(null);
  const closeImages = useCallback(() => setEditingPreset(null), []);
  const selectedCharacter = characters?.find((character) => character.id === Number(characterId));

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api('/campaigns/escaramuzas/predefinidas'),
      api('/plantillas?tipo=escaramuza'),
      api('/characters'),
    ])
      .then(([presetResponse, templateResponse, characterResponse]) => {
        if (cancelled) return;
        setPresets(presetResponse.presets ?? []);
        setCanEditImages(Boolean(presetResponse.puedeEditarImagenes));
        setTemplates(templateResponse.templates ?? []);
        const available = (characterResponse.characters ?? []).filter(
          (character) =>
            character.kind === 'pj' && character.status === 'complete' &&
            character.campaign_id == null && character.hp_max > 0
        );
        setCharacters(available);
        setCharacterId((current) => current || (available[0] ? String(available[0].id) : ''));
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
          <span className="text-xs text-ink/45">Aventuras dirigidas por el juego, también en solitario</span>
        </div>
        {characters !== null && characters.length > 0 ? (
          <label className="mb-4 block rounded-md border border-ochre/25 bg-parchment-100/60 p-3 text-sm text-ink/70">
            <span className="font-display text-base text-ink">Personaje para la prueba</span>
            <span className="mt-0.5 block text-xs text-ink/50">
              Entrará con todos sus PG y tendrá el primer turno. El sistema llevará enemigos, turnos y revelaciones.
            </span>
            <select
              value={characterId}
              onChange={(event) => setCharacterId(event.target.value)}
              className="mt-2 w-full rounded-sm border border-ochre/35 bg-parchment-50 px-3 py-2 text-ink sm:max-w-md"
            >
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name} · nivel {character.level}
                  {character.class_index ? ` · ${character.class_index}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : characters !== null ? (
          <div className="mb-4 rounded-md border border-ember/30 bg-ember/5 p-3 text-sm text-ink/70">
            Necesitas un PJ completo y sin campaña asignada para jugar sin DM.{' '}
            <Link to="/personajes" className="font-semibold text-ember underline">
              Crear o terminar un personaje
            </Link>
          </div>
        ) : null}
        {presets === null ? (
          <p className="text-ink/60">Cargando…</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                busy={creating}
                disabled={!characterId}
                characterLevel={selectedCharacter?.level}
                onEditImages={canEditImages ? setEditingPreset : null}
                onCreate={(chosen) =>
                  createCampaign('escaramuza', {
                    presetId: chosen.id,
                    characterId: Number(characterId),
                  })
                }
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

      {editingPreset && <PresetFiguresDialog preset={editingPreset} onClose={closeImages} />}
    </div>
  );
}
