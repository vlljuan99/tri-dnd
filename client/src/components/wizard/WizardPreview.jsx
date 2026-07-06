import { ABILITIES, abilityModifier, formatModifier, PRIMARY_ABILITY, estimateHitPoints } from '../../lib/dnd.js';

/**
 * Vista previa compacta de la ficha durante el asistente.
 * No duplica estado: lee directamente del personaje temporal (`char`) que ya
 * gestiona el propio asistente, igual que hará la ficha final. Los puntos de
 * golpe y la clase de armadura se estiman con las mismas fórmulas que usará
 * el resumen final (lib/dnd.js), aunque el personaje todavía no los tenga
 * guardados.
 */
export default function WizardPreview({ char, classDisplayName, raceName, classDetail }) {
  if (!char) return null;
  const primary = char.class_index ? PRIMARY_ABILITY[char.class_index] : null;
  const conMod = abilityModifier(char.abilities.con);
  const dexMod = abilityModifier(char.abilities.dex);
  const hpEstimate = classDetail ? estimateHitPoints(classDetail.hit_die, conMod, char.level) : char.hp_max;
  const acEstimate = 10 + dexMod;

  return (
    <div className="space-y-3 text-bone">
      <div>
        <p className="font-display text-lg text-gold">{char.name || 'Sin nombre todavía'}</p>
        <p className="text-xs text-bone/60">
          {classDisplayName || 'Sin clase'} · {raceName || 'Sin raza'} · nivel {char.level}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {ABILITIES.map((a) => {
          const score = char.abilities[a.key];
          const mod = abilityModifier(score);
          const isPrimary = a.key === primary;
          return (
            <div
              key={a.key}
              className={`rounded-sm border p-1.5 text-center ${
                isPrimary ? 'border-gold/50 bg-gold/10' : 'border-bone/10 bg-night-950/50'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-bone/50">{a.short}</div>
              <div className="font-mono text-sm">{score}</div>
              <div className="font-mono text-xs text-bone/60">{formatModifier(mod)}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-sm border border-blood/30 bg-blood/5 px-2 py-1">HP {hpEstimate}</span>
        <span className="rounded-sm border border-bone/15 px-2 py-1">CA {acEstimate}</span>
        <span className="rounded-sm border border-bone/15 px-2 py-1">Velocidad {char.speed} pies</span>
      </div>

      {char.skill_proficiencies.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-bone/50">Competencias</p>
          <p className="text-xs text-bone/70">{char.skill_proficiencies.length} habilidades elegidas</p>
        </div>
      )}
    </div>
  );
}
