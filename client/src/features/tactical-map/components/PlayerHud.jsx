import { useEffect, useRef } from 'react';
import StatTooltip from '../../../components/StatTooltip.jsx';
import { conditionLabel } from '../domain/conditions.js';
import { HOTBAR_KEYS, keyLabel, matchShortcut, weaponKey } from '../domain/shortcuts.js';
import { rangeLabel, targetRangeState } from '../domain/weaponSlots.js';
import './tactical-hud.css';

// Hotbar de la mesa (Fase 3 de la reforma del HUD). Tres bloques con una
// función cada uno, en vez de una fila de botones donde todo pesaba igual:
//
//   1. QUIÉN ERES     retrato, PG, CA y estados. Solo se lee.
//   2. QUÉ TE QUEDA   recursos del turno (movimiento, acción, adicional,
//                     reacción) y los slots de acción con su icono y su tecla.
//   3. QUÉ HACES AHORA "Terminar turno", grande y separado del resto para no
//                     pulsarlo sin querer — o la espera, o la salvación de
//                     muerte si estás agonizando.
//
// Los casos especiales (agonía, muerte, enemigo jugado por el DM, turno ajeno)
// no añaden botones: quitan los que no pueden funcionar y explican por qué en
// el tooltip. El estado de "qué puedo hacer" no se decide aquí, llega en
// `control` desde domain/turnControl.js, la misma verdad que apaga el pad de
// movimiento y el área de alcance del tablero.

const SLOT_BASE =
  'tactical-action-slot group relative flex flex-col items-center justify-center border transition disabled:cursor-not-allowed';
const SLOT_IDLE =
  'border-bone/15 bg-night-950/80 text-bone/70 hover:border-gold/60 hover:bg-gold/10 hover:text-gold disabled:opacity-25 disabled:hover:border-bone/15 disabled:hover:bg-night-950/80 disabled:hover:text-bone/70';
const SLOT_ON = 'border-moss/70 bg-moss/20 text-bone shadow-[inset_0_0_12px_rgba(94,140,74,0.25)]';

function Icon({ name }) {
  const common = {
    className: 'h-[1.15rem] w-[1.15rem]',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'correr':
      return <svg {...common}><path d="M13 4.5a1.4 1.4 0 1 0 0-.1Z" /><path d="M9 21l2.5-5-2-2.5.5-4L7 11l-1 3" /><path d="m10 9.5 3.5-1.5 2.5 2 3 .5" /><path d="m13.5 13.5 2 2.5 1.5 4" /></svg>;
    case 'esquivar':
      return <svg {...common}><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5Z" /></svg>;
    case 'destrabarse':
      return <svg {...common}><path d="M4 12h7m0 0-2.5-2.5M11 12l-2.5 2.5" /><path d="M20 12h-4" /><path d="M14 5.5v13" /></svg>;
    case 'ayudar':
      return <svg {...common}><path d="M7 11.5V7.8a1.3 1.3 0 0 1 2.6 0V11" /><path d="M9.6 10.5V6.3a1.3 1.3 0 0 1 2.6 0v4.2" /><path d="M12.2 10.6V7.2a1.3 1.3 0 0 1 2.6 0v4.6" /><path d="M14.8 11.6V9.4a1.3 1.3 0 0 1 2.6 0v4.1c0 3.6-2.4 6.5-5.8 6.5-2.4 0-3.6-1.1-5-3.3L4.8 14a1.3 1.3 0 0 1 2.2-1.4L7 11.5" /></svg>;
    case 'buscar':
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /><path d="M10.5 7.5v6m-3-3h6" /></svg>;
    case 'conjuros':
      return <svg {...common}><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" /><path d="m18 15.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></svg>;
    case 'inventario':
      return <svg {...common}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
    case 'ficha':
      return <svg {...common}><path d="M6 3h9l4 4v14H6V3Z" /><path d="M15 3v4h4" /><path d="M9 12h6m-6 4h4" /></svg>;
    case 'notas':
      return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13 7 4 4" /></svg>;
    case 'melee':
      return <svg {...common}><path d="M4.5 19.5 14 10" /><path d="M13 4h7v7l-6.5 6.5-7-7L13 4Z" /><path d="m3 21 3-3" /></svg>;
    case 'distancia':
      return <svg {...common}><path d="M6 3v18" /><path d="M6 4c7 1.5 11 4.5 13 8-2 3.5-6 6.5-13 8" /><path d="M6 12h14" /></svg>;
    case 'desarmado':
      return <svg {...common}><path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V11m0-1V6.5a1.5 1.5 0 0 1 3 0V11m0-1V7.5a1.5 1.5 0 0 1 3 0V13" /><path d="M16 13v-1.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.6 15a1.6 1.6 0 0 1 2.5-2L9 15" /></svg>;
    default:
      return null;
  }
}

