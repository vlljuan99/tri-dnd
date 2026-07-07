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

/**
 * Panel de combate del tablero: con tu token seleccionado y un objetivo
 * pulsado, ataca con tus armas equipadas. El cliente tira los dados (los ve
 * toda la mesa), pero el impacto contra la CA y el daño los resuelve el
 * servidor: la CA del enemigo nunca llega al jugador.
 */
export default function AttackPanel({ attacker, target, onClose }) {
  const attackTarget = useRoom((s) => s.attackTarget);
  const dealDamage = useRoom((s) => s.dealDamage);
  const [char, setChar] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Último ataque resuelto: { weaponId, hit, crit } — habilita el botón de daño
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setChar(null);
    setOutcome(null);
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

  // Al cambiar de objetivo se descarta el impacto pendiente
  useEffect(() => setOutcome(null), [target.id]);

  const targetRef = target.serverId
    ? { kind: 'marcador', id: target.serverId }
    : { kind: 'personaje', id: target.characterId };

  const weapons = char ? char.inventory.filter((i) => i.weapon && i.equipped) : [];

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
    setOutcome({ weaponId: row.id, hit: resp.hit, crit: resp.crit });
  }

  async function damage(row) {
    if (!char || busy || !outcome?.hit) return;
    setBusy(true);
    setError('');
    const label = (typeName) =>
      `${row.name} — daño a ${target.name}${typeName ? ` (${typeName})` : ''}${outcome.crit ? ' crítico' : ''}`;
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
        crit: outcome.crit,
        fumble: false,
      };
    } else {
      roll = rollDamage(row.weapon.damageDice, {
        modifier: weaponDamageModifier(char, row.weapon),
        crit: outcome.crit,
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
    setOutcome(null);
  }

  const rows = char ? [...weapons, unarmedWeapon(char)] : [];

  return (
    <div className="absolute bottom-20 left-1/2 z-20 w-[22rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-blood/40 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">
          {attacker.name} <span className="text-blood">⚔</span> {target.name}
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
          const resolvedHere = outcome?.weaponId === row.id;
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
                {resolvedHere && outcome.hit && (
                  <>
                    <span className="font-display text-xs uppercase tracking-widest text-gold">
                      ¡Impacta{outcome.crit ? ' (crítico)' : ''}!
                    </span>
                    <button
                      onClick={() => damage(row)}
                      disabled={busy}
                      className="rounded-sm bg-blood/80 px-3 py-1 text-xs font-medium text-bone hover:bg-blood disabled:opacity-40"
                    >
                      Tirar daño
                    </button>
                  </>
                )}
                {resolvedHere && !outcome.hit && (
                  <span className="font-display text-xs uppercase tracking-widest text-bone/50">Falla.</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[0.65rem] text-bone/40">
        Las tiradas se comparten con la mesa; el impacto lo decide el servidor sin revelar la CA.
      </p>
    </div>
  );
}
