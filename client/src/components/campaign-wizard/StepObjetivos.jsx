import { inputClass, labelClass, labelTextClass } from '../wizard/styles.js';

export function validateObjetivos() {
  return {};
}

/**
 * Paso — Objetivos (solo campañas): una línea por objetivo, se muestran
 * como lista con viñetas en la pantalla de espera de los jugadores.
 */
export default function StepObjetivos({ campaign, patch }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">Un objetivo por línea. También puedes dejarlo vacío.</p>
      <label className={labelClass}>
        <span className={labelTextClass}>Objetivos</span>
        <textarea
          value={campaign.objectives.join('\n')}
          onChange={(e) => patch({ objectives: e.target.value.split('\n') })}
          rows={8}
          placeholder={'Encontrar la espada perdida\nDerrotar al dragón'}
          className={`${inputClass} w-full`}
        />
      </label>
    </div>
  );
}