/** Un slot del hotbar: icono, tecla en la esquina y el porqué en el tooltip. */
function ActionSlot({ slot }) {
  const key = HOTBAR_KEYS[slot.key];
  const detail = slot.disabled ? slot.reason : slot.hint;
  return (
    <button
      type="button"
      onClick={slot.run}
      disabled={slot.disabled}
      aria-keyshortcuts={key}
      aria-pressed={slot.on ? true : undefined}
      aria-label={slot.label}
      title={`${slot.label} · Tecla ${keyLabel(key)}${detail ? ` — ${detail}` : ''}`}
      className={`${SLOT_BASE} ${slot.on ? SLOT_ON : SLOT_IDLE}`}
    >
      <Icon name={slot.icon} />
      <span aria-hidden="true" className="tactical-slot-label">{slot.key === 'buscar' ? 'Buscar' : slot.label}</span>
      <span
        aria-hidden="true"
        className="tactical-key absolute right-0.5 top-0 font-mono text-[0.55rem] leading-tight text-bone/35 group-hover:text-gold/70"
      >
        {keyLabel(key)}
      </span>
    </button>
  );
}

/**
 * Slot de arma. A diferencia de una acción, un arma no se "usa" desde el
 * hotbar: se EMPUÑA, y después se pulsa al enemigo. Por eso el slot se queda
 * encendido mientras apuntas y el tooltip dice el gesto que falta.
 */
function WeaponSlot({ slot, index, aiming, range, onAim }) {
  const key = weaponKey(index);
  const icon = slot.unarmed ? 'desarmado' : slot.geometry.ranged ? 'distancia' : 'melee';
  const bonus = slot.attackBonus >= 0 ? `+${slot.attackBonus}` : `${slot.attackBonus}`;
  const detail = [rangeLabel(slot.geometry), `${bonus} al ataque`, slot.damageLabel]
    .filter(Boolean)
    .join(' · ');
  const stateRing =
    aiming && range
      ? range.state === 'alcance'
        ? 'border-moss bg-moss/25 text-bone shadow-[0_0_14px_rgba(94,140,74,0.45)]'
        : range.state === 'larga'
          ? 'border-ochre bg-ochre/20 text-bone shadow-[0_0_14px_rgba(156,111,46,0.4)]'
          : 'border-blood bg-blood/20 text-bone'
      : aiming
        ? 'border-gold bg-gold/20 text-gold shadow-[0_0_14px_rgba(232,195,104,0.45)]'
        : '';

  return (
    <button
      type="button"
      onClick={() => onAim(slot.id)}
      aria-keyshortcuts={key ?? undefined}
      aria-pressed={aiming}
      aria-label={slot.name}
      title={`${slot.name}${key ? ` · Tecla ${keyLabel(key)}` : ''} — ${detail}. ${
        aiming ? 'Pulsa un enemigo para atacarlo (Esc para bajar el arma).' : 'Púlsala para empuñarla y elegir objetivo.'
      }`}
      data-range={aiming ? range?.state ?? 'apuntando' : undefined}
      className={`tactical-weapon-slot group relative flex min-w-[3.6rem] max-w-[8rem] flex-col items-center justify-center gap-0.5 border px-1.5 transition ${
        stateRing || SLOT_IDLE
      }`}
    >
      <Icon name={icon} />
      <span className="tactical-slot-label max-w-full truncate">
        {slot.name}
      </span>
      {key && (
        <span
          aria-hidden="true"
          className="tactical-key absolute right-0.5 top-0 font-mono text-[0.55rem] leading-tight text-bone/35 group-hover:text-gold/70"
        >
          {keyLabel(key)}
        </span>
      )}
    </button>
  );
}

