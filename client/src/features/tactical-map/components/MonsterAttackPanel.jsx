import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../api.js';
import { formatModifier } from '../../../lib/dnd.js';
import { rollAttack, rollDamage } from '../../../lib/dice.js';
import { useRoom } from '../../../store/socket.js';
import { D20Chips } from './AttackPanel.jsx';
import { parseDamageDice, extractDamageFromDesc, DAMAGE_TYPE_ES } from '../../../components/MonsterStatBlock.jsx';
import { resolveAttackEffects } from '../domain/combatRules.js';
import { buildMultiattackPlans, planCountLabel, planSummary } from '../domain/monsterActions.js';
import { monsterAttackGeometry, rangeValidation } from '../domain/combatGeometry.js';

// Del texto de la acción del SRD ("Melee Weapon Attack:"/"Ranged Weapon
// Attack:") se deduce si exige adyacencia; sin pista clara se asume cuerpo a
// cuerpo (lo más común en el compendio), el servidor igualmente re-valida.
function isRangedAction(action) {
  return /ranged/i.test(`${action.name} ${action.desc ?? ''}`);
}

// Acciones atacables del monstruo, con los deltas de la variante por
// instancia (Fase 17) ya aplicados — mismo cálculo que MonsterStatsContent,
// pero aquí cada fila lleva además el flag de adyacencia para el ataque real.
function buildRowsFromMonster(data, overrides) {
  const atkDelta = Number.isInteger(overrides.attackBonus) ? overrides.attackBonus : 0;
  const dmgDelta = Number.isInteger(overrides.damageBonus) ? overrides.damageBonus : 0;
  return (data.actions ?? [])
    .map((action, i) => {
      const canAttack = Number.isInteger(action.attack_bonus);
      const explicit = (action.damage ?? [])
        .map((d) => ({
          parsed: parseDamageDice(d.damage_dice),
          type: d.damage_type?.index ?? null,
          typeName: DAMAGE_TYPE_ES[d.damage_type?.index] ?? d.damage_type?.name ?? '',
        }))
        .filter((d) => d.parsed);
      const damageOptions = (explicit.length > 0 ? explicit : extractDamageFromDesc(action.desc)).map((d, damageIndex) => ({
        ...d,
        type: d.type ?? null,
        parsed: { ...d.parsed, modifier: d.parsed.modifier + (damageIndex === 0 ? dmgDelta : 0) },
      }));
      return {
        id: `action-${i}`,
        actionName: action.name,
        name: action.name,
        attackBonus: canAttack ? action.attack_bonus + atkDelta : null,
        damageOptions,
        melee: !isRangedAction(action),
        geometry: monsterAttackGeometry(action),
      };
    })
    .filter((row) => row.attackBonus != null);
}

function combineDamageRolls(rolls, { label, actorName, crit }) {
  const groups = new Map();
  for (const roll of rolls) {
    for (const group of roll.groups ?? []) {
      const key = `${group.die}:${group.sides}`;
      const current = groups.get(key) ?? { ...group, results: [] };
      current.results.push(...group.results);
      groups.set(key, current);
    }
  }
  return {
    kind: 'damage',
    label,
    actorName,
    formula: rolls.map((roll) => roll.formula).join(' + '),
    groups: [...groups.values()],
    modifier: rolls.reduce((sum, roll) => sum + (roll.modifier ?? 0), 0),
    advantage: 'none',
    total: rolls.reduce((sum, roll) => sum + roll.total, 0),
    crit,
    fumble: false,
  };
}

/**
 * Panel de combate del tablero para un enemigo/aliado controlado por el DM:
 * mismo flujo en dos pasos que AttackPanel (impacto → daño), pero el
 * atacante no tiene ficha de personaje, así que sus ataques salen de su
 * ficha de monstruo del SRD (con la variante por instancia aplicada). Si no
 * tiene monstruo enlazado (un enemigo añadido a mano), se ofrece un ataque
 * manual con bonificador y dados de daño libres.
 */
