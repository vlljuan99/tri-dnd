import { ALIGNMENTS } from '../../lib/dnd.js';
import HelpBlock from './HelpBlock.jsx';
import { inputClass, labelClass, labelTextClass, errorTextClass } from './styles.js';

/**
 * Paso 1 — Identidad: lo mínimo para reconocer al personaje. El resto de
 * datos narrativos son opcionales y nunca bloquean el avance.
 */
export default function StepIdentidad({ char, patch, campaigns, errors }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        El nombre, la campaña y el nivel identifican al personaje. El resto de datos puede
        completarse ahora o más adelante.
      </p>

      <label className={labelClass}>
        <span className={labelTextClass}>Nombre *</span>
        <input
          value={char.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Nombre del héroe"
          className={`${inputClass} font-display text-lg`}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'error-name' : undefined}
          autoFocus
        />
        {errors.name && <span id="error-name" className={errorTextClass}>{errors.name}</span>}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          <span className={labelTextClass}>Nivel inicial *</span>
          <input
            type="number"
            min={1}
            max={20}
            value={char.level}
            onChange={(e) => patch({ level: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)) })}
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Campaña</span>
          <select
            value={char.campaign_id ?? ''}
            onChange={(e) => patch({ campaign_id: e.target.value ? Number(e.target.value) : null })}
            className={inputClass}
          >
            <option value="">Sin campaña (puedes añadirla luego)</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Retrato (URL, opcional)</span>
        <input
          value={char.avatar_path ?? ''}
          onChange={(e) => patch({ avatar_path: e.target.value || null })}
          placeholder="https://…"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          <span className={labelTextClass}>Trasfondo (opcional)</span>
          <input
            value={char.background}
            onChange={(e) => patch({ background: e.target.value })}
            placeholder="Ermitaño, forastero…"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Alineamiento (opcional)</span>
          <select value={char.alignment} onChange={(e) => patch({ alignment: e.target.value })} className={inputClass}>
            <option value="">Sin definir</option>
            {ALIGNMENTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Pronombres u otros datos descriptivos (opcional)</span>
        <input
          value={char.pronouns}
          onChange={(e) => patch({ pronouns: e.target.value })}
          placeholder="Ella/ella, él/él, elle/elle…"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Notas iniciales (opcional)</span>
        <textarea
          value={char.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={3}
          placeholder="Ideas sueltas sobre su historia, motivación, aliados…"
          className={`${inputClass} resize-none`}
        />
      </label>

      <HelpBlock title="¿Por qué pedimos esto primero?">
        Solo el nombre y el nivel son necesarios para seguir. Trasfondo, alineamiento, pronombres
        y notas son puramente narrativos: puedes dejarlos en blanco y completarlos cuando quieras
        desde la ficha final.
      </HelpBlock>
    </div>
  );
}

export function validateIdentidad(char) {
  const errors = {};
  if (!char.name || !char.name.trim()) errors.name = 'El personaje necesita un nombre.';
  if (!Number.isInteger(char.level) || char.level < 1 || char.level > 20) {
    errors.level = 'El nivel debe estar entre 1 y 20.';
  }
  return errors;
}
