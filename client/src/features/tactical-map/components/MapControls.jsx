import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { CAMERA_KEYS, keyLabel } from '../domain/shortcuts.js';
import './tactical-hud.css';

const PANEL =
  'tactical-controls-panel border border-gold/25 p-1.5';
const SLOT =
  'tactical-control-slot group relative grid h-9 w-9 place-items-center rounded-sm border border-bone/15 bg-night-900/85 text-bone/65 transition hover:border-gold/60 hover:bg-gold/10 hover:text-gold disabled:cursor-not-allowed disabled:opacity-25';
const SLOT_ON = 'border-gold/70 bg-gold/15 text-gold shadow-[inset_0_0_12px_rgba(232,195,104,0.12)]';

function Icon({ name, className = 'h-[1.05rem] w-[1.05rem]' }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (name) {
    case 'rotate-left':
      return <svg {...common}><path d="M4 8V3m0 0h5M4 3l4 4" /><path d="M5.5 14a7 7 0 1 0 2-7" /></svg>;
    case 'rotate-right':
      return <svg {...common}><path d="M20 8V3m0 0h-5m5 0-4 4" /><path d="M18.5 14a7 7 0 1 1-2-7" /></svg>;
    case 'tilt-down':
      return <svg {...common}><path d="m6 9 6 6 6-6" /><path d="M8 5h8" /></svg>;
    case 'tilt-up':
      return <svg {...common}><path d="m6 15 6-6 6 6" /><path d="M8 19h8" /></svg>;
    case 'zoom-in':
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M10.5 7v7m-3.5-3.5h7" /></svg>;
    case 'zoom-out':
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M7 10.5h7" /></svg>;
    case 'center':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></svg>;
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M9 3v18m6-18v18M3 9h18M3 15h18" /></svg>;
    case 'clear':
      return <svg {...common}><path d="m7 7 10 10M17 7 7 17" /><circle cx="12" cy="12" r="9" /></svg>;
    case 'measure':
      return <svg {...common}><path d="m5 19 14-14 2 2L7 21H3v-4Z" /><path d="m13 7 2 2m-5 1 2 2m-5 1 2 2" /></svg>;
    case 'table':
      return <svg {...common}><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8m-8 3h5" /></svg>;
    case 'edit':
      return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13 7 4 4" /></svg>;
    case 'party':
      return <svg {...common}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6m0-5c3 0 5 1.5 5.5 5" /></svg>;
    case 'book':
      return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23V5.5Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23V5.5Z" /></svg>;
    case 'up':
      return <svg {...common}><path d="m6 14 6-6 6 6" /></svg>;
    case 'down':
      return <svg {...common}><path d="m6 10 6 6 6-6" /></svg>;
    case 'left':
      return <svg {...common}><path d="m14 6-6 6 6 6" /></svg>;
    case 'right':
      return <svg {...common}><path d="m10 6 6 6-6 6" /></svg>;
    default:
      return null;
  }
}

function IconButton({ label, icon, shortcut = null, active = false, className = '', children, ...props }) {
  // La tecla se anuncia en el propio botón: el dock es donde se descubre que
  // la cámara también se maneja con el teclado.
  const key = shortcut ? keyLabel(shortcut) : null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      aria-keyshortcuts={key ?? undefined}
      title={key ? `${label} · Tecla ${key}` : label}
      className={`${SLOT} ${active ? SLOT_ON : ''} ${className} ${key ? 'relative' : ''}`}
      {...props}
    >
      {key && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0.5 top-0 font-mono text-[0.5rem] leading-tight text-bone/30"
        >
          {key}
        </span>
      )}
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

function IconLink({ to, label, icon }) {
  return (
    <Link to={to} aria-label={label} title={label} className={SLOT}>
      <Icon name={icon} />
    </Link>
  );
}

/**
 * Dock de sistema del tablero. Se comporta como un mando de videojuego:
 * huella estrecha, iconos constantes y el pad del token solo cuando sirve.
 */
