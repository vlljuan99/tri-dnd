import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../api.js';
import {
  abilityModifier,
  proficiencyBonus,
  weaponAttackBonus,
  weaponDamageModifier,
  formatModifier,
  DAMAGE_TYPE_NAMES,
} from '../../../lib/dnd.js';
import { rollAttack, rollDamage } from '../../../lib/dice.js';
import { useRoom } from '../../../store/socket.js';
import { resolveAttackEffects } from '../domain/combatRules.js';
import { rangeValidation, weaponGeometry } from '../domain/combatGeometry.js';

// Golpe desarmado de 5e: ataque FUE + competencia, daño fijo 1 + FUE
function unarmedWeapon(char) {
  const str = abilityModifier(char.abilities.str);
  return {
    id: 'desarmado',
    name: 'Golpe desarmado',
    unarmed: true,
    attackBonus: str + proficiencyBonus(char.level),
    damageTotal: Math.max(1, 1 + str),
  };
}

// Chips con los d20 de la tirada: con ventaja/desventaja se ven los dos
// dados y el descartado queda tachado; el 20 natural en dorado, el 1 en rojo
export function D20Chips({ roll }) {
  const group = roll.groups?.find((g) => g.sides === 20);
  if (!group) return null;
  return (
    <span className="flex items-center gap-0.5">
      {group.results.map((r, i) =>
        r.rolls.map((value, j) => {
          const discarded = r.rolls.length > 1 && value !== r.kept;
          return (
            <span
              key={`${i}-${j}`}
              className={`rounded-sm border px-1.5 py-0.5 font-mono ${
                discarded
                  ? 'border-bone/10 text-bone/30 line-through'
                  : value === 20
                    ? 'border-gold bg-gold/15 text-gold'
                    : value === 1
                      ? 'border-blood bg-blood/15 text-blood'
                      : 'border-bone/25 text-bone/90'
              }`}
            >
              {value}
            </span>
          );
        })
      )}
    </span>
  );
}

/**
 * Panel de combate del tablero: con tu token seleccionado y un objetivo
 * pulsado, ataca con tus armas equipadas. El cliente tira los dados (los ve
 * toda la mesa), y el servidor resuelve el impacto contra la CA y aplica el
 * daño; aquí se desglosa el porqué: dados, bonificador, total contra la CA,
 * y cuánta vida ha quitado el golpe.
 */
