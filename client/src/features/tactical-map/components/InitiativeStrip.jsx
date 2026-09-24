import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { buildInitiativeStrip } from '../domain/initiativeStrip.js';
import { conditionLabel } from '../domain/conditions.js';
import InitiativeOrder from './InitiativeOrder.jsx';
import './tactical-hud.css';

// Tira de iniciativa (Fase 2 de la reforma del HUD): el orden de turnos deja
// de ser una lista de texto en el lateral y pasa a ser una fila de retratos
// arriba-centro, con el combatiente activo elevado. Es lo que se mira sin
// parar durante el combate, así que ocupa el sitio de honor y solo enseña lo
// que se lee de un vistazo: quién va, cuánta vida le queda y qué le pasa.
//
// La gestión completa (condiciones, saltar turno, acciones legendarias) sigue
// viviendo en InitiativeOrder, que aquí se despliega bajo la tira como panel
// del DM: nada de lo que hay dentro llega a un jugador que no lo reciba ya.

const HP_COLORS = [
  [0.5, 'bg-moss'],
  [0.25, 'bg-ochre'],
];

function hpColor(ratio) {
  return HP_COLORS.find(([limit]) => ratio > limit)?.[1] ?? 'bg-blood';
}

/** Marco del retrato: el activo manda, después el bando y si es tuyo. */
function portraitRing({ active, mine, kind, state }) {
  if (active) return 'border-gold shadow-[0_0_14px_rgba(232,195,104,0.7)]';
  if (state === 'dead') return 'border-bone/15';
  if (mine) return 'border-moss/70';
  if (kind === 'enemigo') return 'border-blood/55';
  return 'border-bone/25';
}

/** Resumen para el `title`: lo mismo que se pinta, pero en palabras. */
function entryTitle(entry) {
  const parts = [`${entry.name} · Ini ${entry.initiativePending ? 'tirando…' : entry.initiative ?? '—'}`];
  if (entry.helpFrom) parts.push(`Le ayuda ${entry.helpFrom}`);
  if (entry.healthLabel && entry.kind !== 'pj') parts.push(entry.healthLabel);
  if (entry.hp) parts.push(`${entry.hp.current}/${entry.hp.max} PG${entry.hp.temp > 0 ? ` +${entry.hp.temp} temp.` : ''}`);
  if (entry.state === 'dead') parts.push('Muerto');
  if (entry.state === 'dying') parts.push('Agonizando');
  if (entry.state === 'stable') parts.push('Estable');
  if (entry.concentration) parts.push(`Concentrado en ${entry.concentration}`);
  if (entry.dashed) parts.push('Corriendo');
  if (entry.stance) parts.push(entry.stance === 'esquivar' ? 'Esquivando' : 'Destrabado');
  if (entry.conditions.length) parts.push(entry.conditions.map(conditionLabel).join(', '));
  if (entry.tokenId) parts.push('Pulsa para centrarlo en el tablero');
  return parts.join(' · ');
}

function DeathSaveMiniDots({ saves }) {
  return (
    <span className="flex items-center justify-center gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={`s${i}`} className={`h-1 w-1 rounded-full ${i < (saves?.successes ?? 0) ? 'bg-moss' : 'bg-night-950 ring-1 ring-moss/40'}`} />
      ))}
      <span className="mx-[1px] text-[0.5rem] leading-none text-bone/30">·</span>
      {[0, 1, 2].map((i) => (
        <span key={`f${i}`} className={`h-1 w-1 rounded-full ${i < (saves?.failures ?? 0) ? 'bg-blood' : 'bg-night-950 ring-1 ring-blood/40'}`} />
      ))}
    </span>
  );
}

