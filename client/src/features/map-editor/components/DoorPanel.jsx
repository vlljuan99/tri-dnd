const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

const KIND_LABELS = { puerta: 'Puerta', escalera: 'Escalera', portal: 'Portal' };

// Panel lateral de la puerta seleccionada: tipo, control, estado y borrado
export default function DoorPanel({ door, rooms, busy, onPatch, onDelete }) {
  const roomName = (id) => rooms.find((r) => r.id === id)?.name || `Sala ${id}`;
  const sameFloor =
    rooms.find((r) => r.id === door.fromRoomId)?.floorId ===
    rooms.find((r) => r.id === door.toRoomId)?.floorId;

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="font-display text-sm text-gold">{KIND_LABELS[door.kind]}</p>
        <p className="mt-1 text-xs text-bone/65">
          {roomName(door.fromRoomId)} ({door.fromX}, {door.fromY}) ↔ {roomName(door.toRoomId)} ({door.toX},{' '}
          {door.toY})
        </p>
      </div>

      <div>
        <p className={labelClass}>Tipo</p>
        <div className="mt-1 flex gap-1">
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={busy || (kind === 'puerta' && !sameFloor)}
              onClick={() => onPatch(door.id, { kind })}
              className={`flex-1 rounded-sm border px-2 py-1 text-xs disabled:opacity-30 ${
                door.kind === kind
                  ? 'border-gold bg-gold/15 text-gold'
                  : 'border-bone/20 text-bone/70 hover:border-bone/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className={labelClass}>Quién la abre</p>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPatch(door.id, { control: 'jugador' })}
            className={`flex-1 rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
              door.control === 'jugador'
                ? 'border-sage bg-sage/15 text-sage'
                : 'border-bone/20 text-bone/70 hover:border-bone/40'
            }`}
          >
            El jugador al llegar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPatch(door.id, { control: 'dm' })}
            className={`flex-1 rounded-sm border px-2 py-1 text-xs disabled:opacity-40 ${
              door.control === 'dm'
                ? 'border-blood bg-blood/15 text-blood'
                : 'border-bone/20 text-bone/70 hover:border-bone/40'
            }`}
          >
            Solo el DM (llave/secreta)
          </button>
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onPatch(door.id, { isOpen: !door.isOpen })}
        className={`w-full rounded-sm border px-3 py-1.5 font-display text-sm disabled:opacity-40 ${
          door.isOpen
            ? 'border-sage/60 text-sage hover:bg-sage/10'
            : 'border-bone/30 text-bone/70 hover:bg-bone/5'
        }`}
      >
        {door.isOpen ? 'Abierta — cerrar' : 'Cerrada — abrir'}
      </button>

      <div className="border-t border-gold/15 pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('¿Borrar esta puerta?')) onDelete(door.id);
          }}
          className="w-full rounded-sm border border-blood/40 px-3 py-1.5 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Borrar puerta
        </button>
      </div>
    </div>
  );
}
