import { useEffect, useState } from 'react';
import { DAMAGE_TYPE_NAMES, weaponAttackBonus, weaponDamageModifier, formatModifier } from '../lib/dnd.js';
import { isProficientWithWeapon } from '../lib/proficiency.js';
import { rollAttack, rollDamage } from '../lib/dice.js';

// Fila de ataque de un arma equipada: botones de ataque (con ventaja/desventaja)
// y de daño (normal/crítico). Compartida por la ficha completa y la vista rápida.
export default function WeaponRow({ item, char, onRoll, disabled }) {
  const [twoHanded, setTwoHanded] = useState(false);
  const w = item.weapon;
  const bonus = weaponAttackBonus(char, item);
  const dmgMod = weaponDamageModifier(char, w);
  const proficient = char.kind === 'boss' || isProficientWithWeapon(char.weapon_proficiencies, item.srdIndex, w.weaponCategory);
  // A dos manos solo con el dado mayor si la secundaria está libre (Fase A).
  // El escudo también se empuña con esa mano, así que ocupa igual que un arma.
  const offHandFree = !(char?.inventory ?? []).some(
    (i) => i.id !== item.id && (i.slot === 'mano-secundaria' || i.slot === 'escudo')
  );
  const canGoTwoHanded = Boolean(w.versatileDice) && item.slot === 'mano-principal' && offHandFree;
  useEffect(() => {
    if (!canGoTwoHanded && twoHanded) setTwoHanded(false);
  }, [canGoTwoHanded, twoHanded]);
  const dice = twoHanded && canGoTwoHanded ? w.versatileDice : w.damageDice;
  const typeName = DAMAGE_TYPE_NAMES[w.damageType] ?? '';

  function attack(advantage) {
    onRoll(rollAttack(bonus, { advantage, label: `${item.name} — ataque`, actorName: char.name }));
  }
  function damage(crit) {
    onRoll(
      rollDamage(dice, {
        modifier: dmgMod,
        crit,
        label: `${item.name} — daño${typeName ? ` (${typeName})` : ''}${crit ? ' crítico' : ''}`,
        actorName: char.name,
      })
    );
  }

  return (
    <div className="rounded-sm border border-bone/10 bg-night-950/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {item.name}
          {!proficient && (
            <span className="ml-1.5 rounded-sm border border-bone/20 px-1 py-0.5 text-[0.6rem] uppercase tracking-wider text-bone/50">
              sin competencia
            </span>
          )}
        </span>
        <span className="font-mono text-sm text-bone/70">
          {formatModifier(bonus)} · {dice}
          {dmgMod !== 0 ? formatModifier(dmgMod) : ''} {typeName}
        </span>
      </div>
      {w.versatileDice && (
        <label className="mt-1 flex items-center gap-2 text-xs text-bone/60">
          <input
            type="checkbox"
            checked={twoHanded && canGoTwoHanded}
            disabled={!canGoTwoHanded}
            onChange={(e) => setTwoHanded(e.target.checked)}
            className="accent-gold"
          />
          A dos manos ({w.versatileDice}){!canGoTwoHanded ? ' — necesitas la mano secundaria libre' : ''}
        </label>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={() => attack('dis')} disabled={disabled} className="rounded-sm border border-blood/50 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40">
          Desv.
        </button>
        <button onClick={() => attack('none')} disabled={disabled} className="rounded-sm border border-gold/50 px-3 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40">
          Atacar
        </button>
        <button onClick={() => attack('adv')} disabled={disabled} className="rounded-sm border border-moss px-2 py-1 text-xs text-bone/90 hover:bg-moss/20 disabled:opacity-40">
          Vent.
        </button>
        <span className="mx-1 text-bone/20">|</span>
        <button onClick={() => damage(false)} disabled={disabled} className="rounded-sm border border-bone/30 px-3 py-1 text-xs hover:bg-bone/10 disabled:opacity-40">
          Daño
        </button>
        <button onClick={() => damage(true)} disabled={disabled} className="rounded-sm border border-gold/40 px-2 py-1 text-xs text-gold/90 hover:bg-gold/10 disabled:opacity-40">
          ¡Crítico!
        </button>
      </div>
    </div>
  );
}
