import { useEffect, useState } from 'react';
import {
  FLUID_TYPES,
  RECOMMENDED_FLUID_EFFECTS,
  normalizeFluidEffects,
} from '../../tactical-map/domain/fluids.js';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-3 py-2 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';
const cardClass = 'rounded-md border border-gold/15 bg-night-900/55 p-4';

const DAMAGE_TYPES = [
  ['fire', 'Fuego'], ['poison', 'Veneno'], ['force', 'Fuerza'], ['acid', 'Ácido'],
  ['cold', 'Frío'], ['lightning', 'Relámpago'], ['necrotic', 'Necrótico'],
  ['psychic', 'Psíquico'], ['radiant', 'Radiante'], ['thunder', 'Trueno'],
  ['bludgeoning', 'Contundente'], ['piercing', 'Perforante'], ['slashing', 'Cortante'],
];
const SAVES = [
  ['str', 'FUE'], ['dex', 'DES'], ['con', 'CON'], ['int', 'INT'], ['wis', 'SAB'], ['cha', 'CAR'],
];
const CONDITIONS = [
  'envenenado', 'derribado', 'agarrado', 'aturdido', 'cegado', 'ensordecido',
  'asustado', 'hechizado', 'paralizado', 'petrificado', 'apresado', 'invisible', 'inconsciente',
];

function FluidEffectRow({ type, effect, busy, onChange, onReset }) {
  const definition = FLUID_TYPES.find((entry) => entry.key === type);
  const recommended = JSON.stringify(effect) === JSON.stringify(RECOMMENDED_FLUID_EFFECTS[type]);
  const selectClass = `${inputClass} mt-1 py-1.5`;
  return (
    <div className="rounded-sm border border-gold/10 bg-night-950/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: definition.color }} />
          <p className="font-display text-sm text-bone">{definition.label}</p>
          {recommended && (
            <span className="rounded-full border border-sage/25 bg-sage/10 px-2 py-0.5 text-[0.58rem] uppercase tracking-wider text-sage">
              Recomendado
            </span>
          )}
        </div>
        {!recommended && (
          <button type="button" disabled={busy} onClick={onReset} className="text-[0.65rem] text-gold/65 hover:text-gold disabled:opacity-40">
            Restaurar recomendado
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClass}>
          Coste al entrar
          <input
            type="number" min={1} max={10} defaultValue={effect.movementCost}
            key={`${type}-cost-${effect.movementCost}`}
            onBlur={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(value) && value !== effect.movementCost) onChange({ movementCost: value });
            }}
            className={selectClass}
          />
        </label>
        <label className={labelClass}>
          Daño
          <input
            type="text" placeholder="Sin daño" defaultValue={effect.damageDice}
            key={`${type}-dice-${effect.damageDice}`}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== effect.damageDice) onChange({ damageDice: value });
            }}
            className={selectClass}
          />
        </label>
        <label className={labelClass}>
          Tipo de daño
          <select value={effect.damageType ?? ''} onChange={(event) => onChange({ damageType: event.target.value || null })} className={selectClass}>
            <option value="">Sin tipo</option>
            {DAMAGE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Salvación
          <select value={effect.saveAbility ?? ''} onChange={(event) => onChange({ saveAbility: event.target.value || null })} className={selectClass}>
            <option value="">Sin salvación</option>
            {SAVES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          CD
          <input
            type="number" min={1} max={30} defaultValue={effect.saveDc}
            key={`${type}-dc-${effect.saveDc}`}
            disabled={!effect.saveAbility}
            onBlur={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(value) && value !== effect.saveDc) onChange({ saveDc: value });
            }}
            className={`${selectClass} disabled:opacity-35`}
          />
        </label>
        <label className={labelClass}>
          Estado al fallar
          <select value={effect.condition ?? ''} onChange={(event) => onChange({ condition: event.target.value || null })} className={selectClass}>
            <option value="">Sin estado</option>
            {CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Límite de visión
          <input
            type="number" min={1} max={30} placeholder="Sin límite"
            defaultValue={effect.visionRadius ?? ''}
            key={`${type}-vision-${effect.visionRadius}`}
            onBlur={(event) => {
              const value = event.target.value === '' ? null : Number.parseInt(event.target.value, 10);
              if ((value === null || Number.isInteger(value)) && value !== effect.visionRadius) onChange({ visionRadius: value });
            }}
            className={selectClass}
          />
        </label>
        <div className="self-end pb-2 text-[0.65rem] leading-relaxed text-bone/35">
          Una vez por tipo al cruzarlo; se repite al terminar turno encima.
        </div>
      </div>
    </div>
  );
}

