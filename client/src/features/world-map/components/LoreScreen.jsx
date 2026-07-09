// Pantalla de lore a pantalla completa (apertura de campaña o llegada a una
// ubicación). Muestra un título, el texto de lore y contenido opcional (p. ej.
// las especificaciones del tablero), con un botón para continuar.
export default function LoreScreen({ eyebrow, title, lore, children, onContinue, continueLabel = 'Continuar' }) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-night-950 px-4 py-8 text-bone">
      <div className="w-full max-w-2xl space-y-6 text-center">
        {eyebrow && (
          <p className="font-display text-xs uppercase tracking-[0.3em] text-gold/70">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl tracking-wide text-gold">{title}</h1>
        {lore ? (
          <p className="whitespace-pre-wrap text-left text-lg leading-relaxed text-bone/85">{lore}</p>
        ) : (
          <p className="italic text-bone/40">Sin lore descrito.</p>
        )}
        {children}
        <button
          type="button"
          onClick={onContinue}
          className="rounded-sm border border-gold px-6 py-2 font-display text-lg tracking-wide text-gold hover:bg-gold/10"
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
