import { useEffect, useState } from 'react';
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
function D20Chips({ roll }) {
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
export default function AttackPanel({ attacker, target, onClose }) {
  const attackTarget = useRoom((s) => s.attackTarget);
  const dealDamage = useRoom((s) => s.dealDamage);
  const [char, setChar] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      .then(({ character }) => {
        if (!cancelled) setChar(character);
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

  async function attack(row, advantage) {
    if (!char || busy) return;
    setBusy(true);
    setError('');
    const bonus = row.unarmed ? row.attackBonus : weaponAttackBonus(char, row.weapon);
    const roll = rollAttack(bonus, {
      advantage,
      label: `${row.name} — ataque contra ${target.name}`,
      actorName: char.name,
    });
    const resp = await attackTarget({
      characterId: char.id,
      target: targetRef,
      weaponName: row.name,
      melee: row.unarmed || row.weapon.weaponRange !== 'Ranged',
      roll,
    });
    setBusy(false);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    setFeedback({ type: 'attack', weaponId: row.id, hit: resp.hit, crit: resp.crit, ac: resp.ac, roll });
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
    const resp = await dealDamage({ characterId: char.id, target: targetRef, roll });
    setBusy(false);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    setFeedback({
      type: 'damage',
      weaponId: row.id,
      damage: resp.damage ?? roll.total,
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
          const bonus = row.unarmed ? row.attackBonus : weaponAttackBonus(char, row.weapon);
          const fb = feedback?.weaponId === row.id ? feedback : null;
          return (
            <div key={row.id} className="rounded-sm border border-bone/10 bg-night-950/60 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                <span className="font-mono text-xs text-bone/60">
                  {formatModifier(bonus)}
                  {row.unarmed ? ` · ${row.damageTotal} contundente` : ` · ${row.weapon.damageDice}`}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => attack(row, 'dis')}
                  disabled={busy}
                  className="rounded-sm border border-blood/50 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  Desv.
                </button>
                <button
                  onClick={() => attack(row, 'none')}
                  disabled={busy}
                  className="rounded-sm border border-gold/50 px-3 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
                >
                  Atacar
                </button>
                <button
                  onClick={() => attack(row, 'adv')}
                  disabled={busy}
                  className="rounded-sm border border-moss px-2 py-1 text-xs text-bone/90 hover:bg-moss/20 disabled:opacity-40"
                >
                  Vent.
                </button>
              </div>

              {/* Desglose del ataque: dados + bonificador = total contra la CA */}
              {fb?.type === 'attack' && (
                <div className="mt-2 rounded-sm border border-bone/10 bg-night-900/70 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <D20Chips roll={fb.roll} />
                    {fb.roll.modifier !== 0 && (
                      <span className="font-mono text-bone/70">{formatModifier(fb.roll.modifier)}</span>
                    )}
                    <span className="font-mono">
                      = <strong className="text-base">{fb.roll.total}</strong>
                    </span>
                    <span className="text-bone/50">contra CA {fb.ac}</span>
                    <span
                      className={`font-display uppercase tracking-widest ${
                        fb.hit ? 'text-gold' : 'text-bone/50'
                      }`}
                    >
                      {fb.hit ? `→ ¡impacta${fb.crit ? ' (crítico)' : ''}!` : '→ falla'}
                    </span>
                  </div>
                  {fb.hit && (
                    <button
                      onClick={() => damage(row)}
                      disabled={busy}
                      className="mt-2 rounded-sm bg-blood/80 px-3 py-1 text-xs font-medium text-bone hover:bg-blood disabled:opacity-40"
                    >
                      Tirar daño{fb.crit ? ' crítico' : ''}
                    </button>
                  )}
                </div>
              )}

              {/* Resultado del daño: cuánta vida quita y cuánta le queda */}
              {fb?.type === 'damage' && (
                <div className="mt-2 rounded-sm border border-blood/25 bg-night-900/70 p-2 text-xs">
                  <span className="font-mono text-blood">−{fb.damage} HP</span>
                  {Number.isInteger(fb.remainingHp) && Number.isInteger(fb.maxHp) && (
                    <span className="ml-2 text-bone/70">
                      {target.name} queda en{' '}
                      <span className="font-mono">
                        {Math.max(0, fb.remainingHp)}/{fb.maxHp} HP
                      </span>
                    </span>
                  )}
                  {fb.defeated && (
                    <span className="ml-2 font-display uppercase tracking-widest text-gold">
                      ¡cae derrotado!
                    </span>
                  )}
                </div>
              )}
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
