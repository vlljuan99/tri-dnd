/**
 * Indicador de progreso del asistente.
 * Móvil: texto "Paso X de N" + barra de progreso (evita listas horizontales
 * que no caben en pantallas pequeñas).
 * Escritorio (sm+): además una lista lateral con el estado de cada paso.
 */
export default function WizardProgress({ steps, current, onJump }) {
  const total = steps.length;
  const pct = Math.round(((current + 1) / total) * 100);
  const step = steps[current];

  const icon = { done: '✓', error: '!', current: '•', pending: '' };

  return (
    <div>
      {/* Anuncio accesible del paso actual para lectores de pantalla */}
      <p aria-live="polite" className="sr-only">
        Paso {current + 1} de {total}: {step.label}
      </p>

      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-bone/50">
        <span>
          Paso {current + 1} de {total}
          {step.optional && <span className="ml-1.5 normal-case text-bone/35">(opcional)</span>}
        </span>
        <span>{pct}%</span>
      </div>
      <h2 className="mt-0.5 font-display text-xl tracking-wide text-gold">{step.label}</h2>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-night-950">
        <div
          className="h-full rounded-full bg-gold transition-[width] motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Lista lateral, solo en escritorio */}
      <ol className="mt-4 hidden space-y-1 sm:block">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const clickable = s.status !== 'locked';
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onJump(i)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                  isCurrent ? 'bg-gold/15 text-gold' : 'text-bone/60 hover:bg-bone/5'
                } ${!clickable ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    s.status === 'error'
                      ? 'border-blood text-blood'
                      : s.status === 'done'
                        ? 'border-moss bg-moss/20 text-moss'
                        : isCurrent
                          ? 'border-gold text-gold'
                          : 'border-bone/20 text-bone/40'
                  }`}
                >
                  {icon[s.status] || i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