/** Recurso del turno: se tacha al gastarlo, como una casilla de la ficha. */
function ResourceChip({ stat, label, spent }) {
  return (
    <StatTooltip
      stat={stat}
      className={`tactical-resource font-display text-[0.62rem] uppercase tracking-widest ${
        spent ? 'text-bone/25 line-through' : 'text-gold/90'
      }`}
    >
      <span aria-hidden="true" className={`tactical-resource-dot ${spent ? 'is-spent' : ''}`} />
      {label}
    </StatTooltip>
  );
}

function DeathSaveDots({ saves }) {
  return (
    <span
      className="flex items-center gap-1"
      title={`Salvaciones de muerte: ${saves?.successes ?? 0} éxitos, ${saves?.failures ?? 0} fallos`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={`s${i}`}
          className={`h-2 w-2 rounded-full ${i < (saves?.successes ?? 0) ? 'bg-moss' : 'bg-night-950 ring-1 ring-moss/40'}`}
        />
      ))}
      <span className="mx-0.5 text-bone/30">·</span>
      {[0, 1, 2].map((i) => (
        <span
          key={`f${i}`}
          className={`h-2 w-2 rounded-full ${i < (saves?.failures ?? 0) ? 'bg-blood' : 'bg-night-950 ring-1 ring-blood/40'}`}
        />
      ))}
    </span>
  );
}

/**
 * Escucha las teclas del hotbar. La misma tabla que pinta cada slot decide qué
 * hace cada tecla, así que una no puede prometer lo que la otra no cumple; y
 * mientras se escribe en el chat no se dispara nada.
 */
