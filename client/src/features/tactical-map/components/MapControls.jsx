import { Link } from 'react-router-dom';

// Estilo compartido de todos los botones del footer del tablero: misma
// altura, misma tipografía (normal, no versalitas) y mismos bordes, para
// que las tres zonas se vean como piezas del mismo juego de cajas.
const BTN = 'inline-flex min-h-9 items-center rounded-sm border px-2.5 text-xs';
const BTN_IDLE = `${BTN} border-bone/20 text-bone/80 hover:border-gold hover:text-gold disabled:opacity-40`;
const BTN_ON = `${BTN} border-gold bg-gold/10 text-gold`;
// Caja contenedora común (la misma que usa la fila de personaje)
const BOX = 'flex flex-wrap gap-1.5 rounded-sm border border-gold/25 bg-night-900/95 p-1.5 shadow-xl backdrop-blur';

// Devuelve la zona izquierda del footer del tablero (45%): el pad de
// movimiento apilado encima de la fila de cámara + mesa/editor/vista. El
// resto del ancho (la fila de personaje) lo añade TacticalMap con PlayerHud.
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
    <div className="pointer-events-auto flex w-[45%] flex-col items-start gap-2">
      <div className="grid grid-cols-3 gap-1 rounded-sm border border-gold/25 bg-night-900/95 p-1.5 shadow-xl backdrop-blur">
        <span />
        <button
          type="button"
          aria-label="Mover token al norte"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(0, -1)}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-bone/20 text-xs text-bone/80 hover:border-gold hover:text-gold disabled:opacity-40"
        >
          N
        </button>
        <span />
        <button
          type="button"
          aria-label="Mover token al oeste"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(-1, 0)}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-bone/20 text-xs text-bone/80 hover:border-gold hover:text-gold disabled:opacity-40"
        >
          O
        </button>
        <button
          type="button"
          aria-label="Mover token al sur"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(0, 1)}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-bone/20 text-xs text-bone/80 hover:border-gold hover:text-gold disabled:opacity-40"
        >
          S
        </button>
        <button
          type="button"
          aria-label="Mover token al este"
          disabled={!selectedToken}
          onClick={() => onNudgeToken(1, 0)}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-bone/20 text-xs text-bone/80 hover:border-gold hover:text-gold disabled:opacity-40"
        >
          E
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className={BOX}>
          <button type="button" aria-label="Centrar mapa" onClick={onCenter} className={BTN_IDLE}>
            Centrar
          </button>
          <button type="button" aria-label="Acercar" onClick={onZoomIn} className={`${BTN_IDLE} min-w-9 justify-center`}>
            +
          </button>
          <button type="button" aria-label="Alejar" onClick={onZoomOut} className={`${BTN_IDLE} min-w-9 justify-center`}>
            -
          </button>
          <button
            type="button"
            aria-label={showGrid ? 'Ocultar rejilla' : 'Mostrar rejilla'}
            onClick={onToggleGrid}
            className={BTN_IDLE}
          >
            {showGrid ? 'Rejilla: sí' : 'Rejilla: no'}
          </button>
          <button
            type="button"
            aria-label="Deseleccionar token"
            disabled={!selectedToken}
            onClick={onClearSelection}
            className={BTN_IDLE}
          >
            Soltar
          </button>
          <button
            type="button"
            aria-label="Medir distancia"
            aria-pressed={measureMode}
            onClick={onToggleMeasureMode}
            className={measureMode ? BTN_ON : BTN_IDLE}
          >
            Medir
          </button>
        </div>

        <div className={BOX}>
          <button
            type="button"
            aria-pressed={drawerOpen}
            onClick={onToggleDrawer}
            title="Registro, iniciativa y presencia de la mesa"
            className={drawerOpen ? BTN_ON : BTN_IDLE}
          >
            Mesa
          </button>
          {isDm && editorHref && (
            <Link to={editorHref} className={BTN_IDLE}>
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
              className={playerView ? BTN_ON : BTN_IDLE}
            >
              {playerView ? 'Vista jugador' : 'Vista DM'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
