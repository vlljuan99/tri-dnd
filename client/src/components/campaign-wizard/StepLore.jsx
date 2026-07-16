import { inputClass, labelClass, labelTextClass } from '../wizard/styles.js';

export function validateLore() {
  return {};
}

/**
 * Paso — Lore de apertura (solo campañas): lo que leen los jugadores en el
 * diario del campamento mientras esperan a que el DM abra la sesión.
 */
export default function StepLore({ campaign, patch }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        Lo que verán tus jugadores mientras esperan a que empieces la partida. Puedes dejarlo en
        blanco y rellenarlo más adelante.
      </p>
      <label className={labelClass}>
        <span className={labelTextClass}>Lore de apertura</span>
        <textarea
          value={campaign.lore}
          onChange={(e) => patch({ lore: e.target.value })}
          rows={9}
          placeholder="Hace mucho tiempo, en las tierras de..."
          className={`${inputClass} w-full`}
        />
      </label>
    </div>
  );
}
