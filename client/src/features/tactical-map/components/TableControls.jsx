import { useState } from 'react';

const CONTROL =
  'flex min-h-9 w-full items-center justify-between gap-3 rounded-sm border px-2.5 text-left text-xs transition-colors';
const CONTROL_IDLE = `${CONTROL} border-bone/20 text-bone/75 hover:border-gold/60 hover:text-gold`;
const CONTROL_ON = `${CONTROL} border-gold/60 bg-gold/10 text-gold`;

/**
 * Controles que solo necesita quien dirige la mesa. Viven juntos y plegados
 * para que la información del mapa no compita con herramientas administrativas.
 */
export default function TableControls({
  isDm,
  canControlEnemyAi,
  canRest,
  clockEnabled,
  clockLabel,
  restBusy,
  combat,
  playerView,
  floors,
  floorId,
  hazardPresets,
  hazardTool,
  hazardDuration,
  hazardBusy,
  hazardZones,
  error,
  onToggleTurnMode,
  onToggleEnemyAi,
  onTogglePlayerView,
  onSelectFloor,
  onSelectHazard,
  onHazardDuration,
  onRemoveHazard,
  onRest,
  onToggleClock,
}) {
  const [open, setOpen] = useState(false);

  if (!isDm && !canControlEnemyAi && !canRest) return null;

  return (
    <div className="pointer-events-auto w-64 max-w-[48vw] text-bone">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="ml-auto flex min-h-10 items-center gap-2 rounded-sm border border-gold/25 bg-night-900/95 px-3 font-display text-xs uppercase tracking-widest text-gold shadow-xl backdrop-blur hover:border-gold/60"
      >
        <span aria-hidden="true">{open ? '◆' : '◇'}</span>
        Controles de mesa
        <span className="text-bone/45" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 max-h-[calc(100vh-6rem)] space-y-3 overflow-y-auto rounded-sm border border-gold/25 bg-night-900/95 p-2.5 shadow-2xl backdrop-blur">
          {isDm && (
            <section aria-label="Ritmo de la mesa">
              <p className="mb-1.5 px-0.5 font-display text-[0.65rem] uppercase tracking-widest text-gold/65">
                Ritmo
              </p>
              <button
                type="button"
                onClick={onToggleTurnMode}
                className={combat.active ? CONTROL_ON : CONTROL_IDLE}
              >
                <span>{combat.active ? 'Modo por turnos' : 'Modo libre'}</span>
                <span className={`h-2 w-2 rounded-full ${combat.active ? 'bg-gold' : 'bg-bone/35'}`} />
              </button>
            </section>
          )}

          {/* Descanso y reloj (Fase F). El reloj es opcional: apagado no se
              pinta ningún control temporal y el descanso funciona igual. */}
          {canRest && (
            <section aria-label="Descanso">
              <p className="mb-1.5 px-0.5 font-display text-[0.65rem] uppercase tracking-widest text-gold/65">
                Descanso
              </p>
              <div className="space-y-1.5">
                <button type="button" onClick={() => onRest('corto')} disabled={restBusy} className={CONTROL_IDLE}>
                  <span>Descanso corto</span>
                  <span className="text-bone/40">{clockEnabled ? '1 h' : 'dados de golpe'}</span>
                </button>
                <button type="button" onClick={() => onRest('largo')} disabled={restBusy} className={CONTROL_IDLE}>
                  <span>Descanso largo</span>
                  <span className="text-bone/40">{clockEnabled ? '8 h' : 'PG al máximo'}</span>
                </button>
                {isDm && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={clockEnabled}
                    onClick={onToggleClock}
                    className={clockEnabled ? CONTROL_ON : CONTROL_IDLE}
                  >
                    <span>Reloj de campaña</span>
                    <span className={clockEnabled ? 'text-moss' : 'text-bone/40'}>
                      {clockEnabled ? clockLabel : 'Apagado'}
                    </span>
                  </button>
                )}
              </div>
            </section>
          )}

          {canControlEnemyAi && (
            <section aria-label="Director automático">
              <p className="mb-1.5 px-0.5 font-display text-[0.65rem] uppercase tracking-widest text-gold/65">
                Enemigos
              </p>
              <button
                type="button"
                onClick={onToggleEnemyAi}
                className={combat.enemyAiEnabled ? CONTROL_ON : CONTROL_IDLE}
              >
                <span>IA enemiga</span>
                <span className={combat.enemyAiEnabled ? 'text-moss' : 'text-bone/40'}>
                  {combat.enemyAiEnabled ? 'Activa' : 'Pausada'}
                </span>
              </button>
            </section>
          )}

          {isDm && (
            <section aria-label="Visibilidad del tablero">
              <p className="mb-1.5 px-0.5 font-display text-[0.65rem] uppercase tracking-widest text-gold/65">
                Vista
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={playerView}
                onClick={onTogglePlayerView}
                className={playerView ? CONTROL_ON : CONTROL_IDLE}
              >
                <span>Vista de jugador</span>
                <span className={playerView ? 'text-moss' : 'text-bone/40'}>{playerView ? 'Sí' : 'No'}</span>
              </button>
            </section>
          )}

          {isDm && floors?.length > 1 && (
            <section aria-label="Cambiar planta">
              <p className="mb-1.5 px-0.5 font-display text-[0.65rem] uppercase tracking-widest text-gold/65">
                Planta
              </p>
              <div className="grid grid-cols-2 gap-1">
                {floors.map((floor) => (
                  <button
                    key={floor.id}
                    type="button"
                    aria-pressed={floor.id === floorId}
                    onClick={() => onSelectFloor?.(floor.id)}
                    className={`min-h-9 truncate rounded-sm border px-2 text-xs ${
                      floor.id === floorId
                        ? 'border-gold bg-gold/10 text-gold'
                        : 'border-bone/20 text-bone/65 hover:border-gold/60 hover:text-gold'
                    }`}
                  >
                    {floor.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {isDm && (
            <section aria-label="Zonas de peligro">
              <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                <p className="font-display text-[0.65rem] uppercase tracking-widest text-gold/65">Zonas</p>
                <label className="flex items-center gap-1 text-[0.62rem] text-bone/45">
                  Rondas
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={hazardDuration}
                    onChange={(event) => onHazardDuration(event.target.value)}
                    className="w-10 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-center text-bone"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(hazardPresets).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!combat.active || hazardBusy}
                    aria-pressed={hazardTool === key}
                    onClick={() => onSelectHazard(key)}
                    className={`min-h-9 rounded-sm border px-2 text-[0.68rem] disabled:opacity-35 ${
                      hazardTool === key
                        ? 'border-gold bg-gold/15 text-gold'
                        : 'border-bone/20 text-bone/65 hover:border-gold/50 hover:text-gold'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              {hazardTool && (
                <p className="mt-1.5 text-[0.65rem] text-gold/65">
                  Pulsa una casilla para colocar {hazardPresets[hazardTool].name.toLowerCase()}.
                </p>
              )}
              {hazardZones?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-bone/10 pt-2">
                  {hazardZones.map((zone) => (
                    <button
                      key={zone.id}
                      type="button"
                      title={`Retirar ${zone.name}`}
                      onClick={() => onRemoveHazard(zone)}
                      className="rounded-full border border-blood/30 px-2 py-0.5 text-[0.62rem] text-bone/60 hover:border-blood hover:text-blood"
                    >
                      {zone.name} ×
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {error && <p className="rounded-sm border border-blood/30 bg-blood/10 px-2 py-1.5 text-xs text-blood">{error}</p>}
        </div>
      )}
    </div>
  );
}