export default function MonsterAttackPanel({
  attacker,
  target,
  attackerCombatant,
  targetCombatant,
  distance = Infinity,
  highGround = false,
  lineOfSight = true,
  onClose,
}) {
  const attackMarker = useRoom((s) => s.attackMarker);
  const dealDamageMarker = useRoom((s) => s.dealDamageMarker);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualBonus, setManualBonus] = useState('0');
  const [manualDice, setManualDice] = useState('1d6');
  const [manualMelee, setManualMelee] = useState(true);
  const [manualNormalRange, setManualNormalRange] = useState('60');
  const [manualLongRange, setManualLongRange] = useState('120');
  const [manualDamageType, setManualDamageType] = useState('slashing');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [multiattackCounts, setMultiattackCounts] = useState({});
  const [multiattackNotice, setMultiattackNotice] = useState('');
  const [multiattackState, setMultiattackState] = useState(attackerCombatant?.multiattackState ?? {});
  // { type: 'attack', weaponId, hit, crit, ac, roll } | { type: 'damage', weaponId, damage, remainingHp, maxHp, defeated }
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    setData(null);
    setLoadError('');
    setFeedback(null);
    setError('');
    setSelectedPlanId('');
    setMultiattackCounts({});
    setMultiattackNotice('');
    if (!attacker.monsterIndex) return;
    api(`/srd/monsters/${attacker.monsterIndex}`)
      .then((entry) => setData(entry.data))
      .catch(() => setLoadError('No se pudo cargar la ficha del monstruo: usa el ataque manual.'));
  }, [attacker.monsterIndex]);

  useEffect(() => setFeedback(null), [target.id]);
  useEffect(() => {
    setMultiattackState(attackerCombatant?.multiattackState ?? {});
  }, [attackerCombatant?.multiattackState]);

  const targetRef = target.serverId
    ? { kind: 'marcador', id: target.serverId }
    : { kind: 'personaje', id: target.characterId };

  const overrides = attacker.overrides ?? {};
  const monsterRows = data ? buildRowsFromMonster(data, overrides) : [];
  const rows =
    monsterRows.length > 0
      ? monsterRows
      : [{ id: 'manual', actionName: 'Ataque manual', name: 'Ataque manual', manual: true, melee: manualMelee }];
  const multiattackPlans = data ? buildMultiattackPlans(data) : [];
  const activePlanId = multiattackState?.planId ?? '';
  const effectivePlanId = activePlanId || selectedPlanId;
  const effectivePlan = multiattackPlans.find((plan) => plan.id === effectivePlanId) ?? null;
  const variableCountAction = !activePlanId
    ? effectivePlan?.actions.find((entry) => entry.variableCount === 'heads')
    : null;

  function sequenceEntryFor(row) {
    if (!effectivePlan) return null;
    const source = activePlanId ? multiattackState.remaining ?? [] : effectivePlan.actions;
    return source.find((entry) => entry.actionName.toLowerCase() === row.actionName.toLowerCase()) ?? null;
  }

  function remainingFor(row) {
    const entry = sequenceEntryFor(row);
    if (!entry) return effectivePlan ? 0 : null;
    if (!activePlanId && entry.countFormula) return 1;
    return entry.count;
  }

  function meleeFor(row) {
    if (row.manual) return manualMelee;
    const sequenceType = sequenceEntryFor(row)?.type;
    if (sequenceType === 'melee') return true;
    if (sequenceType === 'ranged') return false;
    return row.melee;
  }

  function geometryFor(row) {
    const melee = meleeFor(row);
    const base = row.manual
      ? {
          ranged: !melee,
          reach: melee ? 1 : 0,
          normalRange: melee ? null : Math.max(1, Math.ceil((Number(manualNormalRange) || 60) / 5)),
          longRange: melee ? null : Math.max(1, Math.ceil((Number(manualLongRange) || 120) / 5)),
        }
      : row.geometry;
    return { ...base, ranged: !melee, reach: melee ? base.reach || 1 : 0 };
  }

  function effectsFor(row, manualAdvantage = 'none') {
    const geometry = geometryFor(row);
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
    if (busy) return;
    if (effectivePlan && remainingFor(row) <= 0) {
      setError('Ese golpe no está disponible en el multiataque elegido.');
      return;
    }
    const range = rangeValidation(distance, geometryFor(row));
    if (!range.ok) {
      setError(range.error);
      return;
    }
    if (!lineOfSight) {
      setError('No hay línea de visión hasta el objetivo.');
      return;
    }
    const effects = effectsFor(row, manualAdvantage);
    if (effects.blocked) {
      setError('Las condiciones actuales impiden atacar.');
      return;
    }
    setBusy(true);
    setError('');
    const bonus = row.manual ? Number(manualBonus) || 0 : row.attackBonus ?? 0;
    const roll = rollAttack(bonus, {
      advantage: effects.advantage,
      label: `${row.name} — ataque contra ${target.name}`,
      actorName: attacker.name,
    });
    const resp = await attackMarker({
      tokenId: attacker.serverId,
      target: targetRef,
      actionName: row.actionName,
      manualMelee: meleeFor(row),
      manualNormalRange: Number(manualNormalRange) || 60,
      manualLongRange: Number(manualLongRange) || 120,
      manualAdvantage,
      multiattackPlanId: effectivePlanId || null,
      multiattackCounts,
      roll,
    });
    setBusy(false);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    setMultiattackState(resp.multiattackState ?? {});
    if (resp.multiattackResolved?.length) {
      setMultiattackNotice(
        `Secuencia: ${resp.multiattackResolved.map((entry) => `${entry.count}× ${entry.actionName}`).join(' + ')}`
      );
    }
    if (resp.multiattackCompleted) setSelectedPlanId('');
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
    if (busy || feedback?.type !== 'attack' || !feedback.hit) return;
    setBusy(true);
    setError('');
    let roll;
    let components;
    if (row.manual) {
      const parsed = parseDamageDice(manualDice);
      if (!parsed) {
        setBusy(false);
        setError('Dados de daño no válidos (ej. 2d6)');
        return;
      }
      roll = rollDamage(parsed.dice, {
        modifier: parsed.modifier,
        crit: feedback.crit,
        label: `${row.name} — daño a ${target.name}${feedback.crit ? ' crítico' : ''}`,
        actorName: attacker.name,
      });
      components = [{ amount: roll.total, type: manualDamageType }];
    } else {
      const rolls = row.damageOptions.map((opt) =>
        rollDamage(opt.parsed.dice, {
          modifier: opt.parsed.modifier,
          crit: feedback.crit,
          label: `${row.name} — ${opt.typeName || 'daño'}`,
          actorName: attacker.name,
        })
      );
      components = rolls.map((componentRoll, index) => ({
        amount: componentRoll.total,
        type: row.damageOptions[index].type,
      }));
      roll = combineDamageRolls(rolls, {
        label: `${row.name} — daño a ${target.name}${feedback.crit ? ' crítico' : ''}`,
        actorName: attacker.name,
        crit: feedback.crit,
      });
    }
    const resp = await dealDamageMarker({
      tokenId: attacker.serverId,
      target: targetRef,
      actionName: row.actionName,
      components,
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

      {loadError && <p className="mb-2 text-xs text-gold/70">{loadError}</p>}
      {error && <p className="mb-2 text-xs text-blood">{error}</p>}

      {multiattackPlans.length > 0 && (
        <label className="mb-2 block text-xs text-bone/60">
          Acción de ataque
          <select
            value={effectivePlanId}
            disabled={Boolean(activePlanId) || busy}
            onChange={(event) => {
              setSelectedPlanId(event.target.value);
              setMultiattackCounts({});
              setMultiattackNotice('');
              setFeedback(null);
            }}
            className="mt-1 w-full rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-bone focus:border-gold focus:outline-none disabled:opacity-60"
          >
            <option value="">Un solo ataque</option>
            {multiattackPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.label}: {planSummary(plan)}
              </option>
            ))}
          </select>
          {activePlanId && (
            <span className="mt-1 block text-gold/70">
              En curso: {(multiattackState.remaining ?? []).map((entry) => `${entry.count}× ${entry.actionName}`).join(' + ')}
            </span>
          )}
          {variableCountAction && (
            <span className="mt-1 flex items-center gap-2 text-gold/70">
              Cabezas actuales
              <input
                type="number"
                min="1"
                max="20"
                value={
                  multiattackCounts[variableCountAction.actionName] ?? variableCountAction.count
                }
                onChange={(event) => {
                  setMultiattackCounts((current) => ({
                    ...current,
                    [variableCountAction.actionName]: Math.max(
                      1,
                      Math.min(20, Number(event.target.value) || 1)
                    ),
                  }));
                }}
                className="w-14 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 font-mono text-bone focus:border-gold focus:outline-none"
              />
            </span>
          )}
          {multiattackNotice && <span className="mt-1 block text-bone/50">{multiattackNotice}</span>}
        </label>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const fb = feedback?.weaponId === row.id ? feedback : null;
          const remaining = remainingFor(row);
          const unavailable = effectivePlan && remaining <= 0;
          const automaticEffects = effectsFor(row, 'none');
          const range = rangeValidation(distance, geometryFor(row));
          const geometryBlocked = !range.ok || !lineOfSight;
          const automaticReasons =
            automaticEffects.advantage === 'adv'
              ? automaticEffects.advantageReasons
              : automaticEffects.advantage === 'dis'
                ? automaticEffects.disadvantageReasons
                : [];
          return (
            <div key={row.id} className={`rounded-sm border border-bone/10 bg-night-950/60 p-2 ${unavailable ? 'opacity-45' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {row.name}
                  {remaining > 0 && (
                    <span className="ml-1 text-[0.65rem] text-gold/70">
                      ×{activePlanId ? remaining : planCountLabel(sequenceEntryFor(row))}
                    </span>
                  )}
                  {automaticEffects.advantage !== 'none' && (
                    <span className="ml-1.5 rounded-sm border border-moss/50 px-1 py-0.5 text-[0.58rem] uppercase text-bone/80">
                      {automaticEffects.advantage === 'adv' ? 'ventaja' : 'desventaja'} · {automaticReasons.join(', ')}
                    </span>
                  )}
                </span>
                {!row.manual && row.attackBonus != null && (
                  <span className="font-mono text-xs text-bone/60">{formatModifier(row.attackBonus)}</span>
                )}
              </div>
              {geometryBlocked && (
                <p className="mt-1 text-[0.65rem] text-blood">
                  {!lineOfSight ? 'Sin línea de visión' : range.error}
                </p>
              )}

              {row.manual && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <label className="flex items-center gap-1 text-bone/60">
                    Bonif.
                    <input
                      type="number"
                      value={manualBonus}
                      onChange={(e) => setManualBonus(e.target.value)}
                      className="w-12 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-bone focus:border-gold focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-bone/60">
                    Daño
                    <input
                      value={manualDice}
                      onChange={(e) => setManualDice(e.target.value)}
                      placeholder="1d6+2"
                      className="w-16 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-bone focus:border-gold focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-bone/60">
                    <input
                      type="checkbox"
                      checked={manualMelee}
                      onChange={(e) => setManualMelee(e.target.checked)}
                    />
                    Cuerpo a cuerpo
                  </label>
                  {!manualMelee && (
                    <label className="flex items-center gap-1 text-bone/60">
                      Alcance
                      <input
                        type="number"
                        min="5"
                        max="1000"
                        step="5"
                        value={manualNormalRange}
                        onChange={(e) => setManualNormalRange(e.target.value)}
                        className="w-14 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-bone focus:border-gold focus:outline-none"
                      />
                      /
                      <input
                        type="number"
                        min="5"
                        max="2000"
                        step="5"
                        value={manualLongRange}
                        onChange={(e) => setManualLongRange(e.target.value)}
                        className="w-14 rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-bone focus:border-gold focus:outline-none"
                      />
                      pies
                    </label>
                  )}
                  <label className="flex items-center gap-1 text-bone/60">
                    Tipo
                    <select
                      value={manualDamageType}
                      onChange={(e) => setManualDamageType(e.target.value)}
                      className="rounded-sm border border-bone/20 bg-night-950 px-1 py-0.5 text-bone focus:border-gold focus:outline-none"
                    >
                      {Object.entries(DAMAGE_TYPE_ES).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => attack(row, 'dis')}
                  disabled={busy || unavailable || geometryBlocked}
                  className="rounded-sm border border-blood/50 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  Desv.
                </button>
                <button
                  onClick={() => attack(row, 'none')}
                  disabled={busy || unavailable || geometryBlocked}
                  className={`rounded-sm border px-3 py-1 text-xs disabled:opacity-40 ${
                    automaticEffects.advantage === 'adv'
                      ? 'border-moss bg-moss/15 text-bone/90'
                      : automaticEffects.advantage === 'dis'
                        ? 'border-blood/50 bg-blood/10 text-blood'
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
                  disabled={busy || unavailable || geometryBlocked}
                  className="rounded-sm border border-moss px-2 py-1 text-xs text-bone/90 hover:bg-moss/20 disabled:opacity-40"
                >
                  Vent.
                </button>
              </div>

              <AnimatePresence mode="wait">
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
                    {fb.hit && (row.manual || row.damageOptions.length > 0) && (
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
                        PG temporales absorbidos: {fb.tempAbsorbed}
                        {Number.isInteger(fb.remainingTempHp) ? ` · quedan ${fb.remainingTempHp}` : ''}
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
