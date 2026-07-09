import { inputClass, labelClass, labelTextClass, errorTextClass } from '../wizard/styles.js';

export function validateIdentidad(campaign) {
  const errors = {};
  if (!campaign.name?.trim()) errors.name = 'El nombre es obligatorio.';
  return errors;
}

/**
 * Paso 1 — Identidad: nombre y plazas. Lo mínimo para reconocer la campaña
 * y saber cuántos jugadores caben, antes de invitar a nadie.
 */
export default function StepIdentidad({ campaign, patch, errors }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        El nombre y las plazas son lo primero que verán tus jugadores al unirse con el código de
        invitación.
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
      </label>
    </div>
  );
}
