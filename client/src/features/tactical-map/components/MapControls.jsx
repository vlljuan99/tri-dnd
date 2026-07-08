import { Link } from 'react-router-dom';

export default function MapControls({
  showGrid,
  selectedToken,
  isDm,
  measureMode,
  onToggleMeasureMode,
  playerView,
  onTogglePlayerView,
  editorHref,
  onCenter,
  onZoomIn,
  onZoomOut,
  onToggleGrid,
  onClearSelection,
  onNudgeToken,
  drawerOpen,
  onToggleDrawer,
}) {
  return (
    <div className="pointer-events-none flex w-fit max-w-full flex-wrap items-end gap-2">
      <div className="pointer-events-auto flex flex-wrap gap-2 rounded-sm border border-gold/20 bg-night-900/90 p-2 shadow-xl backdrop-blur">
        <button
          type="button"
          aria-label="Centrar mapa"
          onClick={onCenter}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold"
        >
          Centrar
        </button>
        <button
          type="button"
          aria-label="Acercar"
          onClick={onZoomIn}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Alejar"
          onClick={onZoomOut}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold"
        >
          -
        </button>
        <button
          type="button"
          aria-label={showGrid ? 'Ocultar rejilla' : 'Mostrar rejilla'}
          onClick={onToggleGrid}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold"
        >
          {showGrid ? 'Rejilla: sí' : 'Rejilla: no'}
        </button>
        <button
          type="button"
          aria-label="Deseleccionar token"
          disabled={!selectedToken}
          onClick={onClearSelection}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold disabled:opacity-40"
        >
          Soltar
        </button>
        <button
          type="button"
          aria-label="Medir distancia"
          aria-pressed={measureMode}
          onClick={onToggleMeasureMode}
          className={`min-h-10 rounded-sm border px-3 font-display text-sm ${
            measureMode
              ? 'border-gold bg-gold/10 text-gold'
              : 'border-bone/15 text-bone hover:border-gold hover:text-gold'
          }`}
        >
          Medir
        </button>
      </div>
      <div className="pointer-events-auto grid grid-cols-3 gap-1 rounded-sm border border-gold/20 bg-night-900/90 p-2 shadow-xl backdrop-blur">
        <span />
        <button
          type="button"
          aria-label="Mover token al norte"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(0, -1)}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold disabled:opacity-40"
        >
          N
        </button>
        <span />
        <button
          type="button"
          aria-label="Mover token al oeste"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(-1, 0)}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold disabled:opacity-40"
        >
          O
        </button>
        <button
          type="button"
          aria-label="Mover token al sur"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(0, 1)}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold disabled:opacity-40"
        >
          S
        </button>
        <button
          type="button"
          aria-label="Mover token al este"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(1, 0)}
          className="min-h-10 rounded-sm border border-bone/15 px-3 font-display text-sm text-bone hover:border-gold hover:text-gold disabled:opacity-40"
        >
          E
        </button>
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          aria-pressed={drawerOpen}
          onClick={onToggleDrawer}
          title="Registro, iniciativa y presencia de la mesa"
          className={`min-h-10 rounded-sm border px-3 font-display text-sm tracking-wide ${
            drawerOpen
              ? 'border-gold bg-gold/10 text-gold'
              : 'border-bone/15 text-bone hover:border-gold hover:text-gold'
          }`}
        >
          Mesa
        </button>
        {isDm && editorHref && (
          <Link
            to={editorHref}
            className="min-h-10 rounded-sm border border-bone/15 px-3 py-2 font-display text-sm tracking-wide text-bone hover:border-gold hover:text-gold"
          >
            Editor
          </Link>
        )}
        {isDm && (
          <button
            type="button"
            role="switch"
            aria-checked={playerView}
            aria-label="Alternar entre vista DM y vista jugador"
            title="Alterna qué ve el tablero: tu vista de DM o la vista filtrada del grupo"
            onClick={onTogglePlayerView}
            className={`min-h-10 rounded-sm border px-3 font-display text-sm tracking-wide ${
              playerView
                ? 'border-gold bg-gold/10 text-gold'
                : 'border-bone/15 text-bone hover:border-gold hover:text-gold'
            }`}
          >
            {playerView ? 'Vista jugador' : 'Vista DM'}
          </button>
        )}
      </div>
    </div>
  );
}
