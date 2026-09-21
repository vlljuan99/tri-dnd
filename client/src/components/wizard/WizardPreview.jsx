import { ABILITIES, SKILLS, abilityModifier, formatModifier, PRIMARY_ABILITY, DAMAGE_TYPE_NAMES } from '../../lib/dnd.js';
import { deriveWizardPreview, previewCharacter, wizardPreviewDeltas } from '../../lib/wizardPreview.js';
import { saveStat, skillStat } from '../../lib/statGlossary.js';
import { hasChosenName } from '../../lib/wizard.js';
import StatTooltip from '../StatTooltip.jsx';

function Change({ from, to }) {
  if (from === to) return null;
  return <span className={`ml-1 font-mono text-[10px] ${to > from ? 'text-emerald-300' : 'text-amber-300'}`}>({formatModifier(to - from)})</span>;
}

/** La ficha se anticipa con los espejos del cliente; el servidor sigue validando al guardar. */
export default function WizardPreview({
  char, classDisplayName, raceName, classDetail, raceDetail, classDetails, raceDetails, preview,
}) {
  if (!char) return null;
  const context = { classDetail, raceDetail, classDetails, raceDetails };
  const current = deriveWizardPreview(char, context);
  const anticipated = preview?.fields ? deriveWizardPreview(previewCharacter(char, preview.fields), context) : current;
  const changes = preview?.fields ? wizardPreviewDeltas(current, anticipated) : [];
  const primary = classDetail?.spellcasting?.spellcasting_ability?.index ?? PRIMARY_ABILITY[char.class_index];
  const chosenSkills = SKILLS.filter((skill) => anticipated.character.skill_proficiencies.includes(skill.index));
  const otherSkills = SKILLS.filter((skill) => !anticipated.character.skill_proficiencies.includes(skill.index));

  function renderSkill(skill) {
    const abilityName = ABILITIES.find((ability) => ability.key === skill.ability)?.name;
    return (
      <div key={skill.index} className="flex min-w-0 items-center justify-between gap-2 py-1 text-xs">
        <StatTooltip {...skillStat(skill.name, abilityName)} className="min-w-0 text-bone/70">{skill.name}</StatTooltip>
        <span className="shrink-0 font-mono text-bone">{formatModifier(anticipated.skills[skill.index])}<Change from={current.skills[skill.index]} to={anticipated.skills[skill.index]} /></span>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 text-bone" data-testid="wizard-preview">
      <div className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-gold/20 bg-gradient-to-br from-gold/10 to-night-950 p-3">
        <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-t-[45%] rounded-b-md border border-gold/35 bg-night-950 shadow-lg">
          {char.avatar_path ? <img src={char.avatar_path} alt={`Retrato de ${hasChosenName(char) ? char.name : 'tu personaje'}`} className="h-full w-full object-cover" /> : (
            <svg viewBox="0 0 64 80" className="h-full w-full text-gold/40" aria-label="Silueta de tu personaje" role="img">
              <path d="M32 9c-12 0-19 12-18 25l-5 16 8 7-6 23h42l-6-23 8-7-5-16C51 21 44 9 32 9Z" fill="currentColor" />
              <path d="M23 28c3-8 15-8 18 0l-2 17-7 6-7-6Z" fill="#17161c" />
              <path d="M12 79 21 54l11 10 11-10 9 25" stroke="#c6a76b" strokeWidth="1" fill="none" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[0.2em] text-gold/65">Tu leyenda comienza</p>
          <p className="mt-1 break-words font-display text-lg leading-tight text-gold">{hasChosenName(char) ? char.name : 'Un héroe por descubrir'}</p>
          <p className="mt-1 break-words text-[11px] text-bone/60">{raceName || 'Sin especie'} · {classDisplayName || 'Sin clase'}</p>
          <p className="mt-1 text-[10px] text-bone/40">Nivel {char.level}</p>
        </div>
      </div>

      {preview && (
        <div role="status" className="rounded-lg border border-emerald-300/25 bg-emerald-300/5 p-2.5 text-xs">
          <p className="font-medium text-emerald-200">Si eliges {preview.label}</p>
          <p className="mt-1 leading-relaxed text-bone/75">{changes.length ? changes.slice(0, 7).join(' · ') : 'Sin cambios en estas estadísticas.'}</p>
          {changes.length > 7 && <p className="mt-1 text-[10px] text-bone/45">El resto de cambios aparece en la ficha de abajo.</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[['hp', 'PG', 'hp'], ['ac', 'CA', 'ca'], ['speed', 'Pies', 'velocidad']].map(([key, label, stat]) => (
          <div key={key} className="rounded-lg border border-gold/15 bg-night-950/60 px-1 py-2 text-center">
            <StatTooltip stat={stat} className="text-[10px] uppercase tracking-widest text-bone/55">{label}</StatTooltip>
            <p className="font-display text-2xl leading-tight text-gold" data-preview-stat={key}>{anticipated[key]}</p>
            <Change from={current[key]} to={anticipated[key]} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {ABILITIES.map(({ key, short }) => (
          <div key={key} className={`rounded-md border p-1.5 text-center ${key === primary ? 'border-gold/35 bg-gold/5' : 'border-bone/10 bg-night-950/30'}`}>
            <StatTooltip stat={key} as="div" className="text-[9px] uppercase tracking-wider text-bone/50">{short}</StatTooltip>
            <span className="font-mono text-sm">{anticipated.abilities[key]}</span>
            <span className="ml-1 font-mono text-[10px] text-bone/50">{formatModifier(abilityModifier(anticipated.abilities[key]))}</span>
            <Change from={current.abilities[key]} to={anticipated.abilities[key]} />
          </div>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-widest text-gold/75">Salvaciones</p>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          {ABILITIES.map(({ key, name, short }) => (
            <div key={key} className="flex items-center justify-between gap-1 text-xs">
              <StatTooltip {...saveStat(name)} className={anticipated.character.save_proficiencies.includes(key) ? 'text-gold' : 'text-bone/50'}>{short}</StatTooltip>
              <span className="font-mono">{formatModifier(anticipated.saves[key])}<Change from={current.saves[key]} to={anticipated.saves[key]} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-bone/10 pt-3">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-gold/75">Habilidades con competencia</p>
        {chosenSkills.length ? chosenSkills.map(renderSkill) : <p className="py-1 text-xs text-bone/40">Elegirás tus especialidades en Competencias.</p>}
        <details className="mt-1">
          <summary className="cursor-pointer py-1 text-[11px] text-bone/50 hover:text-gold">Otras habilidades ({otherSkills.length})</summary>
          <div className="mt-1">{otherSkills.map(renderSkill)}</div>
        </details>
      </div>

      <div className="border-t border-bone/10 pt-3">
        <StatTooltip term="Ataques con armas" desc="Suma este bono a 1d20 para atacar. El daño usa los dados del arma y el modificador de su característica, según las reglas de tu ficha." className="text-[10px] uppercase tracking-widest text-gold/75">Ataques con armas</StatTooltip>
        {!anticipated.attacks.length && <p className="mt-2 text-xs text-bone/40">Tu arsenal aparecerá al elegir el equipo.</p>}
        <div className="mt-2 space-y-2">
          {anticipated.attacks.map((attack) => {
            const previous = current.attacks.find((entry) => entry.key === attack.key);
            return (
              <div key={attack.key} className="rounded-md border border-bone/10 bg-night-950/40 p-2">
                <p className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words text-bone/90">{attack.name}</span><span className="shrink-0 font-mono text-gold">{formatModifier(attack.bonus)}{previous && <Change from={previous.bonus} to={attack.bonus} />}</span></p>
                <p className="mt-1 text-[11px] text-bone/55">{attack.damage} {DAMAGE_TYPE_NAMES[attack.damageType] ?? attack.damageType}</p>
                <p className="mt-0.5 text-[9px] uppercase tracking-wide text-bone/35">{attack.equipped ? 'Empuñada' : 'En la mochila'}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
