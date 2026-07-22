import { useEffect, useState } from 'react';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-3 py-2 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';
const cardClass = 'rounded-md border border-gold/15 bg-night-900/55 p-4';

// Los ajustes globales viven en una vista propia. El inspector lateral queda
// reservado para la pieza que el DM haya seleccionado en el lienzo.
export default function MapSettingsSection({ map, busy, onRename, onPatch, onActivate, onBack }) {
  const [name, setName] = useState(map.name);

  useEffect(() => setName(map.name), [map.id, map.name]);

  function saveName() {
    const next = name.trim();
    if (next && next !== map.name) onRename(map.id, next);
    else setName(map.name);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.22em] text-gold/55">Configuración del tablero</p>
            <h2 className="mt-1 font-display text-2xl text-gold">{map.name}</h2>
            <p className="mt-1 max-w-2xl text-sm text-bone/55">
              Ajusta cómo se presenta el mapa al grupo. Para dibujar o poblarlo, vuelve al lienzo.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-sm border border-gold/35 px-3 py-1.5 font-display text-sm text-gold hover:bg-gold/10"
          >
            ← Volver al lienzo
          </button>
        </div>

        {!map.isActive && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-sage/25 bg-sage/5 p-4">
            <div>
              <p className="font-display text-sm text-sage">Listo para probarlo en la mesa</p>
              <p className="mt-0.5 text-xs text-bone/50">Puedes activarlo ahora y seguir editándolo después.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onActivate(map.id)}
              className="rounded-sm bg-sage px-4 py-2 font-display text-sm text-night-950 hover:bg-sage/90 disabled:opacity-40"
            >
              Llevar este mapa a la mesa
            </button>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={cardClass}>
            <p className="font-display text-base text-gold">Identidad</p>
            <p className="mt-1 text-xs text-bone/45">El nombre con el que reconocerás este tablero en el Taller.</p>
            <label className={`${labelClass} mt-4`} htmlFor="map-settings-name">Nombre del mapa</label>
            <input
              id="map-settings-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className={`${inputClass} mt-1`}
            />
            {map.isActive && (
              <p className="mt-3 text-[0.65rem] font-medium uppercase tracking-widest text-sage">● En la mesa</p>
            )}
          </section>

          <section className={cardClass}>
            <p className="font-display text-base text-gold">Visión de los jugadores</p>
            <p className="mt-1 text-xs text-bone/45">Decide cuánto descubre cada persona al explorar.</p>
            <label className={`${labelClass} mt-4`} htmlFor="map-settings-vision">Modo de visión</label>
            <select
              id="map-settings-vision"
              value={map.visionMode ?? 'sala'}
              onChange={(event) => onPatch(map.id, { visionMode: event.target.value })}
              className={`${inputClass} mt-1`}
            >
              <option value="sala">Sala completa (sin niebla fina)</option>
              <option value="compartida">Compartida: lo que ve el grupo</option>
              <option value="individual">Individual: cada cual lo suyo</option>
            </select>
            {(map.visionMode ?? 'sala') !== 'sala' && (
              <label className="mt-3 flex items-center gap-2 text-sm text-bone/70">
                Radio de visión
                <input
                  type="number"
                  min={1}
                  max={30}
                  defaultValue={map.visionRadius ?? 6}
                  key={`radius-${map.id}-${map.visionRadius}`}
                  onBlur={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isInteger(value) && value !== map.visionRadius) {
                      onPatch(map.id, { visionRadius: value });
                    }
                  }}
                  className="w-16 rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-center text-sm text-bone focus:border-gold focus:outline-none"
                />
                casillas
              </label>
            )}
            <p className="mt-3 text-[0.7rem] text-bone/40">
              Con niebla fina, las paredes, puertas cerradas y obstáculos bloquean la línea de visión.
            </p>
          </section>

          <section className={cardClass}>
            <p className="font-display text-base text-gold">Ambiente general</p>
            <p className="mt-1 text-xs text-bone/45">Valores visuales que afectan al tablero completo.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="map-settings-torches">Antorchas de pared</label>
                <select
                  id="map-settings-torches"
                  value={map.wallLightEvery ?? 4}
                  onChange={(event) => onPatch(map.id, { wallLightEvery: Number(event.target.value) })}
                  className={`${inputClass} mt-1`}
                >
                  <option value={0}>Desactivadas</option>
                  {[2, 3, 4, 5, 6, 8].map((number) => (
                    <option key={number} value={number}>Cada {number} casillas</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="map-settings-wall-color">Color de paredes</label>
                <div className="mt-1 flex h-[2.4rem] items-center gap-2 rounded-sm border border-gold/20 bg-night-950 px-2">
                  <input
                    id="map-settings-wall-color"
                    type="color"
                    value={map.wallColor ?? '#9b8555'}
                    onChange={(event) => onPatch(map.id, { wallColor: event.target.value })}
                    className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs text-bone/55">{map.wallColor ?? '#9b8555'}</span>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[0.7rem] text-bone/40">
              El pincel «Luces» permite añadir braseros o velas concretos sin cambiar estas antorchas automáticas.
            </p>
          </section>

          <section className={cardClass}>
            <p className="font-display text-base text-gold">Cómo seguir</p>
            <ol className="mt-3 space-y-2 text-sm text-bone/60">
              <li><span className="mr-2 text-gold/70">1.</span>Dibuja salas, paredes y puertas en «Estructura».</li>
              <li><span className="mr-2 text-gold/70">2.</span>Coloca reparto, obstáculos y apariciones en «Contenido».</li>
              <li><span className="mr-2 text-gold/70">3.</span>Añade luces, elevación y terreno en «Ambiente».</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