export default function AttackPanel({
  attacker,
  target,
  attackerCombatant,
  targetCombatant,
  distance = Infinity,
  highGround = false,
  lineOfSight = true,
  onClose,
}) {
  const attackTarget = useRoom((s) => s.attackTarget);
  const dealDamage = useRoom((s) => s.dealDamage);
  const [char, setChar] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [thrownModes, setThrownModes] = useState({});
  // Resultado de la última acción, anclado a su arma:
  // { type: 'attack', weaponId, hit, crit, ac, roll } |
  // { type: 'damage', weaponId, damage, remainingHp, maxHp, defeated }
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setChar(null);
    setFeedback(null);
    setError('');
    api(`/characters/${attacker.characterId}`)
      .then(async ({ character }) => {
        const inventory = await Promise.all(
          character.inventory.map(async (item) => {
            if (!item.weapon || item.weapon.range || !item.srdIndex) return item;
            try {
              const detail = await api(`/srd/equipment/${item.srdIndex}`);
              return {
                ...item,
                weapon: {
                  ...item.weapon,
                  range: detail.data?.range ?? null,
                  throwRange: detail.data?.throw_range ?? null,
                  properties:
                    item.weapon.properties?.length
                      ? item.weapon.properties
                      : (detail.data?.properties ?? []).map((property) => property.index),
                },
              };
            } catch {
              return item;
            }
          })
        );
        if (!cancelled) setChar({ ...character, inventory });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar tu ficha.');
      });
    return () => {
      cancelled = true;
    };
  }, [attacker.characterId]);

  // Al cambiar de objetivo se descarta el resultado pendiente
  useEffect(() => setFeedback(null), [target.id]);

  const targetRef = target.serverId
    ? { kind: 'marcador', id: target.serverId }
    : { kind: 'personaje', id: target.characterId };

  const weapons = char ? char.inventory.filter((i) => i.weapon && i.equipped) : [];
  const rows = char ? [...weapons, unarmedWeapon(char)] : [];

  function effectsFor(row, manualAdvantage = 'none', thrown = false) {
    const geometry = row.unarmed
      ? { ranged: false, reach: 1, normalRange: null, longRange: null }
      : weaponGeometry(row.weapon, { thrown });
    const range = rangeValidation(distance, geometry);
    const attackerConditions = [
      ...(attackerCombatant?.conditions ?? []),
      ...(attackerCombatant?.downed ? ['inconsciente'] : []),
    ];
    const targetConditions = [
      ...(targetCombatant?.conditions ?? []),
      ...(targetCombatant?.downed ? ['inconsciente'] : []),
    ];
    return resolveAttackEffects({
      attackerConditions,
      targetConditions,
      targetStance: targetCombatant?.stance,
      distance,
      highGround,
      ranged: geometry.ranged,
      longRange: Boolean(range.longRange),
      manualAdvantage,
    });
  }

  async function attack(row, manualAdvantage) {
    if (!char || busy) return;
    const thrown = !row.unarmed && Boolean(thrownModes[row.id]);
    const geometry = row.unarmed
      ? { ranged: false, reach: 1, normalRange: null, longRange: null }
      : weaponGeometry(row.weapon, { thrown });
    const range = rangeValidation(distance, geometry);
    if (!range.ok) {
      setError(range.error);
      return;
    }
    if (!lineOfSight) {
      setError('No hay línea de visión hasta el objetivo.');
      return;
    }
    const effects = effectsFor(row, manualAdvantage, thrown);
    if (effects.blocked) {
      setError('Tus condiciones actuales te impiden atacar.');
      return;
    }
    setBusy(true);
    setError('');
    const bonus = row.unarmed ? row.attackBonus : weaponAttackBonus(char, row.weapon);
    const roll = rollAttack(bonus, {
      advantage: effects.advantage,
      label: `${row.name} — ataque contra ${target.name}`,
      actorName: char.name,
    });
    const resp = await attackTarget({
      characterId: char.id,
      target: targetRef,
      weaponId: row.id,
      thrown,
      manualAdvantage,
      roll,
    });
    setBusy(false);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    setFeedback({
      type: 'attack',
      weaponId: row.id,
      hit: resp.hit,
      crit: resp.crit,
      ac: resp.ac,
      roll,
      effects: resp.effects ?? effects,
    });
  }

  async function damage(row) {
    if (!char || busy || feedback?.type !== 'attack' || !feedback.hit) return;
    setBusy(true);
    setError('');
    const label = (typeName) =>
      `${row.name} — daño a ${target.name}${typeName ? ` (${typeName})` : ''}${feedback.crit ? ' crítico' : ''}`;
    let roll;
    if (row.unarmed) {
      // Daño fijo (1 + FUE): sin dados, se comparte como total plano
      roll = {
        kind: 'damage',
        label: label(''),
        actorName: char.name,
        formula: `1 ${formatModifier(row.damageTotal - 1)}`,
        groups: [],
        modifier: row.damageTotal - 1,
        advantage: 'none',
        total: row.damageTotal,
        crit: feedback.crit,
        fumble: false,
      };
    } else {
      roll = rollDamage(row.weapon.damageDice, {
        modifier: weaponDamageModifier(char, row.weapon),
        crit: feedback.crit,
        label: label(DAMAGE_TYPE_NAMES[row.weapon.damageType] ?? ''),
        actorName: char.name,
      });
    }
    const damageType = row.unarmed ? 'bludgeoning' : row.weapon.damageType ?? null;
    const resp = await dealDamage({
      characterId: char.id,
      target: targetRef,
      weaponId: row.id,
      components: [{ amount: roll.total, type: damageType }],
      roll,
    });
    setBusy(false);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    setFeedback({
      type: 'damage',
      weaponId: row.id,
      damage: resp.damage ?? roll.total,
      rolledDamage: resp.rolledDamage ?? roll.total,
      adjustments: resp.adjustments ?? [],
      tempAbsorbed: resp.tempAbsorbed ?? 0,
      remainingTempHp: resp.remainingTempHp,
      remainingHp: resp.remainingHp,
      maxHp: resp.maxHp,
      defeated: Boolean(resp.defeated),
    });
  }

  return (
    <div className="absolute bottom-20 left-1/2 z-20 w-[24rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-blood/40 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">
          {attacker.name} <span className="text-blood">⚔</span> {target.name}
          {Number.isInteger(target.hp) && Number.isInteger(target.hpMax) && (
            <span className="ml-2 font-mono text-xs text-bone/60">
              {Math.max(0, target.hp)}/{target.hpMax} HP
            </span>
          )}
        </p>
        <button onClick={onClose} aria-label="Cerrar combate" className="px-1 text-bone/60 hover:text-bone">
          ✕
        </button>
      </div>

      {!char && !error && <p className="text-sm text-bone/50">Cargando armas…</p>}
      {error && <p className="mb-2 text-xs text-blood">{error}</p>}

      <div className="space-y-2">
        {rows.map((row) => {
          const thrown = !row.unarmed && Boolean(thrownModes[row.id]);
          const canThrow = Boolean(row.weapon?.properties?.includes('thrown'));
          const bonus = row.unarmed ? row.attackBonus : weaponAttackBonus(char, row.weapon);
          const fb = feedback?.weaponId === row.id ? feedback : null;
          const automaticEffects = effectsFor(row, 'none', thrown);
          const geometry = row.unarmed
            ? { ranged: false, reach: 1, normalRange: null, longRange: null }
            : weaponGeometry(row.weapon, { thrown });
          const range = rangeValidation(distance, geometry);
          const geometryBlocked = !range.ok || !lineOfSight;
          const automaticReasons =
            automaticEffects.advantage === 'adv'
              ? automaticEffects.advantageReasons
              : automaticEffects.advantage === 'dis'
                ? automaticEffects.disadvantageReasons
                : [];
          return (
            <div key={row.id} className="rounded-sm border border-bone/10 bg-night-950/60 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {row.name}
                  {automaticEffects.advantage !== 'none' && (
                    <span className="ml-1.5 rounded-sm border border-moss/60 bg-moss/15 px-1 py-0.5 text-[0.6rem] uppercase tracking-wider text-bone/90">
                      {automaticEffects.advantage === 'adv' ? 'ventaja' : 'desventaja'} · {automaticReasons.join(', ')}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-bone/60">
                  {formatModifier(bonus)}
                  {row.unarmed ? ` · ${row.damageTotal} contundente` : ` · ${row.weapon.damageDice}`}
                </span>
              </div>
              {canThrow && (
                <div className="mt-1.5 flex gap-1 text-[0.65rem]">
                  <button
                    type="button"
                    onClick={() => {
                      setThrownModes((current) => ({ ...current, [row.id]: false }));
                      setFeedback(null);
                    }}
                    className={`rounded-sm border px-2 py-0.5 ${!thrown ? 'border-gold/50 text-gold' : 'border-bone/15 text-bone/45'}`}
                  >
                    Cuerpo a cuerpo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setThrownModes((current) => ({ ...current, [row.id]: true }));
                      setFeedback(null);
                    }}
                    className={`rounded-sm border px-2 py-0.5 ${thrown ? 'border-gold/50 text-gold' : 'border-bone/15 text-bone/45'}`}
                  >
                    Lanzar
                  </button>
                </div>
              )}
              {geometryBlocked && (
                <p className="mt-1 text-[0.65rem] text-blood">
                  {!lineOfSight ? 'Sin línea de visión' : range.error}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => attack(row, 'dis')}
                  disabled={busy || geometryBlocked}
                  className="rounded-sm border border-blood/50 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  Desv.
                </button>
                <button
                  onClick={() => attack(row, 'none')}
                  disabled={busy || geometryBlocked}
                  className={`rounded-sm border px-3 py-1 text-xs disabled:opacity-40 ${
                    automaticEffects.advantage === 'adv'
                      ? 'border-moss bg-moss/15 text-bone/90 hover:bg-moss/25'
                      : automaticEffects.advantage === 'dis'
                        ? 'border-blood/50 bg-blood/10 text-blood hover:bg-blood/20'
                      : 'border-gold/50 text-gold hover:bg-gold/10'
                  }`}
                >
                  {automaticEffects.advantage === 'adv'
                    ? 'Atacar (ventaja)'
                    : automaticEffects.advantage === 'dis'
                      ? 'Atacar (desventaja)'
                      : 'Atacar'}
                </button>
                <button
                  onClick={() => attack(row, 'adv')}
                  disabled={busy || geometryBlocked}
                  className="rounded-sm border border-moss px-2 py-1 text-xs text-bone/90 hover:bg-moss/20 disabled:opacity-40"
                >
                  Vent.
                </button>
              </div>

              <AnimatePresence mode="wait">
                {/* Paso 1 — ¿impacta?: dados + bonificador = total contra la CA */}
                {fb?.type === 'attack' && (
                  <motion.div
                    key="attack"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`mt-2 rounded-sm border p-2 ${
                      fb.hit ? 'border-gold/40 bg-gold/5' : 'border-bone/10 bg-night-900/70'
                    }`}
                  >
                    <p className="mb-1.5 font-display text-[0.65rem] uppercase tracking-widest text-bone/40">
                      Paso 1 · ¿impacta?
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <D20Chips roll={fb.roll} />
                      {fb.roll.modifier !== 0 && (
                        <span className="font-mono text-bone/70">{formatModifier(fb.roll.modifier)}</span>
                      )}
                      <span className="font-mono text-bone/70">
                        = <strong className="font-display text-xl text-bone">{fb.roll.total}</strong>
                      </span>
                      <span className="text-bone/50">contra CA {fb.ac}</span>
                    </div>
                    <motion.p
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
                      className={`mt-1.5 font-display text-lg uppercase tracking-widest ${
                        fb.hit ? 'text-gold' : 'text-bone/40'
                      }`}
                    >
                      {fb.hit ? `¡Impacta${fb.crit ? ' — crítico!' : '!'}` : 'Falla'}
                    </motion.p>
                    {fb.hit && (
                      <button
                        onClick={() => damage(row)}
                        disabled={busy}
                        className="mt-2 w-full rounded-sm bg-blood/80 px-3 py-1.5 text-xs font-medium text-bone hover:bg-blood disabled:opacity-40"
                      >
                        Paso 2 → Tirar daño{fb.crit ? ' crítico' : ''}
                      </button>
                    )}
                  </motion.div>
                )}

                {/* Paso 2 — daño: cuánta vida quita y cuánta le queda */}
                {fb?.type === 'damage' && (
                  <motion.div
                    key="damage"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 rounded-sm border border-blood/40 bg-blood/5 p-2"
                  >
                    <p className="mb-1.5 font-display text-[0.65rem] uppercase tracking-widest text-bone/40">
                      Paso 2 · daño
                    </p>
                    <div className="flex items-baseline gap-2">
                      <motion.span
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 14 }}
                        className="font-display text-2xl leading-none text-blood"
                      >
                        −{fb.damage}
                      </motion.span>
                      <span className="text-xs text-bone/50">daño aplicado</span>
                    </div>
                    {fb.rolledDamage !== fb.damage && (
                      <p className="mt-1 text-xs text-bone/60">
                        Tirada: {fb.rolledDamage} · aplicado tras defensas: {fb.damage}
                      </p>
                    )}
                    {fb.adjustments?.length > 0 && (
                      <p className="mt-1 text-xs text-gold/70">{fb.adjustments.join(' · ')}</p>
                    )}
                    {fb.tempAbsorbed > 0 && (
                      <p className="mt-1 text-xs text-moss">
                        {fb.tempAbsorbed === true
                          ? 'Los PG temporales absorben parte del golpe'
                          : `PG temporales absorbidos: ${fb.tempAbsorbed}`}
                        {fb.tempAbsorbed !== true && Number.isInteger(fb.remainingTempHp)
                          ? ` · quedan ${fb.remainingTempHp}`
                          : ''}
                      </p>
                    )}
                    {Number.isInteger(fb.remainingHp) && Number.isInteger(fb.maxHp) && (
                      <p className="mt-1 text-xs text-bone/70">
                        {target.name} queda en{' '}
                        <span className="font-mono">
                          {Math.max(0, fb.remainingHp)}/{fb.maxHp} HP
                        </span>
                      </p>
                    )}
                    {fb.defeated && (
                      <motion.p
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.15 }}
                        className="mt-1.5 font-display text-base uppercase tracking-widest text-gold"
                      >
                        ¡Cae derrotado!
                      </motion.p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[0.65rem] text-bone/40">
        Las tiradas se comparten con la mesa; el impacto y el daño los resuelve el servidor.
      </p>
    </div>
  );
}
