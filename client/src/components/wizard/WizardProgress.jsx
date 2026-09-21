const ICONS = { campana: '⚑', raza: '◈', clase: '⚔', caracteristicas: '⬡', competencias: '✦', equipo: '♜', identidad: '✎', resumen: '✓' };

export default function WizardProgress({ steps, current, onJump }) {
  return <nav aria-label="Progreso de creación">
    <p className="sr-only" aria-live="polite">Paso {current + 1} de {steps.length}: {steps[current].label}</p>
    <div className="mb-4 flex items-center justify-between text-[10px] uppercase tracking-[.2em] text-bone/45">
      <span>Tu camino</span><span>{current + 1} / {steps.length}</span>
    </div>
    <ol className="grid grid-cols-8 gap-1 lg:grid-cols-1 lg:gap-2">
      {steps.map((s, i) => <li key={s.id} className="min-w-0">
        <button type="button" disabled={s.status === 'locked'} onClick={() => onJump(i)} aria-label={s.label}
          aria-current={i === current ? 'step' : undefined} title={s.label}
          className={`flex w-full items-center justify-center gap-3 rounded-md border px-1 py-2 lg:justify-start lg:px-3 lg:py-3 ${i === current ? 'border-gold/50 bg-gold/10 text-gold' : 'border-transparent text-bone/60 hover:bg-bone/5'} disabled:opacity-30`}>
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center text-lg">{s.status === 'done' ? '✓' : s.status === 'error' ? '!' : ICONS[s.id]}</span>
          <span className="hidden text-sm lg:block">{s.label}</span>
        </button>
      </li>)}
    </ol>
    <div className="mt-3 h-px overflow-hidden bg-bone/10"><div className="h-full bg-gold transition-[width] motion-reduce:transition-none" style={{ width: `${((current + 1) / steps.length) * 100}%` }} /></div>
  </nav>;
}
