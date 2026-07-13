import { useEffect, useState } from 'react';
import { LOCATION_KINDS } from '../kinds.js';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Panel de edición de una ubicación del mapa de mundo: nombre, tipo, lore,
// visibilidad para los jugadores, y su enlace según el tipo — un tablero
// jugable de la biblioteca (dungeon/campamento/evento) o un submapa de mundo
// (ciudad). Los eventos de camino se cuelgan del pin desde Gestión.
export default function LocationPanel({
  location,
  maps,
  worldMaps,
  busy,
  onSave,
  onDelete,
  onCreateSubmap,
  onOpenSubmap,
}) {
  const [name, setName] = useState(location.name);
  const [kind, setKind] = useState(location.kind);
  const [hidden, setHidden] = useState(location.hidden);
  const [lore, setLore] = useState(location.lore);
  const [mapId, setMapId] = useState(location.mapId ?? '');
  const [targetMapId, setTargetMapId] = useState(location.targetMapId ?? '');

  // Al seleccionar otra ubicación se cargan sus datos (key en el padre reinicia
  // el componente, pero mantenemos el sync por si acaso)
  useEffect(() => {
    setName(location.name);
    setKind(location.kind);
    setHidden(location.hidden);
    setLore(location.lore);
    setMapId(location.mapId ?? '');
    setTargetMapId(location.targetMapId ?? '');
  }, [location]);

  const isCity = kind === 'ciudad';
  // Submapas enlazables: los que no cuelgan aún de ningún pin (o ya de este)
  const availableSubmaps = (worldMaps ?? []).filter(
    (m) => !m.isRoot && (!m.parent || m.parent.locationId === location.id)
  );

  function save() {
    const fields = { name, lore, kind, hidden };
    if (isCity) {
      fields.targetWorldMapId = targetMapId === '' ? null : Number(targetMapId);
    } else {
      fields.mapId = mapId === '' ? null : Number(mapId);
    }
    onSave(fields);
  }

  async function createSubmap() {
    const submapName = name.trim() || 'Submapa sin nombre';
    const { worldMapId } = await onCreateSubmap(submapName);
    await onSave({ name, lore, kind: 'ciudad', hidden, targetWorldMapId: worldMapId });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass} htmlFor="loc-name">Nombre de la ubicación</label>
        <input id="loc-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className={labelClass} htmlFor="loc-kind">Tipo</label>
        <select id="loc-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
          {LOCATION_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.glyph} {k.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-bone/80">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        Oculta para los jugadores
        <span className="text-[0.65rem] text-bone/40">(se revela al viajar aquí)</span>
      </label>

      {isCity ? (
        <div>
          <label className={labelClass} htmlFor="loc-submap">Submapa enlazado</label>
          <select
            id="loc-submap"
            className={inputClass}
            value={targetMapId}
            onChange={(e) => setTargetMapId(e.target.value)}
          >
            <option value="">— Sin submapa —</option>
            {availableSubmaps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.locations.length} ubicaciones)
              </option>
            ))}
          </select>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={createSubmap}
              disabled={busy || Boolean(location.targetMapId)}
              className="flex-1 rounded-sm border border-gold/30 px-2 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
            >
              Crear submapa
            </button>
            {location.targetMapId && (
              <button
                type="button"
                onClick={() => onOpenSubmap(location.targetMapId)}
                className="flex-1 rounded-sm border border-sage/50 px-2 py-1 text-xs text-sage hover:bg-sage/10"
              >
                Editar submapa →
              </button>
            )}
          </div>
          <p className="mt-1 text-[0.7rem] text-bone/40">
            Al viajar aquí, el grupo entra en el submapa (con sus propios bares, tiendas y dungeons).
          </p>
        </div>
      ) : (
        <div>
          <label className={labelClass} htmlFor="loc-map">Tablero enlazado</label>
          <select id="loc-map" className={inputClass} value={mapId} onChange={(e) => setMapId(e.target.value)}>
            <option value="">— Sin tablero —</option>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.floorCount} plantas · {m.roomCount} salas)
              </option>
            ))}
          </select>
          {maps.length === 0 && (
            <p className="mt-1 text-[0.7rem] text-bone/40">
              No hay mapas en la biblioteca todavía. Créalos en el editor de mapas.
            </p>
          )}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="loc-lore">Lore de la ubicación</label>
        <textarea
          id="loc-lore"
          rows={6}
          className={inputClass}
          value={lore}
          onChange={(e) => setLore(e.target.value)}
          placeholder="Texto que verá el grupo al viajar aquí (ambiente, especificaciones…)"
        />
      </div>

      <p className="text-[0.7rem] text-bone/40">
        Los eventos de camino se cuelgan de esta ubicación desde la página de Gestión de la campaña.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-sm bg-gold/80 px-3 py-1.5 font-display text-sm text-night-950 hover:bg-gold disabled:opacity-40"
        >
          Guardar cambios
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-sm border border-blood/40 px-3 py-1.5 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Borrar
        </button>
      </div>
    </div>
  );
}
