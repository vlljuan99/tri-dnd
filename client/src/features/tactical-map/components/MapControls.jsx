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
  showArchive,
  onCenter,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  tiltLabel,
  canTiltDown,
  canTiltUp,
  onTiltDown,
  onTiltUp,
  onToggleGrid,
  onClearSelection,
  onNudgeToken,
  drawerOpen,
  onToggleDrawer,
}) {
  return (
    <div className="pointer-events-auto flex w-[45%] flex-col items-start gap-2">
      {/* Pad del TOKEN seleccionado (mover casilla a casilla) */}
      <div className="rounded-sm border border-gold/25 bg-night-900/95 p-1.5 shadow-xl backdrop-blur">
        <p className="pb-1 text-center text-[0.6rem] uppercase tracking-widest text-bone/40">Token</p>
        <div className="grid grid-cols-3 gap-1">
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
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {/* Cámara: rotar el tablero, cenital/inclinada, zoom y centrar */}
        <div className={BOX}>
          <span className="self-center pl-1 pr-0.5 text-[0.6rem] uppercase tracking-widest text-bone/40">
            Cámara
          </span>
          <button
            type="button"
            aria-label="Rotar el tablero a la izquierda"
            title="Rotar 45° a la izquierda"
            onClick={onRotateLeft}
            className={`${BTN_IDLE} min-w-9 justify-center`}
          >
            ⟲
          </button>
          <button
            type="button"
            aria-label="Rotar el tablero a la derecha"
            title="Rotar 45° a la derecha"
            onClick={onRotateRight}
            className={`${BTN_IDLE} min-w-9 justify-center`}
          >
            ⟳
          </button>
          <button
            type="button"
            aria-label="Menos inclinación (hacia cenital)"
            title="Menos inclinación: hacia la vista cenital (plano puro)"
            disabled={!canTiltDown}
            onClick={onTiltDown}
            className={`${BTN_IDLE} min-w-9 justify-center`}
          >
            ▽
          </button>
          <span
            className="inline-flex min-h-9 min-w-14 items-center justify-center rounded-sm border border-bone/10 px-1.5 font-mono text-xs text-bone/70"
            title="Inclinación de la cámara: Cenital = plano puro; a más grados, más relieve y escorzo"
          >
            {tiltLabel}
          </span>
          <button
            type="button"
            aria-label="Más inclinación"
            title="Más inclinación: el tablero se ve más en escorzo y el relieve destaca"
            disabled={!canTiltUp}
            onClick={onTiltUp}
            className={`${BTN_IDLE} min-w-9 justify-center`}
          >
            △
          </button>
          <button type="button" aria-label="Acercar" onClick={onZoomIn} className={`${BTN_IDLE} min-w-9 justify-center`}>
            +
          </button>
          <button type="button" aria-label="Alejar" onClick={onZoomOut} className={`${BTN_IDLE} min-w-9 justify-center`}>
            -
          </button>
          <button type="button" aria-label="Centrar mapa" onClick={onCenter} className={BTN_IDLE}>
            Centrar
          </button>
        </div>

        {/* Herramientas de mesa */}
        <div className={BOX}>
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
            <>
              <Link to={editorHref} className={BTN_IDLE}>
                Editor
              </Link>
              {showArchive && (
                <Link
                  to={editorHref.replace(/\/editor$/, '/archivo')}
                  className={BTN_IDLE}
                  title="Lore, narrativa, personajes, lugares y recursos de la campaña"
                >
                  Archivo
                </Link>
              )}
              <Link to={editorHref.replace(/\/editor$/, '/gestion')} className={BTN_IDLE} title="PNJ, jefes y biblioteca de la campaña">
                Gestión
              </Link>
            </>
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
