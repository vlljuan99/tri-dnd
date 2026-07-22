import { useEffect, useState } from 'react';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Inspector de una arista del mundo. El orden de los extremos define el sentido
// cuando se activa «solo ida»; invertirlo no recrea la ruta ni pierde su coste.
export default function RoutePanel({ route, locations, busy, onSave, onReverse, onDelete }) {
  const [cost, setCost] = useState(route.cost);
  const [label, setLabel] = useState(route.label ?? '');
  const [oneWay, setOneWay] = useState(route.oneWay);

  useEffect(() => {
    setCost(route.cost);
    setLabel(route.label ?? '');
    setOneWay(route.oneWay);
  }, [route]);

  const from = locations.find((location) => location.id === route.fromLocationId);
  const to = locations.find((location) => location.id === route.toLocationId);

  return (
    <div className="space-y-4">
      <section className="rounded-sm border border-gold/15 bg-night-950/50 p-3">
        <p className={labelClass}>Recorrido</p>
        <p className="mt-1 font-display text-sm text-gold">
          {from?.name ?? 'Origen'} {oneWay ? '→' : '↔'} {to?.name ?? 'Destino'}
        </p>
        <p className="mt-1 text-[0.7rem] text-bone/45">
          {oneWay ? 'Solo puede recorrerse en el sentido de la flecha.' : 'Puede recorrerse en ambos sentidos.'}
        </p>
      </section>

      <div>
        <label className={labelClass} htmlFor="route-label">Nombre opcional</label>
        <input
          id="route-label"
          className={inputClass}
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Camino viejo, paso del norte…"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="route-cost">Coste narrativo en jornadas</label>
        <input
          id="route-cost"
          className={inputClass}
          type="number"
          min="1"
          max="3650"
          step="1"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
        <p className="mt-1 text-[0.7rem] text-bone/40">El reloj de campaña se conectará en el Corte C.</p>
      </div>

      <label className="flex items-start gap-2 text-sm text-bone/80">
        <input
          className="mt-0.5"
          type="checkbox"
          checked={oneWay}
          onChange={(event) => setOneWay(event.target.checked)}
        />
        <span>
          Ruta de un solo sentido
          <span className="mt-0.5 block text-[0.65rem] text-bone/40">De {from?.name} hacia {to?.name}.</span>
        </span>
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => onSave({ cost: Number(cost), label, oneWay }).catch(() => {})}
        className="w-full rounded-sm bg-gold px-3 py-2 font-display text-sm text-night-950 hover:bg-gold/90 disabled:opacity-40"
      >
        Guardar ruta
      </button>

      {oneWay && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onReverse().catch(() => {})}
          className="w-full rounded-sm border border-sage/50 px-3 py-1.5 text-sm text-sage hover:bg-sage/10 disabled:opacity-40"
        >
          Invertir sentido
        </button>
      )}

      <section className="border-t border-blood/20 pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="w-full rounded-sm border border-blood/40 px-3 py-1.5 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Borrar ruta
        </button>
      </section>
    </div>
  );
}
