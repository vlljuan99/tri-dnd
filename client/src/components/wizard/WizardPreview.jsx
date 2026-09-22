import { ABILITIES, SKILLS, abilityModifier, formatModifier, PRIMARY_ABILITY, DAMAGE_TYPE_NAMES } from '../../lib/dnd.js';
import { deriveWizardPreview, previewCharacter, wizardPortraitProgress, wizardPreviewDeltas } from '../../lib/wizardPreview.js';
import { saveStat, skillStat } from '../../lib/statGlossary.js';
import { hasChosenName } from '../../lib/wizard.js';
import StatTooltip from '../StatTooltip.jsx';
import { creatorArt, creatorArtFallback, CreatorEmblem } from './CreatorSelection.jsx';

function Change({ from, to }) {
  if (from === to) return null;
  return <span className={`ml-1 font-mono text-[10px] ${to > from ? 'text-emerald-300' : 'text-amber-300'}`}>({formatModifier(to - from)})</span>;
}

const BUILD_MILESTONES = [
  { stage: 1, short: 'Origen' },
  { stage: 2, short: 'Clase' },
  { stage: 3, short: 'Atributos' },
  { stage: 4, short: 'Pericia' },
  { stage: 5, short: 'Equipo' },
  { stage: 6, short: 'Identidad' },
];

