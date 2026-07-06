export default function MapShapePanel({ error, onFillAll, onClearAll, onClose }) {
  return (
    <div className="pointer-events-auto absolute left-3 top-20 z-20 w-[min(20rem,calc(100vw-1.5rem))] rounded-sm border border-gold/25 bg-night-900/95 p-3 text-bone shadow-xl backdrop-blur sm:left-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-sm uppercase tracking-widest text-gold">Forma de la sala</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-bone/60 hover:text-bone"
          aria-label="Salir del modo forma"
        >
          Cerrar
        </button>
      </div>

      <p className="text-sm text-bone/75">
        Haz clic en una casilla para activarla o desactivarla. Empieza llena de fondo a fondo — las casillas
        desactivadas quedan vacías durante la partida (en L, con huecos, la forma que necesites).
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onFillAll}
          className="flex-1 rounded-sm border border-bone/20 px-3 py-1.5 text-sm hover:border-gold hover:text-gold"
        >
          Rellenar todo
        </button>
        <button
          type="button"
          onClick={onClearAll}
          className="flex-1 rounded-sm border border-blood/50 px-3 py-1.5 text-sm text-blood hover:bg-blood/10"
        >
          Vaciar todo
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-blood">{error}</p>}
    </div>
  );
}
