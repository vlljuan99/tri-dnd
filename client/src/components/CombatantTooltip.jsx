import StatTooltip from './StatTooltip.jsx';
import { useRoom } from '../store/socket.js';
import { ConditionChips, DeathSaveDots } from '../features/tactical-map/components/CombatantStatus.jsx';

/**
 * Envuelve el nombre de un combatiente (en el registro de chat, o el nombre
 * grande de una RollCard) con un bocadillo de estado rápido: PG/CA,
 * condiciones activas y salvaciones de muerte si está agonizando — lo mismo
 * que ya se ve en el orden de iniciativa, pero sin tener que abrir esa
 * pestaña. Si el nombre no corresponde a ningún combatiente del tracker
 * actual (un PNJ narrado, alguien fuera de combate, un nombre ya fuera del
 * tracker), se renderiza como texto plano, sin bocadillo.
 */
export default function CombatantTooltip({ name, className, children }) {
  const combatants = useRoom((s) => s.combat.combatants);
  const combatant = combatants.find((c) => c.name === name);
  if (!combatant) return <span className={className}>{children}</span>;

  const knowsHp = Number.isInteger(combatant.hpCurrent) && Number.isInteger(combatant.hpMax);
  const hasConditions = combatant.conditions?.length > 0;

  const body = (
    <span className="block space-y-1">
      {knowsHp && (
        <span className="block font-mono text-xs text-bone/80">
          PG {combatant.hpCurrent}/{combatant.hpMax}
          {combatant.ac != null ? ` · CA ${combatant.ac}` : ''}
        </span>
      )}
      {combatant.dead ? (
        <span className="block text-xs text-blood">☠ Muerto</span>
      ) : combatant.downed ? (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-blood">Agonizando</span>
          <DeathSaveDots saves={combatant.deathSaves} />
        </span>
      ) : null}
      {hasConditions && <ConditionChips conditions={combatant.conditions} />}
      {!knowsHp && !combatant.downed && !hasConditions && (
        <span className="block text-xs italic text-bone/50">Sin más datos ahora mismo</span>
      )}
    </span>
  );

  return (
    <StatTooltip term={combatant.name} desc={body} className={className}>
      {children}
    </StatTooltip>
  );
}