function FormingPortrait({ char, character, raceName, classDisplayName, buildStage }) {
  const classIndex = character.class_index;
  const avatar = char.avatar_path;
  const progress = wizardPortraitProgress({ stage: buildStage, classIndex, avatarPath: avatar });
  const classArt = classIndex ? creatorArt('classes', classIndex) : null;
  const image = avatar || classArt;
  const alt = avatar
    ? `Retrato de ${hasChosenName(char) ? char.name : 'tu personaje'}`
    : classIndex ? `Arquetipo visual de ${classDisplayName || classIndex}` : '';

  function artFallback(event) {
    const fallbacks = [classArt, classIndex ? creatorArtFallback('classes', classIndex) : null].filter(Boolean);
    let cursor = Number(event.currentTarget.dataset.fallbackCursor ?? 0);
    while (cursor < fallbacks.length) {
      const fallback = fallbacks[cursor];
      cursor += 1;
      event.currentTarget.dataset.fallbackCursor = String(cursor);
      if (!event.currentTarget.src.endsWith(fallback)) {
        event.currentTarget.src = fallback;
        return;
      }
    }
    event.currentTarget.hidden = true;
  }

  return (
    <div className="wizard-forming-portrait overflow-hidden rounded-xl border border-gold/25 bg-night-950 shadow-xl shadow-black/20">
      <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgba(209,177,122,.16),transparent_48%),linear-gradient(160deg,#1e302f,#0d1517_70%)]">
        {image ? (
          <>
            <svg viewBox="0 0 64 80" aria-hidden="true" className="absolute left-1/2 top-1/2 h-3/5 -translate-x-1/2 -translate-y-1/2 text-gold/20">
              <path d="M32 9c-12 0-19 12-18 25l-5 16 8 7-6 23h42l-6-23 8-7-5-16C51 21 44 9 32 9Z" fill="currentColor" />
              <path d="M23 28c3-8 15-8 18 0l-2 17-7 6-7-6Z" fill="#17161c" />
              <path d="M12 79 21 54l11 10 11-10 9 25" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
            <img key={`fondo-${image}`} src={image} alt="" aria-hidden="true" onError={artFallback}
              className="absolute inset-0 h-full w-full scale-[1.02] object-cover object-top opacity-20 grayscale blur-[2px]" />
            <div className="absolute inset-0 overflow-hidden transition-[clip-path] duration-700 ease-out motion-reduce:transition-none"
              style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
              <img key={`retrato-${image}`} src={image} alt={alt} onError={artFallback} className="h-full w-full object-cover object-top" />
            </div>
            {progress < 100 && progress > 0 && (
              <span aria-hidden="true" className="absolute inset-y-0 w-px bg-gold/80 shadow-[0_0_18px_5px_rgba(209,177,122,.3)] transition-[left] duration-700 motion-reduce:transition-none"
                style={{ left: `${progress}%` }} />
            )}
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <span className="mx-auto grid size-20 place-items-center rounded-full border border-dashed border-gold/25 text-4xl text-gold/35">◇</span>
              <p className="mt-4 font-display text-sm text-gold/55">Una figura por forjar</p>
              <p className="mt-1 text-xs leading-relaxed text-bone/35">Su silueta aparecerá cuando elijas una clase.</p>
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0b1214] via-[#0b1214]/85 to-transparent px-4 pb-4 pt-14">
          <div className="flex items-end gap-3">
            {classIndex && <span className="grid size-9 shrink-0 place-items-center rounded-full border border-gold/45 bg-night-950/80 text-gold"><CreatorEmblem category="classes" index={classIndex} className="size-5" /></span>}
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg leading-tight text-gold">{hasChosenName(char) ? char.name : 'Un héroe por descubrir'}</p>
              <p className="mt-1 truncate text-[11px] text-bone/65">{raceName || 'Origen por decidir'} · {classDisplayName || 'Clase por decidir'}</p>
            </div>
            {classIndex && <span className="shrink-0 text-right font-mono text-[10px] text-gold/70">
              <span className="block text-bone/45">Nv. {character.level}</span>{progress}%
            </span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-6 border-t border-gold/15 bg-[#111b1d] px-2 py-2"
        role="progressbar" aria-label="Construcción del retrato" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow={progress} aria-valuetext={`Retrato construido al ${progress}%`}>
        {BUILD_MILESTONES.map((milestone) => {
          const complete = buildStage > milestone.stage;
          const current = buildStage === milestone.stage;
          return <div key={milestone.stage} className="min-w-0 text-center">
            <span aria-hidden="true" className={`mx-auto block size-1.5 rounded-full ${complete ? 'bg-gold shadow-[0_0_7px_rgba(209,177,122,.7)]' : current ? 'bg-gold/45 ring-1 ring-gold/50 ring-offset-2 ring-offset-[#111b1d]' : 'bg-bone/15'}`} />
            <span aria-hidden="true" className={`mt-1 hidden text-[8px] uppercase tracking-wide xl:block ${complete ? 'text-gold/70' : current ? 'text-gold/45' : 'text-bone/25'}`}>{milestone.short}</span>
          </div>;
        })}
      </div>
    </div>
  );
}

/** La ficha se anticipa con los espejos del cliente; el servidor sigue validando al guardar. */
export default function WizardPreview({
  char, classDisplayName, raceName, classDetail, raceDetail, classDetails, raceDetails, preview, buildStage = 0,
}) {
  if (!char) return null;
  const context = { classDetail, raceDetail, classDetails, raceDetails };
  const current = deriveWizardPreview(char, context);
  const anticipated = preview?.fields ? deriveWizardPreview(previewCharacter(char, preview.fields), context) : current;
  const changes = preview?.fields ? wizardPreviewDeltas(current, anticipated) : [];
  const anticipatedClassDetail = classDetails?.[anticipated.character.class_index] ?? classDetail;
  const primary = anticipatedClassDetail?.spellcasting?.spellcasting_ability?.index
    ?? PRIMARY_ABILITY[anticipated.character.class_index];
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
      <FormingPortrait char={char} character={anticipated.character} raceName={raceName}
        classDisplayName={classDisplayName} buildStage={buildStage} />

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
          <div key={key} data-preview-ability={key} data-primary={key === primary ? 'true' : undefined}
            className={`rounded-md border p-1.5 text-center ${key === primary ? 'border-gold/35 bg-gold/5' : 'border-bone/10 bg-night-950/30'}`}>
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
