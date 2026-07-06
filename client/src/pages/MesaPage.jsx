import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../store/auth.js';
import { useRoom } from '../store/socket.js';
import RollCard from '../components/RollCard.jsx';
import InitiativeTracker from '../components/InitiativeTracker.jsx';

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

/**
 * Mesa de juego de una campaña (desktop-first): chat y registro de tiradas en
 * tiempo real, presencia, control de sesión del DM y tracker de iniciativa
 * con panel de enemigos. El mapa táctico se añadirá en las fases 7-8.
 */
export default function MesaPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const user = useAuth((s) => s.user);
  const room = useRoom();
  const [text, setText] = useState('');
  const [rightTab, setRightTab] = useState('iniciativa'); // 'iniciativa' | 'mesa'
  const logRef = useRef(null);

  useEffect(() => {
    room.joinRoom(campaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Autoscroll del registro al llegar mensajes
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [room.messages.length]);

  function send(e) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    room.sendChat(clean);
    setText('');
  }

  if (room.joinError) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="text-blood">{room.joinError}</p>
        <Link to="/" className="text-gold underline">Volver al hub</Link>
      </div>
    );
  }

  const isDm = room.role === 'dm';

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      {/* Cabecera de la mesa */}
      <header className="flex items-center justify-between gap-4 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/" className="font-display text-sm text-gold/70 hover:text-gold">← Hub</Link>
          <Link
            to={`/campanas/${campaignId}/tablero`}
            className="rounded-sm border border-gold/25 px-2 py-1 font-display text-xs uppercase tracking-widest text-gold/80 hover:border-gold hover:text-gold"
          >
            Tablero
          </Link>
          {isDm && (
            <Link
              to={`/campanas/${campaignId}/editor`}
              className="rounded-sm border border-gold/25 px-2 py-1 font-display text-xs uppercase tracking-widest text-gold/80 hover:border-gold hover:text-gold"
            >
              Editor
            </Link>
          )}
          <h1 className="font-display text-xl tracking-wide text-gold">{room.campaignName || 'Mesa de juego'}</h1>
          {room.isLive && (
            <span className="flex items-center gap-1.5 rounded-sm border border-ember/60 px-2 py-0.5 text-xs text-ember">
              <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> EN VIVO
            </span>
          )}
        </div>
        {isDm && (
          <button
            onClick={() => room.setLive(!room.isLive)}
            className={`rounded-sm border px-3 py-1 font-display text-sm tracking-wide transition-colors ${
              room.isLive
                ? 'border-blood/60 text-blood hover:bg-blood/10'
                : 'border-moss text-bone hover:bg-moss/20'
            }`}
          >
            {room.isLive ? 'Cerrar sesión de juego' : 'Abrir sesión de juego'}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Registro y chat */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={logRef} className="flex-1 space-y-2 overflow-y-auto p-4">
            {room.messages.length === 0 && (
              <p className="pt-8 text-center italic text-bone/40">
                El registro está vacío. Saluda al grupo o tira unos dados.
              </p>
            )}
            {room.messages.map((m) => (
              <Message key={m.id} message={m} selfId={user?.id} />
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-gold/15 bg-night-900 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe en la mesa…"
              className="flex-1 rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none"
            />
            <button type="submit" className="rounded-sm bg-gold px-4 font-display tracking-wide text-night-950 hover:bg-gold/90">
              Enviar
            </button>
          </form>
        </main>

        {/* Iniciativa + presencia, en pestañas para dar más espacio al tracker */}
        <aside className="hidden w-[26rem] shrink-0 flex-col border-l border-gold/15 bg-night-900 lg:flex">
          <div className="flex border-b border-gold/15">
            <button
              onClick={() => setRightTab('iniciativa')}
              className={`flex-1 py-2 font-display text-sm uppercase tracking-widest transition-colors ${
                rightTab === 'iniciativa' ? 'border-b-2 border-gold text-gold' : 'text-bone/50 hover:text-bone'
              }`}
            >
              Iniciativa
            </button>
            <button
              onClick={() => setRightTab('mesa')}
              className={`flex-1 py-2 font-display text-sm uppercase tracking-widest transition-colors ${
                rightTab === 'mesa' ? 'border-b-2 border-gold text-gold' : 'text-bone/50 hover:text-bone'
              }`}
            >
              Mesa ({room.online.length})
            </button>
          </div>

          {rightTab === 'iniciativa' ? (
            <InitiativeTracker campaignId={campaignId} isDm={isDm} userId={user?.id} />
          ) : (
            <ul className="space-y-2 p-4">
              {room.online.map((member) => (
                <li key={member.id} className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-moss" />
                  <span className="truncate">{member.name}</span>
                  {member.id === user?.id && <span className="text-xs text-bone/40">(tú)</span>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
