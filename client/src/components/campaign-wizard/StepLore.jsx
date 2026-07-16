import { inputClass, labelClass, labelTextClass } from '../wizard/styles.js';

export function validatePresentacion() {
  return {};
}

export const validateLore = validatePresentacion;

/**
 * Presentación pública: no es todo el archivo del DM, sino lo que el grupo
 * conoce al comienzo y verá en el diario del campamento.
 */
export default function StepLore({ campaign, patch }) {
  const objectives = campaign.objectives ?? [];

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-gold/60">Paso 3</p>
        <h2 className="font-display text-2xl tracking-wide text-gold">Presentación a los jugadores</h2>
      </div>

      <div className="rounded-sm border border-sage/25 bg-sage/5 p-3 text-sm text-bone/70">
        Este contenido es público para el grupo. Los secretos, giros y notas de preparación se quedan en
        el archivo privado del DM.
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Introducción de la campaña</span>
        <textarea
          value={campaign.lore ?? ''}
          onChange={(e) => patch({ lore: e.target.value })}
          rows={8}
          placeholder="Hace mucho tiempo, en las tierras de…"
          className={`${inputClass} w-full resize-y`}
        />
        <span className="text-xs text-bone/45">
          Se mostrará en el diario del campamento y al comenzar la aventura.
        </span>
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Objetivos conocidos</span>
        <textarea
          value={objectives.join('\n')}
          onChange={(e) => patch({ objectives: e.target.value.split('\n') })}
          rows={6}
          placeholder={'Encontrar la espada perdida\nDescubrir quién controla el puerto'}
          className={`${inputClass} w-full resize-y`}
        />
        <span className="text-xs text-bone/45">Escribe un objetivo por línea. Puedes dejarlo vacío.</span>
      </label>
    </div>
  );
}
