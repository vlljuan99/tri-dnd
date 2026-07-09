import { validateIdentidad } from './StepIdentidad.jsx';

/**
 * Último paso: resumen + botón para terminar el asistente (status='complete').
 * El código de invitación ya existe desde que se creó el borrador.
 */
export default function StepResumen({ campaign, onFinish, finishing, finishError }) {
  const errors = validateIdentidad(campaign);
  const blocked = Object.keys(errors).length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        Revisa antes de terminar. Podrás cambiar todo esto más adelante desde la campaña.
      </p>

      <div className="rounded-sm border border-gold/20 bg-night-950/60 p-3 text-sm">
        <p className="font-display text-lg text-gold">{campaign.name || 'Sin nombre'}</p>
        <p className="mt-1 text-bone/70">
          {campaign.hasWorldMap ? 'Campaña' : 'Escaramuza'} · plazas:{' '}
          {campaign.maxPlayers ?? 'sin límite'} · invitación:{' '}
          <span className="font-mono tracking-widest">{campaign.inviteCode}</span>
        </p>
        {campaign.hasWorldMap && (
          <>
            <p className="mt-2 whitespace-pre-wrap text-bone/60">{campaign.lore || 'Sin lore todavía.'}</p>
            {campaign.objectives.filter(Boolean).length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-bone/60">
                {campaign.objectives.filter(Boolean).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {finishError && <p className="text-sm text-blood">{finishError}</p>}

      <button
        type="button"
        onClick={onFinish}
        disabled={finishing || blocked}
        title={blocked ? 'Falta el nombre (paso Identidad)' : undefined}
        className="w-full rounded-sm bg-ember px-4 py-2.5 font-display text-lg tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
      >
        {finishing ? 'Creando…' : 'Terminar y crear'}
      </button>
    </div>
  );
}
