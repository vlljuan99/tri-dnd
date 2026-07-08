import { useEffect, useRef, useState } from 'react';
import RollCard from '../../../components/RollCard.jsx';
import InitiativeTracker from '../../../components/InitiativeTracker.jsx';
import { useRoom } from '../../../store/socket.js';

function Message({ message, selfId }) {
  if (message.type === 'system') {
    return (
      <p className="py-1 text-center font-display text-xs uppercase tracking-widest text-gold/60">
        — {message.body} —
      </p>
    );
  }
  if (message.type === 'roll') {
    return (
      <RollCard
        roll={{ ...message.body, hiddenBadge: message.hidden }}
        authorName={message.author?.name}
      />
    );
  }
  const mine = message.author?.id === selfId;
  return (
    <p className="text-sm leading-relaxed">
      <span className={`mr-2 font-display text-xs tracking-wide ${mine ? 'text-gold' : 'text-gold/70'}`}>
        {message.author?.name ?? '—'}
      </span>
      <span className="text-bone/90">{message.body}</span>
    </p>
  );
}

const TABS = [
  ['registro', 'Registro'],
  ['iniciativa', 'Iniciativa'],
  ['mesa', 'Mesa'],
];

/**
 * Cajón lateral del tablero (Fase 8.6): reúne el registro de chat, el
 * tracker de iniciativa y la presencia de la mesa que antes vivían en una
 * página aparte — el tablero es la pantalla principal, esto es un panel
 * superpuesto que se abre y cierra sin navegar a ningún sitio.
 */
export default function GameDrawer({ campaignId, isDm, userId, onClose }) {
  const room = useRoom();
  const [tab, setTab] = useState('registro');
  const [text, setText] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [room.messages.length, tab]);

  function send(e) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    room.sendChat(clean);
    setText('');
  }

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-gold/20 bg-night-900/95 text-bone shadow-2xl backdrop-blur sm:w-96">
      <div className="flex items-center justify-between border-b border-gold/15 px-3 py-2">
        <div className="flex gap-1">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-sm px-2 py-1 font-display text-xs uppercase tracking-widest transition-colors ${
                tab === value ? 'bg-gold/15 text-gold' : 'text-bone/50 hover:text-bone'
              }`}
            >
              {label === 'Mesa' ? `${label} (${room.online.length})` : label}
            </button>
          ))}
        </div>
        <button onClick={onClose} aria-label="Cerrar panel" className="px-1 text-bone/60 hover:text-bone">
          ✕
        </button>
      </div>

      {tab === 'registro' && (
        <>
          <div ref={logRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {room.messages.length === 0 && (
              <p className="pt-8 text-center italic text-bone/40">
                El registro está vacío. Saluda al grupo o tira unos dados.
              </p>
            )}
            {room.messages.map((m) => (
              <Message key={m.id} message={m} selfId={userId} />
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-gold/15 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe en la mesa…"
              className="min-w-0 flex-1 rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-sm bg-gold px-3 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
            >
              Enviar
            </button>
          </form>
        </>
      )}

      {tab === 'iniciativa' && (
        <div className="min-h-0 flex-1">
          <InitiativeTracker campaignId={campaignId} isDm={isDm} userId={userId} />
        </div>
      )}

      {tab === 'mesa' && (
        <ul className="space-y-2 overflow-y-auto p-4">
          {room.online.map((member) => (
            <li key={member.id} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-moss" />
              <span className="truncate">{member.name}</span>
              {member.id === userId && <span className="text-xs text-bone/40">(tú)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
