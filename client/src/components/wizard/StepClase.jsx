import { ABILITIES, CLASS_SUMMARY, PRIMARY_ABILITY } from '../../lib/dnd.js';
import { parseProficiencyChoices, classAutoProficiencies } from '../../lib/wizard.js';
import HelpBlock from './HelpBlock.jsx';

function ClassCard({ entry, detail, selected, onSelect }) {
  const summary = CLASS_SUMMARY[entry.index];
  const primaryKey = PRIMARY_ABILITY[entry.index];
  const primary = ABILITIES.find((a) => a.key === primaryKey);

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.index)}
      aria-pressed={selected}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-gold bg-gold/10' : 'border-bone/15 bg-night-950/50 hover:border-bone/30'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-base tracking-wide text-gold">
          {entry.name}
          {!entry.translated && (
            <span className="ml-2 rounded-sm border border-bone/20 px-1 text-[10px] font-normal text-bone/40">EN</span>
          )}
          {entry.custom && (
            <span className="ml-2 rounded-sm border border-gold/25 px-1 text-[10px] font-normal text-gold/70">
              {entry.sharedFromDm ? 'Del DM' : 'Propia'}
            </span>
          )}
        </span>
        {summary?.difficulty && (
          <span className="shrink-0 rounded-sm border border-bone/15 px-1.5 py-0.5 text-[10px] text-bone/50">
            Dificultad {summary.difficulty}
          </span>
        )}
      </div>
      {summary && <p className="mt-1 text-xs text-bone/60">{summary.role}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-bone/70">
        {detail && <span className="rounded-sm border border-bone/15 px-1.5 py-0.5">Dado de golpe d{detail.hit_die}</span>}
        {primary && <span className="rounded-sm border border-bone/15 px-1.5 py-0.5">Principal {primary.short}</span>}
        <span className="rounded-sm border border-bone/15 px-1.5 py-0.5">
          Hechizos {detail?.spellcasting ? 'sí' : 'no'}
        </span>
      </div>
    </button>
  );
}

export default function StepClase({ char, patch, classes, classDetails, errors }) {
  const detail = char.class_index ? classDetails[char.class_index] : null;
  const { skillChoice } = detail ? parseProficiencyChoices(detail) : {};
  const autoProf = detail ? classAutoProficiencies(detail) : [];

  function selectClass(index) {
    if (index === char.class_index) return;
    const raceSkills = char.wizard_data.appliedRaceSkillProficiencies ?? [];
    patch({
      class_index: index,
      skill_proficiencies: raceSkills,
      other_proficiencies: [],
      wizard_data: { ...char.wizard_data, otherProficiencyChoices: {} },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        La clase define cómo lucha y qué puede hacer tu personaje: sus dados de golpe, sus
        salvaciones, si lanza hechizos y qué habilidades puede elegir.
      </p>

      {classes.length === 0 ? (
        <p className="text-sm text-bone/50">Cargando clases del compendio…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {classes.map((c) => (
            <ClassCard
              key={c.index}
              entry={c}
              detail={classDetails[c.index]}
              selected={char.class_index === c.index}
              onSelect={selectClass}
            />
          ))}
        </div>
      )}
      {errors.class_index && <p className="text-xs text-blood">{errors.class_index}</p>}

      {detail && (
        <div className="rounded-md border border-gold/20 bg-night-900 p-3">
          <p className="mb-2 font-display text-sm tracking-wide text-gold">
            Esto se aplicará a tu ficha al elegir {detail.name}
          </p>
          <ul className="space-y-1 text-sm text-bone/70">
            <li>
              Salvaciones competentes:{' '}
              {detail.saving_throws.map((s) => ABILITIES.find((a) => a.key === s.index)?.name ?? s.name).join(', ')}
            </li>
            <li>Dado de golpe: d{detail.hit_die}</li>
            {skillChoice && (
              <li>
                Habilidades a elegir: {skillChoice.choose} de {skillChoice.options.length} disponibles (paso de
                competencias)
              </li>
            )}
            <li>Lanzamiento de hechizos: {detail.spellcasting ? 'sí' : 'no'}</li>
            {autoProf.length > 0 && (
              <li>Competencias automáticas: {autoProf.map((p) => p.name).join(', ')}</li>
            )}
          </ul>
        </div>
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
  if (!char.class_index) errors.class_index = 'Elige una clase para continuar.';
  return errors;
}