// Los ajustes globales viven en una vista propia. El inspector lateral queda
// reservado para la pieza que el DM haya seleccionado en el lienzo.
export default function MapSettingsSection({ map, busy, onRename, onPatch, onActivate, onBack }) {
  const [name, setName] = useState(map.name);
  const fluidEffects = normalizeFluidEffects(map.fluidEffects);

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

          <section className={`${cardClass} lg:col-span-2`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-base text-gold">Efectos de los fluidos</p>
                <p className="mt-1 max-w-3xl text-xs text-bone/45">
                  Estas reglas recomendadas ya funcionan sin configurar nada. El coste se aplica al movimiento; el daño y los estados se resuelven al cruzar el fluido y al terminar turno sobre él. Superar la salvación evita el estado y reduce el daño a la mitad.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPatch(map.id, { fluidEffects: RECOMMENDED_FLUID_EFFECTS })}
                className="rounded-sm border border-gold/25 px-3 py-1.5 text-xs text-gold/75 hover:bg-gold/10 disabled:opacity-40"
              >
                Restaurar todos
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {FLUID_TYPES.map(({ key }) => (
                <FluidEffectRow
                  key={key}
                  type={key}
                  effect={fluidEffects[key]}
                  busy={busy}
                  onChange={(partial) => onPatch(map.id, { fluidEffects: { [key]: partial } })}
                  onReset={() => onPatch(map.id, { fluidEffects: { [key]: RECOMMENDED_FLUID_EFFECTS[key] } })}
                />
              ))}
            </div>
          </section>

          <section className={cardClass}>
            <p className="font-display text-base text-gold">Clima y hora</p>
            <p className="mt-1 text-xs text-bone/45">Capa ambiental persistente de esta escena.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Clima
                <select
                  value={map.weather ?? 'despejado'}
                  onChange={(event) => onPatch(map.id, { weather: event.target.value })}
                  className={`${inputClass} mt-1`}
                >
                  <option value="despejado">Despejado</option>
                  <option value="lluvia">Lluvia</option>
                  <option value="nieve">Nieve</option>
                  <option value="niebla">Niebla</option>
                </select>
              </label>
              <label className={labelClass}>
                Hora
                <select
                  value={map.timeOfDay ?? 'dia'}
                  onChange={(event) => onPatch(map.id, { timeOfDay: event.target.value })}
                  className={`${inputClass} mt-1`}
                >
                  <option value="amanecer">Amanecer</option>
                  <option value="dia">Día</option>
                  <option value="atardecer">Atardecer</option>
                  <option value="noche">Noche</option>
                </select>
              </label>
            </div>
            <label className={`${labelClass} mt-3 block`}>
              Intensidad {Math.round((map.weatherIntensity ?? 0.55) * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={map.weatherIntensity ?? 0.55}
                onChange={(event) => onPatch(map.id, { weatherIntensity: Number(event.target.value) })}
                className="mt-2 w-full accent-gold"
              />
            </label>
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
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="map-settings-terrain-style">Aspecto de muros y relieve</label>
                <select
                  id="map-settings-terrain-style"
                  value={map.terrainStyle ?? 'construido'}
                  onChange={(event) => onPatch(map.id, { terrainStyle: event.target.value })}
                  className={`${inputClass} mt-1`}
                >
                  <option value="construido">Construido: sillería, columnas y muros de contención</option>
                  <option value="natural">Natural: piedra seca, peñascos y riscos</option>
                </select>
              </div>
            </div>
            <p className="mt-3 text-[0.7rem] text-bone/40">
              El pincel «Luces» permite añadir braseros o velas concretos sin cambiar estas antorchas automáticas.
              El aspecto solo cambia cómo se ven paredes, obstáculos y desniveles: bloquean igual en los dos.
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
