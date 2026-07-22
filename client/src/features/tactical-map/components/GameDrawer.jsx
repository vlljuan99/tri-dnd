import { useEffect, useRef, useState } from 'react';
import RollCard from '../../../components/RollCard.jsx';
import InitiativeTracker from '../../../components/InitiativeTracker.jsx';
import CombatantTooltip from '../../../components/CombatantTooltip.jsx';
import CompendiumDetail, { COMPENDIUM_LABELS } from '../../../components/CompendiumDetail.jsx';
import { useRoom } from '../../../store/socket.js';
import { rollChatCommand } from '../../../lib/chatCommands.js';
import { api } from '../../../api.js';
import {
  findActiveMention,
  prepareChatMessage,
  reconcileReferenceRanges,
  replaceMention,
  splitMessageReferences,
} from '../../../lib/chatReferences.js';

const ESCAPE_REGEXP = /[.*+?^${}()|[\]\\]/g;

/** Texto de una narración del sistema, con el nombre de cada combatiente
 * mencionado envuelto en un bocadillo de estado rápido (PG, condiciones,
 * salvaciones de muerte) — así no hace falta abrir la pestaña Iniciativa
 * para saber cómo sigue alguien tras leer "Kael recibe daño y cae...". */
function NarratedText({ text }) {
  const combatants = useRoom((s) => s.combat.combatants);
  const names = [...new Set(combatants.map((c) => c.name).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;

  const pattern = new RegExp(`(${names.map((n) => n.replace(ESCAPE_REGEXP, '\\$&')).join('|')})`, 'g');
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part, i) =>
      names.includes(part) ? (
        <CombatantTooltip key={i} name={part}>
          {part}
        </CombatantTooltip>
      ) : (
        <span key={i}>{part}</span>
      )
    );
}

function ReferencedText({ message, onOpenReference }) {
  return splitMessageReferences(message.body, message.references).map((part, index) => {
    if (part.type === 'text') return <span key={`${index}-${part.text}`}>{part.text}</span>;
    return (
      <button
        key={`${part.reference.category}:${part.reference.index}:${part.reference.start}`}
        type="button"
        onClick={() => onOpenReference(part.reference)}
        title={`Abrir ${part.reference.name ?? part.text.slice(1)} en el compendio`}
        className="mx-0.5 inline rounded-full border border-gold/35 bg-gold/10 px-1.5 py-0.5 text-xs font-semibold text-gold transition hover:border-gold hover:bg-gold/20"
      >
        {part.text}
      </button>
    );
  });
}

function Message({ message, selfId, onOpenReference }) {
  if (message.type === 'system') {
    return (
      <p className="py-1 text-center font-display text-xs uppercase tracking-widest text-gold/60">
        — <NarratedText text={message.body} /> —
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
      <span className="whitespace-pre-wrap text-bone/90">
        <ReferencedText message={message} onOpenReference={onOpenReference} />
      </span>
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
  const [references, setReferences] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [detail, setDetail] = useState(null);
  const [commandError, setCommandError] = useState('');
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const mention = findActiveMention(text, cursor, references);
  const mentionQuery = mention?.query ?? '';

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [room.messages.length, tab]);

  useEffect(() => {
    if (!mentionQuery) {
      setSuggestions([]);
      setSuggestionIndex(0);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: mentionQuery, limit: '8', fuente: 'srd' });
        const response = await api(`/srd/buscar?${params}`);
        if (!cancelled) {
          setSuggestions(response.results ?? []);
          setSuggestionIndex(0);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery]);

  async function send(e) {
    e.preventDefault();
    const prepared = prepareChatMessage(text, references);
    if (!prepared.text) return;
    const command = rollChatCommand(prepared.text);
    if (command?.error) {
      setCommandError(command.error);
      return;
    }
    if (command?.roll) room.sendRoll(command.roll);
    else {
      const response = await room.sendChat(prepared.text, prepared.references);
      if (response?.error) {
        setCommandError(response.error);
        return;
      }
    }
    setCommandError('');
    setText('');
    setReferences([]);
    setSuggestions([]);
    setCursor(0);
  }

  function updateText(event) {
    const nextText = event.target.value;
    setReferences((current) => reconcileReferenceRanges(text, nextText, current));
    setText(nextText);
    setCursor(event.target.selectionStart ?? nextText.length);
    setCommandError('');
  }

  function chooseSuggestion(entry) {
    if (!mention) return;
    const next = replaceMention(text, mention, entry);
    const retained = reconcileReferenceRanges(text, next.text, references);
    setText(next.text);
    setReferences([...retained, next.reference].sort((a, b) => a.start - b.start));
    setCursor(next.cursor);
    setSuggestions([]);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function handleInputKeyDown(event) {
    if (!suggestions.length || !mention) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSuggestionIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseSuggestion(suggestions[suggestionIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSuggestions([]);
    }
  }

  async function openReference(reference) {
    setCommandError('');
    try {
      setDetail(await api(`/srd/${reference.category}/${encodeURIComponent(reference.index)}`));
    } catch (error) {
      setCommandError(error.message || 'No se pudo abrir la referencia.');
    }
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
              <Message key={m.id} message={m} selfId={userId} onOpenReference={openReference} />
            ))}
          </div>
          <form onSubmit={send} className="border-t border-gold/15 p-3">
            {commandError && <p className="mb-2 text-xs text-blood">{commandError}</p>}
            <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              value={text}
              onChange={updateText}
              onClick={(event) => setCursor(event.currentTarget.selectionStart ?? text.length)}
              onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? text.length)}
              onKeyDown={handleInputKeyDown}
              placeholder="Escribe, usa @ para el compendio o /r 1d20+4"
              className="w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none"
            />
            {suggestions.length > 0 && mention && (
              <ul className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-64 overflow-y-auto rounded-sm border border-gold/25 bg-night-900 p-1 shadow-2xl">
                {suggestions.map((entry, index) => (
                  <li key={`${entry.category}:${entry.index}`}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSuggestion(entry)}
                      className={`w-full rounded-sm px-2 py-2 text-left ${index === suggestionIndex ? 'bg-gold/15' : 'hover:bg-bone/5'}`}
                    >
                      <span className="block truncate text-sm text-bone">{entry.name}</span>
                      <span className="block text-[0.65rem] uppercase tracking-wide text-gold/60">
                        {COMPENDIUM_LABELS[entry.category] ?? 'Referencia'}{!entry.translated ? ' · EN' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </div>
            <button
              type="submit"
              className="rounded-sm bg-gold px-3 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
            >
              Enviar
            </button>
            </div>
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

      {detail && <CompendiumDetail entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