export default function MapControls({
  showGrid,
  selectedToken,
  canNudgeSelected,
  isDm,
  measureMode,
  onToggleMeasureMode,
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraId = useId();

  return (
    <div className="tactical-controls pointer-events-auto flex w-[7.25rem] flex-col gap-1.5">
      {canNudgeSelected && (
        <div className={PANEL}>
          <p className="tactical-control-heading mb-1 truncate px-1 text-center font-display text-[0.58rem] uppercase tracking-[0.14em] text-gold/55">
            {selectedToken.name}
          </p>
          <div className="grid grid-cols-3 gap-1">
            <span />
            <IconButton label="Mover token al norte" icon="up" onClick={() => onNudgeToken(0, -1)} />
            <span />
            <IconButton label="Mover token al oeste" icon="left" onClick={() => onNudgeToken(-1, 0)} />
            <IconButton label="Mover token al sur" icon="down" onClick={() => onNudgeToken(0, 1)} />
            <IconButton label="Mover token al este" icon="right" onClick={() => onNudgeToken(1, 0)} />
          </div>
        </div>
      )}

      <div className={PANEL} aria-label="Cámara" title="Arrastra con el botón derecho para orbitar; con dos dedos en móvil">
        <p className="tactical-control-heading tactical-camera-heading">Cámara</p>
        <button
          type="button"
          className="tactical-camera-toggle"
          aria-label={cameraOpen ? 'Ocultar controles de cámara' : 'Mostrar controles de cámara'}
          aria-expanded={cameraOpen}
          aria-controls={cameraId}
          onClick={() => setCameraOpen((open) => !open)}
        >
          <Icon name="center" />
          Cámara
          <span aria-hidden="true">{cameraOpen ? '▾' : '▴'}</span>
        </button>
        <div id={cameraId} className={`tactical-camera-grid grid grid-cols-3 gap-1 ${cameraOpen ? 'is-open' : ''}`}>
          <IconButton
            label="Rotar 45° a la izquierda"
            icon="rotate-left"
            shortcut={CAMERA_KEYS.rotarIzquierda}
            onClick={onRotateLeft}
          />
          <IconButton label="Centrar mapa" icon="center" shortcut={CAMERA_KEYS.centrar} onClick={onCenter} />
          <IconButton
            label="Rotar 45° a la derecha"
            icon="rotate-right"
            shortcut={CAMERA_KEYS.rotarDerecha}
            onClick={onRotateRight}
          />
          <IconButton
            label="Menos inclinación, hacia cenital"
            icon="tilt-down"
            shortcut={CAMERA_KEYS.inclinarMenos}
            disabled={!canTiltDown}
            onClick={onTiltDown}
          />
          <span
            title="Inclinación actual"
            className="tactical-camera-angle grid h-9 w-9 place-items-center rounded-sm border border-gold/15 bg-night-900/70 font-mono text-[0.65rem] text-gold/65"
          >
            {tiltLabel}
          </span>
          <IconButton
            label="Más inclinación"
            icon="tilt-up"
            shortcut={CAMERA_KEYS.inclinarMas}
            disabled={!canTiltUp}
            onClick={onTiltUp}
          />
          <IconButton label="Alejar" icon="zoom-out" shortcut={CAMERA_KEYS.alejar} onClick={onZoomOut} />
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center text-gold/30">
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          </span>
          <IconButton label="Acercar" icon="zoom-in" shortcut={CAMERA_KEYS.acercar} onClick={onZoomIn} />
        </div>
      </div>

      <div className={PANEL} aria-label="Herramientas del tablero">
        <p className="tactical-control-heading">Mesa</p>
        <div className="grid grid-cols-3 gap-1">
          <IconButton
            label={showGrid ? 'Ocultar rejilla' : 'Mostrar rejilla'}
            icon="grid"
            active={showGrid}
            onClick={onToggleGrid}
          />
          <IconButton label="Medir distancia" icon="measure" active={measureMode} onClick={onToggleMeasureMode} />
          <IconButton label="Deseleccionar token" icon="clear" disabled={!selectedToken} onClick={onClearSelection} />
          <IconButton label="Abrir mesa, registro e iniciativa" icon="table" active={drawerOpen} onClick={onToggleDrawer} />
          {isDm && editorHref && <IconLink to={editorHref} label="Abrir editor" icon="edit" />}
          {isDm && editorHref && (
            <IconLink to={editorHref.replace(/\/editor$/, '/taller/reparto')} label="Abrir reparto" icon="party" />
          )}
          {showArchive && editorHref && (
            <IconLink
              to={editorHref.replace(/\/editor$/, isDm ? '/taller/lore' : '/archivo')}
              label={isDm ? 'Abrir lore y trama' : 'Abrir artículos'}
              icon="book"
            />
          )}
        </div>
      </div>
    </div>
  );
}
