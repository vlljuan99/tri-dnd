import { useEffect, useState } from 'react';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Panel de edición de una ubicación del mapa de mundo: nombre, lore y el mapa
// jugable de la biblioteca al que enlaza.
export default function LocationPanel({ location, maps, busy, onSave, onDelete }) {
  const [name, setName] = useState(location.name);
  const [lore, setLore] = useState(location.lore);
  const [mapId, setMapId] = useState(location.mapId ?? '');

  // Al seleccionar otra ubicación se cargan sus datos (key en el padre reinicia
  // el componente, pero mantenemos el sync por si acaso)
  useEffect(() => {
    setName(location.name);
    setLore(location.lore);
    setMapId(location.mapId ?? '');
  }, [location]);

  function save() {
    onSave({
      name,
      lore,
      mapId: mapId === '' ? null : Number(mapId),
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass} htmlFor="loc-name">Nombre de la ubicación</label>
        <input id="loc-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

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