function InitiativeCard({ entry, selected, onSelect }) {
  const dead = entry.state === 'dead';
  const visibleConditions = entry.conditions.slice(0, 3);
  const extraConditions = entry.conditions.length - visibleConditions.length;
  const reduceMotion = useReducedMotion();

  return (
    // `layout`: cuando llegan las iniciativas del ritual (Fase 4c), los
    // retratos se deslizan a su sitio en vez de saltar
    <motion.button
      layout={reduceMotion ? false : 'position'}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      type="button"
      disabled={!entry.tokenId}
      aria-current={entry.active ? 'true' : undefined}
      aria-label={entryTitle(entry)}
      title={entryTitle(entry)}
      onClick={() => entry.tokenId && onSelect(entry.tokenId)}
      className={`tactical-initiative-card relative flex w-12 shrink-0 flex-col items-center gap-1 rounded-sm px-0.5 py-1 transition-transform duration-200 disabled:cursor-default ${
        entry.active ? '-translate-y-1' : ''
      } ${selected ? 'bg-gold/10' : entry.tokenId ? 'hover:bg-bone/5' : ''}`}
    >
      {entry.active && (
        <span aria-hidden="true" className="absolute -top-1 text-[0.5rem] leading-none text-gold">
          ▼
        </span>
      )}

      <span
        className={`tactical-initiative-portrait relative mt-1.5 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 bg-night-950 ${portraitRing(
          entry
        )} ${dead ? 'grayscale' : ''}`}
      >
        {entry.imageUrl ? (
          <img src={entry.imageUrl} alt="" className={`h-full w-full object-cover ${dead ? 'opacity-50' : ''}`} />
        ) : (
          <span className={`font-display text-sm ${entry.kind === 'enemigo' ? 'text-blood/80' : 'text-gold/70'}`}>
            {entry.name?.[0]?.toUpperCase() ?? '?'}
          </span>
        )}

        {/* Muerto de verdad: cruz sobre el retrato, igual que sobre el token */}
        {dead && (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-lg text-blood/90">
            ✕
          </span>
        )}

        {/* Iniciativa: el número siempre ha sido público, enemigos incluidos.
            Mientras su jugador no ha tirado (ritual, Fase 4c), un dado latiendo. */}
        <span
          className={`absolute -bottom-px left-0 right-0 bg-night-950/85 text-center font-mono text-[0.5rem] leading-[0.7rem] ${
            entry.initiativePending ? 'animate-pulse text-gold' : 'text-bone/70'
          }`}
        >
          {entry.initiativePending ? '···' : entry.initiative ?? '—'}
        </span>
      </span>

      {entry.concentration && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-1.5 rounded-full bg-night-950/90 px-[3px] text-[0.55rem] leading-tight text-gold"
        >
          ◎
        </span>
      )}

      {/* Agonizando: las salvaciones importan más que una barra a cero */}
      {entry.state === 'dying' ? (
        <DeathSaveMiniDots saves={entry.deathSaves} />
      ) : entry.hp ? (
        <span className="tactical-hp-track h-1 w-full overflow-hidden rounded-sm bg-night-950">
          <span className={`tactical-hp-fill block h-full ${hpColor(entry.hp.ratio)}`} style={{ width: `${entry.hp.ratio * 100}%` }} />
        </span>
      ) : (
        <span className="h-1 w-full" />
      )}

      {/* Fase 4d: el estado de un enemigo con palabras, sin números */}
      {entry.healthLabel && entry.kind !== 'pj' && entry.state !== 'dead' && (
        <span className="w-full truncate text-center text-[0.5rem] leading-none text-blood/75">{entry.healthLabel}</span>
      )}

      <span
        className={`tactical-initiative-name w-full truncate text-center text-[0.55rem] leading-tight ${
          entry.active ? 'text-gold' : dead ? 'text-bone/30 line-through' : 'text-bone/60'
        }`}
      >
        {entry.name}
      </span>

      {(visibleConditions.length > 0 || entry.state === 'stable' || entry.dashed || entry.stance || entry.helpFrom) && (
        <span aria-hidden="true" className="flex items-center gap-[2px] text-[0.55rem] leading-none">
          {entry.state === 'stable' && <span className="text-moss">✚</span>}
          {entry.dashed && <span className="text-moss">»</span>}
          {entry.stance && <span className="text-gold/80">{entry.stance === 'esquivar' ? '◈' : '↔'}</span>}
          {entry.helpFrom && <span className="text-moss">Ayu</span>}
          {visibleConditions.map((cond) => (
            <span key={cond} className="tactical-condition text-blood/90">
              {conditionLabel(cond).slice(0, 3)}
            </span>
          ))}
          {extraConditions > 0 && <span className="text-blood/70">+{extraConditions}</span>}
        </span>
      )}
    </motion.button>
  );
}

export default function InitiativeStrip({
  combat,
  tokens,
  userId,
  isDm,
  ownerByCharId,
  selectedTokenId,
  onSelect,
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const entries = buildInitiativeStrip({
    combatants: combat.combatants,
    tokens,
    turnId: combat.turnId,
    userId,
  });

  if (!entries.length) return null;

  // El ancho lo manda el hueco reservado arriba-centro, no la cantidad de
  // combatientes: con la mesa llena la tira se desplaza en horizontal en vez de
  // crecer por encima del tablero (y de la caja de identidad, en móvil).
  return (
    <div className="pointer-events-none flex w-full min-w-0 flex-col items-center gap-1.5">
      <div className="tactical-initiative pointer-events-auto flex max-w-full min-w-0 items-stretch gap-1 rounded-sm border px-1.5 py-1">
        <div className="tactical-round" aria-label={`Ronda ${combat.round}`}>
          <span>Ronda</span>
          <strong>{combat.round}</strong>
        </div>
        <div className="tactical-initiative-track flex min-w-0 items-stretch gap-0.5 overflow-x-auto" aria-label="Orden de iniciativa">
          {entries.map((entry) => (
            <InitiativeCard
              key={entry.id}
              entry={entry}
              selected={Boolean(entry.tokenId) && entry.tokenId === selectedTokenId}
              onSelect={onSelect}
            />
          ))}
        </div>

        {isDm && (
          <button
            type="button"
            onClick={() => setDetailOpen((open) => !open)}
            aria-expanded={detailOpen}
            aria-label={detailOpen ? 'Cerrar el detalle de iniciativa' : 'Abrir el detalle de iniciativa'}
            title={detailOpen ? 'Cerrar el detalle de iniciativa' : 'Abrir el detalle de iniciativa'}
            className="tactical-initiative-expand shrink-0 self-center rounded-sm border border-bone/20 px-1 py-2 text-[0.6rem] leading-none text-bone/60 hover:border-gold hover:text-gold"
          >
            {detailOpen ? '▴' : '▾'}
          </button>
        )}
      </div>

      {isDm && detailOpen && (
        <div className="tactical-surface pointer-events-auto max-h-[46vh] w-60 overflow-y-auto rounded-sm border border-gold/20 bg-night-900/95 p-2 shadow-xl backdrop-blur">
          <InitiativeOrder combat={combat} isDm={isDm} userId={userId} ownerByCharId={ownerByCharId} />
        </div>
      )}
    </div>
  );
}
