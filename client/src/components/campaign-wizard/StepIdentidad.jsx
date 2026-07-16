import { inputClass, labelClass, labelTextClass, errorTextClass } from '../wizard/styles.js';

export function validateConcepto(campaign) {
  const errors = {};
  if (!campaign.name?.trim()) errors.name = 'El nombre es obligatorio.';
  if ((campaign.description ?? '').length > 2000) {
    errors.description = 'La sinopsis no puede superar los 2000 caracteres.';
  }
  return errors;
}

// Alias conservado para cualquier import antiguo mientras el asistente pasa
// de «Identidad» a «Concepto».
export const validateIdentidad = validateConcepto;

/** Paso 1 — La semilla de la campaña antes de entrar en su archivo vivo. */
export default function StepIdentidad({ campaign, patch, errors }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-gold/60">Paso 1</p>
        <h2 className="font-display text-2xl tracking-wide text-gold">Concepto de la campaña</h2>
      </div>

      <p className="text-sm text-bone/70">
        Ponle nombre a la aventura y resume su premisa. No tienes que escribir ahora todo el lore:
        el archivo del DM será tu espacio de trabajo permanente.
      </p>

      <label className={labelClass}>
        <span className={labelTextClass}>Nombre *</span>
        <input
          value={campaign.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Nombre de la campaña"
          className={`${inputClass} font-display text-lg`}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'error-name' : undefined}
          autoFocus
        />
        {errors.name && (
          <span id="error-name" className={errorTextClass}>
            {errors.name}
          </span>
        )}
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Sinopsis / concepto</span>
        <textarea
          value={campaign.description ?? ''}
          onChange={(e) => patch({ description: e.target.value })}
          rows={5}
          maxLength={2000}
          placeholder="Una expedición hacia un reino aislado donde los recuerdos se convierten en moneda…"
          className={`${inputClass} w-full resize-y`}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? 'error-description' : undefined}
        />
        <span className="text-right font-mono text-[0.65rem] text-bone/35">
          {(campaign.description ?? '').length}/2000
        </span>
        {errors.description && (
          <span id="error-description" className={errorTextClass}>
            {errors.description}
          </span>
        )}
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Plazas (opcional)</span>
        <input
          type="number"
          min={1}
          max={20}
          value={campaign.maxPlayers ?? ''}
          onChange={(e) =>
            patch({
              maxPlayers: e.target.value
                ? Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1))
                : null,
            })
          }
          placeholder="Sin límite"
          className={`${inputClass} w-40 font-mono`}
        />
        <span className="text-xs text-bone/45">Podrás cambiarlo cuando invites al grupo.</span>
      </label>
    </div>
  );
}
