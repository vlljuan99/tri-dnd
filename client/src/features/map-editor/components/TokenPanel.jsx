import { useEffect, useState } from 'react';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

const KIND_LABELS = { enemigo: 'Enemigo', aliado: 'Aliado', objeto: 'Objeto', trampa: 'Trampa' };

// Panel lateral del marcador seleccionado (enemigo, aliado, objeto o trampa)
export default function TokenPanel({ token, roomName, busy, onPatch, onDelete }) {
  const [name, setName] = useState(token.name);

  useEffect(() => setName(token.name), [token]);

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="font-display text-sm text-gold">{KIND_LABELS[token.kind]}</p>
        <p className="mt-1 text-xs text-bone/65">
          {roomName} · casilla ({token.x}, {token.y})
          {token.monsterIndex && <> · SRD: {token.monsterIndex}</>}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="token-name">Nombre</label>
        <div className="mt-1 flex gap-2">
          <input id="token-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            disabled={busy || !name.trim() || name.trim() === token.name}
            onClick={() => onPatch(token.id, { name: name.trim() })}
            className="shrink-0 rounded-sm border border-gold/30 px-2 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </div>

      <div>
        <p className={labelClass}>Tipo</p>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={busy}
              onClick={() => onPatch(token.id, { kind })}
              className={`rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
                token.kind === kind
                  ? 'border-gold bg-gold/15 text-gold'
                  : 'border-bone/20 text-bone/70 hover:border-bone/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onPatch(token.id, { hidden: !token.hidden })}
        className={`w-full rounded-sm border px-3 py-1.5 font-display text-sm disabled:opacity-40 ${
          token.hidden
            ? 'border-bone/30 text-bone/70 hover:bg-bone/5'
            : 'border-sage/60 text-sage hover:bg-sage/10'
        }`}
      >
        {token.hidden ? 'Oculto (solo DM) — hacer visible' : 'Visible ✓ — ocultar a los jugadores'}
      </button>

      <div className="border-t border-gold/15 pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`¿Quitar "${token.name}" del mapa?`)) onDelete(token.id);
          }}
          className="w-full rounded-sm border border-blood/40 px-3 py-1.5 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Quitar marcador
        </button>
      </div>
    </div>
  );
}
