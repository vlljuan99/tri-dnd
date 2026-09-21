import { ABILITIES, CLASS_SUMMARY, PRIMARY_ABILITY } from '../../lib/dnd.js';
import { parseProficiencyChoices, classAutoProficiencies } from '../../lib/wizard.js';
import StatTooltip from '../StatTooltip.jsx';
import { CreatorCard, CreatorDetail, CreatorFeatures } from './CreatorSelection.jsx';
import HelpBlock from './HelpBlock.jsx';

function primaryAbility(index, detail) {
  // La principal editorial manda (el paladín es FUE aunque conjure con CAR);
  // la de conjuros solo cubre las clases del DM, que no tienen entrada.
  const key = PRIMARY_ABILITY[index] ?? detail?.spellcasting?.spellcasting_ability?.index;
  return ABILITIES.find((ability) => ability.key === key);
}

function classSubtitle(index, detail) {
  if (CLASS_SUMMARY[index]) return CLASS_SUMMARY[index].role;
  if (!detail) return 'Consultando el compendio…';
  return detail.spellcasting ? 'Clase del DM con lanzamiento de conjuros.' : 'Clase del DM.';
}

function classTags(index, detail) {
  const tags = [];
  const summary = CLASS_SUMMARY[index];
  if (summary?.difficulty) tags.push(`Dificultad ${summary.difficulty.toLowerCase()}`);
  if (detail?.hit_die) tags.push(`d${detail.hit_die}`);
  const primary = primaryAbility(index, detail);
  if (primary) tags.push(`Principal ${primary.short}`);
  if (detail?.spellcasting) tags.push('Conjuros');
  return tags;
}

export default function StepClase({ char, patch, classes, classDetails, errors, onPreview }) {
  const detail = char.class_index ? classDetails[char.class_index] : null;
  const entry = classes.find((cls) => cls.index === char.class_index);
  const { skillChoice, otherChoices } = detail ? parseProficiencyChoices(detail) : {};
  const autoProf = detail ? classAutoProficiencies(detail) : [];
  const primary = detail ? primaryAbility(char.class_index, detail) : null;

  // Cambiar de clase vacía las elecciones que dependían de la anterior
  // (habilidades, herramientas, equipo); las de especie se conservan.
  function classFields(index) {
    const raceSkills = char.wizard_data.appliedRaceSkillProficiencies ?? [];
    return {
      class_index: index,
      skill_proficiencies: raceSkills,
      other_proficiencies: [],
      inventory: [],
      wizard_data: { ...char.wizard_data, otherProficiencyChoices: {}, equipmentGroupChoice: {}, equipmentCategoryPicks: {}, appliedEquipmentSignature: null },
    };
  }

  function selectClass(index) {
    onPreview?.(null);
    if (index === char.class_index) return;
    patch(classFields(index));
  }

  function previewClass(index) {
    if (!index || index === char.class_index) return onPreview?.(null);
    onPreview?.({ label: classes.find((cls) => cls.index === index)?.name ?? index, fields: classFields(index) });
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-bone/70">¿Cómo afronta tu héroe el peligro? La clase decide tus puntos de golpe, tus salvaciones, si lanzas conjuros y entre qué habilidades elegirás. Las de dificultad baja son las más directas para empezar.</p>

      {classes.length === 0 ? (
        <p className="text-sm text-bone/50">Cargando clases del compendio…</p>
      ) : (
        <div role="group" aria-label="Clases disponibles" aria-describedby={errors.class_index ? 'wizard-class-error' : undefined}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((cls) => (
            <CreatorCard key={cls.index} category="classes" entry={cls} selected={char.class_index === cls.index}
              subtitle={classSubtitle(cls.index, classDetails[cls.index])} tags={classTags(cls.index, classDetails[cls.index])}
              onSelect={selectClass} onPreview={previewClass} />
          ))}
        </div>
      )}
      {errors.class_index && <p id="wizard-class-error" role="alert" className="text-sm text-red-300">{errors.class_index}</p>}

      {detail && entry && (
        <CreatorDetail category="classes" entry={entry}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-gold/15 bg-night-950/50 p-2 text-center">
              <StatTooltip stat="hp" as="p" className="text-[10px] uppercase tracking-widest text-bone/55">Dado de golpe</StatTooltip>
              <p className="font-display text-xl text-gold">d{detail.hit_die}</p>
            </div>
            <div className="rounded-md border border-gold/15 bg-night-950/50 p-2 text-center">
              <p className="text-[10px] uppercase tracking-widest text-bone/55">Principal</p>
              <p className="font-display text-xl text-gold">{primary?.short ?? '—'}</p>
            </div>
            <div className="rounded-md border border-gold/15 bg-night-950/50 p-2 text-center">
              <p className="text-[10px] uppercase tracking-widest text-bone/55">Conjuros</p>
              <p className="font-display text-xl text-gold">{detail.spellcasting ? 'Sí' : 'No'}</p>
            </div>
            <div className="rounded-md border border-gold/15 bg-night-950/50 p-2 text-center">
              <p className="text-[10px] uppercase tracking-widest text-bone/55">Habilidades</p>
              <p className="font-display text-xl text-gold">{skillChoice ? `${skillChoice.choose} de ${skillChoice.options.length}` : '—'}</p>
            </div>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3 border-b border-bone/10 pb-1">
              <dt className="text-bone/60">Salvaciones competentes</dt>
              <dd className="text-right text-bone">{(detail.saving_throws ?? []).map((save) => ABILITIES.find((ability) => ability.key === save.index)?.name ?? save.name).join(', ') || '—'}</dd>
            </div>
            {autoProf.length > 0 && (
              <div className="flex justify-between gap-3 border-b border-bone/10 pb-1">
                <dt className="shrink-0 text-bone/60">Competencias automáticas</dt>
                <dd className="text-right text-bone">{autoProf.map((proficiency) => proficiency.name).join(', ')}</dd>
              </div>
            )}
            {otherChoices?.length > 0 && (
              <div className="flex justify-between gap-3 border-b border-bone/10 pb-1">
                <dt className="text-bone/60">Otras elecciones</dt>
                <dd className="text-right text-bone">{otherChoices.map((group) => `${group.choose} de ${group.options.length}`).join(' · ')} (paso de competencias)</dd>
              </div>
            )}
          </dl>

          <CreatorFeatures category="classes" index={char.class_index} detail={detail} campaignId={char.campaign_id} />
        </CreatorDetail>
      )}

      <HelpBlock title="¿Qué es el dado de golpe?">
        Determina tus puntos de golpe: cuanto más alto, más resistente es tu personaje frente al
        daño. Se usa junto con tu modificador de Constitución para calcular tu vida máxima.
      </HelpBlock>
    </div>
  );
}

export function validateClase(char) {
  const errors = {};
  if (!char.class_index) errors.class_index = 'Elige una clase: fija tus puntos de golpe, tus salvaciones y las habilidades entre las que podrás elegir.';
  return errors;
}