function useHotbarShortcuts(actions, bindings = HOTBAR_KEYS) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    function onKeyDown(event) {
      const name = matchShortcut(event, bindingsRef.current);
      if (!name) return;
      const action = actionsRef.current[name];
      if (!action || action.disabled || !action.run) return;
      event.preventDefault();
      action.run();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export default function PlayerHud({
  token,
  combatant,
  // Qué puede hacer ahora mismo (domain/turnControl.js): la misma verdad que
  // apaga el pad de movimiento y el área de alcance en el tablero.
  control,
  combatActive,
  isMyTurn,
  characterId,
  canSeeNotes,
  canSearchTraps = false,
  searching = false,
  onSearchTraps,
  // Armas equipadas (domain/weaponSlots.js) y el apuntado en curso: el hotbar
  // es donde se empuña, el tablero donde se elige a quién.
  weapons = [],
  aimingWeaponId = null,
  onAimWeapon,
  target = null, // { name, distance, lineOfSight }
  onEndTurn,
  onSpecialAction,
  onDeathSave,
  onOpenSheet,
  onOpenInventory,
  onOpenSpells,
  onOpenNotes,
  notice,
  // Sube cada vez que tu personaje recibe daño (Fase 3, añadido): el retrato
  // se sacude y se tiñe un instante
  hurtKey = 0,
}) {
  const hp = combatant?.hpCurrent ?? token?.hp;
  const hpMax = combatant?.hpMax ?? token?.hpMax;
  const hpTemp = combatant?.hpTemp ?? 0;
  const ac = combatant?.ac;
  const speed = combatant?.speed ?? token?.speed;
  const baseBudget = Number.isInteger(speed) ? Math.floor(speed / 5) : null;
  const budget = control?.budget ?? null;
  const remaining = control?.remaining ?? null;
  const spentMovement = control?.spent ?? 0;
  const outOfMovement = budget != null && remaining === 0;
  // Gastarlo todo sigue mereciendo pips (cuenta lo que hiciste); estar
  // inconsciente o inmovilizado por condiciones, no: ahí no hay turno que gastar.
  const movementRelevant = !['inconsciente', 'condiciones'].includes(control?.move?.reason);
  const hasHp = Number.isInteger(hp) && Number.isInteger(hpMax) && hpMax > 0;
  const downed = Boolean(combatant?.downed);
  const dying = Boolean(combatant?.dying);
  const stable = Boolean(combatant?.stable);
  const dead = Boolean(combatant?.dead);
  const conditions = combatant?.conditions ?? [];
  const conditionTimers = Object.fromEntries(
    (combatant?.timedConditions ?? []).map((timer) => [timer.condition, timer])
  );
  const hpRatio = hasHp ? Math.max(0, Math.min(1, hp / hpMax)) : 0;
  const hpColor = hpRatio > 0.5 ? 'bg-moss' : hpRatio > 0.25 ? 'bg-ochre' : 'bg-blood';
  // Movimiento/acción solo tienen sentido con el modo por turnos activo
  const gated = Boolean(combatActive && combatant);
  const actionUsed = Boolean(combatant?.actionUsed);
  // Gastar la acción: el motivo viene ya redactado del gate (turno ajeno,
  // acción gastada, condiciones, inconsciencia) para que el slot apagado
  // explique por qué lo está en vez de limitarse a no responder.
  const canAct = Boolean(!downed && (control?.act?.allowed ?? true));
  const actionReason = control?.act?.message ?? 'Ya has usado tu acción este turno';
  // Correr/Esquivar/Destrabarse son acciones DEL TURNO: en modo libre el
  // servidor las rechaza porque no hay turno que gastar.
  const canSpendTurnAction = canAct && gated;

  const special = (kind, label, icon, on) => ({
    key: kind,
    label,
    icon,
    on,
    disabled: !canSpendTurnAction || on,
    reason: on
      ? 'Ya está activa este turno'
      : !combatActive
        ? 'La mesa está en modo libre: no hay turnos que gastar'
        : actionReason,
    hint: `Gasta la acción: ${label}`,
    run: () => onSpecialAction?.(kind),
  });

  // Orden fijo: primero lo que gasta el turno, después lo que solo abre un
  // panel. Un slot que no aplica (un enemigo no tiene ficha) no se pinta.
  const slots = [
    combatant && onSpecialAction && special('correr', 'Correr', 'correr', Boolean(combatant.dashed)),
    combatant && onSpecialAction && special('esquivar', 'Esquivar', 'esquivar', combatant.stance === 'esquivar'),
    combatant && onSpecialAction && special('destrabarse', 'Destrabar', 'destrabarse', combatant.stance === 'destrabarse'),
    // Ayudar (Fase 4c): gasta la acción y da ventaja a un aliado; el tablero
    // pregunta a quién al pulsarlo
    combatant && onSpecialAction && special('ayudar', 'Ayudar', 'ayudar', false),
    canSearchTraps && {
      key: 'buscar',
      label: 'Buscar trampas',
      icon: 'buscar',
      disabled: !canAct || searching,
      reason: searching ? 'Buscando…' : actionReason,
      hint: 'Gasta la acción: tirada de Percepción contra lo oculto',
      run: () => onSearchTraps?.(),
    },
    characterId && onOpenSpells && {
      key: 'conjuros',
      label: 'Conjuros',
      icon: 'conjuros',
      disabled: downed,
      reason: 'A 0 PG no puedes lanzar conjuros',
      hint: 'Abre tus trucos y conjuros preparados',
      run: () => onOpenSpells(),
    },
    characterId && {
      key: 'inventario',
      label: 'Inventario',
      icon: 'inventario',
      disabled: downed,
      reason: 'A 0 PG no puedes usar objetos',
      hint: 'Abre tu equipo y objetos',
      run: () => onOpenInventory?.(),
    },
    characterId && {
      key: 'ficha',
      label: 'Ficha',
      icon: 'ficha',
      // Leer no es actuar: la ficha y las notas siguen abiertas hasta muerto
      hint: 'Consulta la ficha completa',
      run: () => onOpenSheet?.(),
    },
    canSeeNotes && {
      key: 'notas',
      label: 'Notas',
      icon: 'notas',
      hint: 'Tus notas privadas de la partida',
      run: () => onOpenNotes?.(),
    },
  ].filter(Boolean);

  const canRollDeathSave = Boolean(dying && isMyTurn && !combatant?.deathSaveRolled && onDeathSave);

  // Armas: solo se ofrecen si el personaje puede pelear. A 0 PG desaparecen
  // igual que el resto de acciones.
  const weaponRow = downed ? [] : weapons;
  const aimingWeapon = weaponRow.find((weapon) => weapon.id === aimingWeaponId) ?? null;
  // Con un objetivo ya elegido, el propio slot dice si ese golpe llega.
  const aimRange = aimingWeapon && target
    ? targetRangeState(target.distance, aimingWeapon.geometry, { lineOfSight: target.lineOfSight })
    : null;

  const shortcutActions = Object.fromEntries(slots.map((slot) => [slot.key, slot]));
  weaponRow.slice(0, 4).forEach((weapon, index) => {
    shortcutActions[`arma-${weapon.id}`] = { run: () => onAimWeapon?.(weapon.id) };
  });
  if (isMyTurn && onEndTurn) shortcutActions.terminarTurno = { run: onEndTurn };
  const bindings = {
    ...HOTBAR_KEYS,
    ...Object.fromEntries(weaponRow.slice(0, 4).map((weapon, index) => [`arma-${weapon.id}`, weaponKey(index)])),
  };
  useHotbarShortcuts(shortcutActions, bindings);

  if (!token) return null;

  return (
    // Se acota el ancho para que el hotbar envuelva en dos filas antes de
    // pisar el dock de cámara de la esquina inferior izquierda.
    <div className="tactical-hud pointer-events-auto relative flex w-fit max-w-[min(100%,58rem)] flex-wrap items-center justify-center gap-x-3 gap-y-2 border px-3 py-2.5 text-bone" data-turn={isMyTurn ? 'propio' : 'espera'}>
      {notice?.message && (
        <div
          key={notice.id}
          role="alert"
          className="pointer-events-none absolute bottom-full left-0 mb-2 max-w-sm animate-[hudNotice_4s_ease-in-out_forwards] rounded-sm border border-blood/60 bg-night-950/95 px-3 py-2 text-sm text-blood shadow-xl backdrop-blur"
        >
          {notice.message}
        </div>
      )}

      {/* ── 1. Quién eres ─────────────────────────────────────────────── */}
      <div className="tactical-hud-identity flex items-center gap-3">
        <div
          key={`retrato-${hurtKey}`}
          className={`tactical-portrait-frame relative rounded-full ${
            hurtKey > 0 ? 'motion-safe:animate-[hudHurt_450ms_ease-out]' : ''
          }`}
        >
          <style>{`@keyframes hudHurt{0%{transform:translateX(0);box-shadow:0 0 0 0 rgba(143,43,35,0)}15%{transform:translateX(-4px);box-shadow:0 0 0 4px rgba(143,43,35,0.75)}35%{transform:translateX(4px)}55%{transform:translateX(-3px)}75%{transform:translateX(2px)}100%{transform:translateX(0);box-shadow:0 0 0 0 rgba(143,43,35,0)}}`}</style>
          {token.imageUrl ? (
            <img
              src={token.imageUrl}
              alt=""
              className={`tactical-hud-portrait rounded-full border-2 object-cover ${
                isMyTurn ? 'border-gold shadow-[0_0_12px_rgba(232,195,104,0.5)]' : 'border-gold/30'
              } ${dead ? 'grayscale' : ''}`}
            />
          ) : (
            <div
              className={`tactical-hud-portrait flex items-center justify-center rounded-full border-2 bg-night-950 font-display text-lg text-gold/70 ${
                isMyTurn ? 'border-gold shadow-[0_0_12px_rgba(232,195,104,0.5)]' : 'border-gold/30'
              }`}
            >
              {token.name?.[0]?.toUpperCase()}
            </div>
          )}
          {dead && (
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-2xl text-blood/90">
              ✕
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="tactical-eyebrow">{dead ? 'Caído' : isMyTurn ? 'Tu turno' : gated ? 'En combate' : 'Exploración'}</span>
          <div className="flex items-center gap-2">
            <span className="tactical-hud-name max-w-[9rem] truncate font-display text-sm tracking-wide text-gold">{token.name}</span>
            {ac != null && (
              <StatTooltip
                stat="ca"
                className="tactical-armor shrink-0 rounded-sm border border-bone/15 px-1.5 font-mono text-[0.68rem] text-bone/70"
              >
                CA {ac}
              </StatTooltip>
            )}
          </div>

          {hasHp && (
            <StatTooltip stat="hp" className="tactical-vitals flex items-center gap-1.5">
              <span className="tactical-hp-track block h-2.5 w-24 overflow-hidden rounded-sm bg-night-950">
                <span className={`tactical-hp-fill block h-full ${hpColor}`} style={{ width: `${hpRatio * 100}%` }} />
              </span>
              <span className="tactical-hp-value font-mono text-xs text-bone/70">
                {hp}<span className="text-bone/45">/{hpMax}</span> <span className="tactical-hp-unit">PG</span>
              </span>
              {hpTemp > 0 && <span className="font-mono text-xs text-moss">+{hpTemp}</span>}
            </StatTooltip>
          )}

          {/* Estados compactos: el símbolo manda y el nombre vive en el tooltip,
              para que ocho condiciones no empujen el hotbar fuera de pantalla. */}
          {(conditions.length > 0 || combatant?.concentration || stable) && (
            <div className="flex flex-wrap items-center gap-1">
              {combatant?.concentration && (
                <span
                  title={`Concentrándose en ${combatant.concentration}: recibir daño obliga a una salvación de Constitución`}
                  className="rounded-sm border border-gold/50 bg-gold/10 px-1 text-[0.6rem] text-gold"
                >
                  ◎
                </span>
              )}
              {stable && (
                <span title="Estabilizado: a 0 PG pero fuera de peligro" className="text-[0.65rem] text-moss">
                  ✚
                </span>
              )}
              {conditions.map((cond) => (
                <span
                  key={cond}
                  title={
                    conditionTimers[cond]
                      ? `${conditionLabel(cond)} · ${conditionTimers[cond].remaining} rondas`
                      : conditionLabel(cond)
                  }
                  aria-label={conditionLabel(cond)}
                  className="tactical-condition rounded-sm border border-blood/40 bg-blood/10 px-1 text-[0.6rem] text-blood/90"
                >
                  {conditionLabel(cond).slice(0, 3)}
                  {conditionTimers[cond] && <span className="ml-0.5 text-gold/80">{conditionTimers[cond].remaining}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Qué te queda ───────────────────────────────────────────── */}
      {/* Al envolverse en móvil, el separador pasa de columna a fila: una línea
          vertical a la izquierda de un bloque que ocupa todo el ancho no separa
          nada. */}
      {!dead && (
        <div className="tactical-hud-actions flex min-w-0 flex-col gap-1.5 border-t border-bone/10 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
          {gated && !downed && (
            <div className="tactical-resources flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {budget != null && movementRelevant && (
                <StatTooltip
                  stat="mov"
                  term={`Movimiento ${remaining}/${budget}`}
                  desc={
                    outOfMovement
                      ? `Has gastado las ${budget} casillas de este turno. Se recuperan al empezar el siguiente.`
                      : `Te quedan ${remaining} de ${budget} casillas este turno.${combatant?.dashed ? ' La segunda tanda procede de Correr.' : ''}`
                  }
                  className="flex items-center gap-0.5"
                >
                  <span className="sr-only">Movimiento {remaining}/{budget} casillas</span>
                  {/* Gastarlo todo se canta con palabras, no solo con pips
                      apagados: es la diferencia entre "no me deja moverme" y
                      "ya me he movido". */}
                  {outOfMovement && (
                    <span className="mr-1 whitespace-nowrap font-display text-[0.62rem] uppercase tracking-widest text-ochre">
                      Sin movimiento
                    </span>
                  )}
                  {Array.from({ length: budget }, (_, index) => {
                    const available = index >= spentMovement;
                    const fromDash = combatant?.dashed && index >= baseBudget;
                    return (
                      <span
                        key={index}
                        className={`h-2.5 w-1.5 rounded-[1px] border ${index === baseBudget && fromDash ? 'ml-1' : ''} ${
                          available
                            ? fromDash
                              ? 'border-gold/80 bg-gold shadow-[0_0_5px_rgba(232,195,104,0.7)]'
                              : 'border-moss/80 bg-moss shadow-[0_0_5px_rgba(94,140,74,0.7)]'
                            : fromDash
                              ? 'border-gold/20 bg-night-950'
                              : 'border-bone/15 bg-night-950'
                        }`}
                      />
                    );
                  })}
                </StatTooltip>
              )}
              <ResourceChip stat="accion" label="Acción" spent={actionUsed} />
              <ResourceChip stat="adicional" label="Adicional" spent={Boolean(combatant?.bonusUsed)} />
              <ResourceChip stat="reaccion" label="Reacción" spent={combatant?.reactionAvailable === false} />
            </div>
          )}

          <div className="tactical-action-row flex flex-wrap items-center gap-1">
            {weaponRow.slice(0, 4).map((weapon, index) => (
              <WeaponSlot
                key={weapon.id}
                slot={weapon}
                index={index}
                aiming={weapon.id === aimingWeaponId}
                range={weapon.id === aimingWeaponId ? aimRange : null}
                onAim={(id) => onAimWeapon?.(id)}
              />
            ))}
            {weaponRow.length > 0 && slots.length > 0 && (
              <span aria-hidden="true" className="mx-0.5 h-8 w-px bg-bone/10" />
            )}
            {slots.map((slot) => (
              <ActionSlot key={slot.key} slot={slot} />
            ))}
          </div>

          {/* La línea que enseña a atacar: qué llevas empuñado, qué falta por
              hacer y si ese golpe llega desde donde estás. */}
          {aimingWeapon && (
            <p
              className={`max-w-[26rem] text-[0.68rem] ${
                aimRange && !aimRange.canAttack ? 'text-blood' : aimRange?.state === 'larga' ? 'text-ochre' : 'text-moss'
              }`}
            >
              <span className="font-display uppercase tracking-widest">{aimingWeapon.name}</span>
              {aimRange && target?.name ? (
                <> · {target.name} a {target.distance * 5} pies · {aimRange.label}</>
              ) : (
                <> · pulsa un enemigo para atacarlo · Esc para bajar el arma</>
              )}
            </p>
          )}
        </div>
      )}

      {/* ── 3. Qué haces ahora ────────────────────────────────────────── */}
      {(dead || dying || gated || (isMyTurn && onEndTurn)) && <div className="tactical-hud-turn flex items-center gap-2 border-t border-bone/10 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
        {dead ? (
          <span className="font-display text-xs uppercase tracking-widest text-blood">Muerto</span>
        ) : dying ? (
          <div className="flex items-center gap-2">
            <DeathSaveDots saves={combatant?.deathSaves} />
            {canRollDeathSave ? (
              <button
                type="button"
                onClick={onDeathSave}
                className="inline-flex min-h-10 items-center rounded-sm border border-blood/60 bg-blood/10 px-3 font-display text-xs uppercase tracking-widest text-blood hover:bg-blood/20"
              >
                Tirar salvación
              </button>
            ) : (
              <span className="font-display text-[0.65rem] uppercase tracking-widest text-blood/70">Agonizando</span>
            )}
          </div>
        ) : null}

        {isMyTurn && onEndTurn ? (
          <button
            type="button"
            onClick={onEndTurn}
            aria-keyshortcuts=" "
            aria-label="Terminar turno"
            title="Terminar turno · Tecla Espacio"
            className="tactical-end-turn inline-flex min-h-10 items-center gap-2 rounded-sm bg-gold px-3.5 font-display text-xs uppercase tracking-widest text-night-950 hover:bg-gold/90"
          >
            Terminar turno
            <span aria-hidden="true" className="rounded-sm bg-night-950/20 px-1 font-mono text-[0.6rem] normal-case tracking-normal">
              Espacio
            </span>
          </button>
        ) : (
          gated && (
            <span className="inline-flex min-h-10 items-center rounded-sm border border-bone/10 px-3 text-xs text-bone/40">
              Esperando tu turno…
            </span>
          )
        )}
      </div>}
      <style>{`@keyframes hudNotice{0%{transform:translateY(5px);opacity:0}8%,78%{transform:translateY(0);opacity:1}100%{transform:translateY(-3px);opacity:0}}`}</style>
    </div>
  );
}
