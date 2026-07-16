import { validateConcepto } from './StepIdentidad.jsx';

/** Revisión final antes de abrir el archivo de trabajo permanente del DM. */
export default function StepResumen({ campaign, onFinish, finishing, finishError }) {
  const errors = validateConcepto(campaign);
  const blocked = Object.keys(errors).length > 0;
  const objectives = (campaign.objectives ?? []).filter(Boolean);

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-gold/60">Paso 4</p>
        <h2 className="font-display text-2xl tracking-wide text-gold">Tu estudio está preparado</h2>
      </div>

      <p className="text-sm leading-relaxed text-bone/70">
        Esto no cierra la preparación: abre el archivo vivo desde el que desarrollarás el mundo, el reparto
        y las sesiones de la campaña.
      </p>

      <div className="rounded-sm border border-gold/20 bg-night-950/60 p-4 text-sm">
        <p className="font-display text-xl text-gold">{campaign.name || 'Sin nombre'}</p>
        <p className="mt-1 text-bone/60">
          Campaña · plazas: {campaign.maxPlayers ?? 'sin límite'} · invitación:{' '}
          <span className="font-mono tracking-widest">{campaign.inviteCode}</span>
        </p>

        {campaign.description && (
          <div className="mt-4 border-t border-bone/10 pt-3">
            <p className="text-[0.65rem] uppercase tracking-widest text-gold/55">Concepto</p>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed text-bone/70">{campaign.description}</p>
          </div>
        )}

        <div className="mt-4 grid gap-3 border-t border-bone/10 pt-3 sm:grid-cols-2">
          <div>
            <p className="text-[0.65rem] uppercase tracking-widest text-gold/55">Archivo privado</p>
            <p className="mt-1 text-bone/60">Secciones de lore, personajes, facciones, lugares y sesiones.</p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-widest text-gold/55">Presentación pública</p>
            <p className="mt-1 text-bone/60">
              {campaign.lore ? 'Introducción preparada' : 'Sin introducción todavía'} ·{' '}
              {objectives.length} objetivo{objectives.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </div>

      {finishError && <p className="text-sm text-blood">{finishError}</p>}

      <button
        type="button"
        onClick={onFinish}
        disabled={finishing || blocked}
        title={blocked ? 'Falta el nombre de la campaña' : undefined}
        className="w-full rounded-sm bg-ember px-4 py-2.5 font-display text-lg tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
      >
        {finishing ? 'Creando archivo…' : 'Abrir el archivo del DM →'}
      </button>
    </div>
  );
}
