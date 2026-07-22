import { ABILITIES, SKILLS } from '../../lib/dnd.js';
import { parseProficiencyChoices, classAutoProficiencies } from '../../lib/wizard.js';
import HelpBlock from './HelpBlock.jsx';

export default function StepCompetencias({ char, patch, classDetail, errors }) {
  const { skillChoice, otherChoices } = classDetail ? parseProficiencyChoices(classDetail) : {};
  const autoProf = classDetail ? classAutoProficiencies(classDetail) : [];
  const wd = char.wizard_data;
  const raceSkills = wd.appliedRaceSkillProficiencies ?? [];
  const chosenSkills = char.skill_proficiencies.filter((key) => !raceSkills.includes(key));

  function toggleSkill(key) {
    const current = chosenSkills;
    let next;
    if (current.includes(key)) next = current.filter((k) => k !== key);
    else if (current.length < (skillChoice?.choose ?? 0)) next = [...current, key];
    else return;
    patch({ skill_proficiencies: [...new Set([...next, ...raceSkills])] });
  }

  function toggleOther(group, key) {
    const currentChoices = wd.otherProficiencyChoices ?? {};
    const current = currentChoices[group.groupKey] ?? [];
    let nextKeys;
    if (current.includes(key)) nextKeys = current.filter((k) => k !== key);
    else if (current.length < group.choose) nextKeys = [...current, key];
    else return;
    const nextChoices = { ...currentChoices, [group.groupKey]: nextKeys };
    const allNames = (otherChoices ?? []).flatMap((g) =>
      (nextChoices[g.groupKey] ?? []).map((k) => g.options.find((o) => o.key === k)?.name).filter(Boolean)
    );
    patch({ wizard_data: { ...wd, otherProficiencyChoices: nextChoices }, other_proficiencies: allNames });
  }

  if (!classDetail) {
    return <p className="text-sm text-bone/50">Elige antes una clase en el paso anterior.</p>;
  }

  const skillsLeft = (skillChoice?.choose ?? 0) - chosenSkills.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        Las competencias determinan en qué eres bueno de forma fiable: sumas tu bonificador de
        competencia en las tiradas correspondientes.
      </p>

      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wider text-bone/50">Salvaciones (automáticas)</p>
        <div className="flex flex-wrap gap-1.5">
          {char.save_proficiencies.map((k) => (
            <span key={k} className="rounded-sm border border-moss bg-moss/10 px-2 py-1 text-xs text-bone/80">
              {ABILITIES.find((a) => a.key === k)?.name ?? k}
            </span>
          ))}
        </div>
      </div>

      {autoProf.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wider text-bone/50">Armas y armaduras (automáticas)</p>
          <div className="flex flex-wrap gap-1.5">
            {autoProf.map((p) => (
              <span key={p.index} className="rounded-sm border border-bone/15 px-2 py-1 text-xs text-bone/60">{p.name}</span>
            ))}
          </div>
        </div>
      )}

      {raceSkills.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wider text-bone/50">Habilidades de la raza (automáticas)</p>
          <div className="flex flex-wrap gap-1.5">
            {raceSkills.map((key) => (
              <span key={key} className="rounded-sm border border-moss bg-moss/10 px-2 py-1 text-xs text-bone/80">
                {SKILLS.find((skill) => skill.index === key)?.name ?? key}
              </span>
            ))}
          </div>
        </div>
      )}

      {skillChoice && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-wider text-bone/50">Habilidades a elegir</p>
            <p className={`text-xs ${skillsLeft > 0 ? 'text-gold' : 'text-moss'}`}>
              {skillsLeft > 0
                ? `Tu clase te permite elegir ${skillChoice.choose} habilidades. Te quedan ${skillsLeft} selecciones.`
                : 'Selección completa.'}
            </p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {skillChoice.options.map((o) => {
              const automatic = raceSkills.includes(o.key);
              const checked = chosenSkills.includes(o.key);
              const disabled = automatic || (!checked && skillsLeft <= 0);
              return (
                <label
                  key={o.key}
                  className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 text-sm ${
                    checked ? 'border-gold/50 bg-gold/10' : 'border-bone/10'
                  } ${disabled ? 'opacity-40' : 'cursor-pointer hover:bg-bone/5'}`}
                >
                  <input type="checkbox" checked={checked || automatic} disabled={disabled} onChange={() => toggleSkill(o.key)} className="accent-gold" />
                  {o.name}{automatic ? ' (ya concedida por la raza)' : ''}
                </label>
              );
            })}
          </div>
        </div>
      )}
      {errors.skills && <p className="text-xs text-blood">{errors.skills}</p>}

      {(otherChoices ?? []).map((group) => {
        const chosen = wd.otherProficiencyChoices?.[group.groupKey] ?? [];
        const left = group.choose - chosen.length;
        return (
          <div key={group.groupKey}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-wider text-bone/50">Otras competencias</p>
              <p className={`text-xs ${left > 0 ? 'text-gold' : 'text-moss'}`}>
                {left > 0 ? `Te quedan ${left} selecciones.` : 'Selección completa.'}
              </p>
            </div>
            <p className="mb-1 text-xs text-bone/50">{group.desc}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {group.options.map((o) => {
                const checked = chosen.includes(o.key);
                const disabled = !checked && left <= 0;
                return (
                  <label
                    key={o.key}
                    className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 text-sm ${
                      checked ? 'border-gold/50 bg-gold/10' : 'border-bone/10'
                    } ${disabled ? 'opacity-40' : 'cursor-pointer hover:bg-bone/5'}`}
                  >
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleOther(group, o.key)} className="accent-gold" />
                    {o.name}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {errors.other && <p className="text-xs text-blood">{errors.other}</p>}

      <HelpBlock title="¿Qué es el bonificador de competencia?">
        Un número que crece con tu nivel (empieza en +2) y se suma en salvaciones, habilidades y
        ataques en los que seas competente. En las que no lo seas, solo cuenta tu modificador de
        característica.
      </HelpBlock>
    </div>
  );
}

export function validateCompetencias(char, classDetail) {
  const errors = {};
  if (!classDetail) return errors;
  const { skillChoice, otherChoices } = parseProficiencyChoices(classDetail);
  const raceSkills = char.wizard_data.appliedRaceSkillProficiencies ?? [];
  const chosenCount = char.skill_proficiencies.filter((key) => !raceSkills.includes(key)).length;
  if (skillChoice && chosenCount < skillChoice.choose) {
    errors.skills = `Te faltan ${skillChoice.choose - chosenCount} habilidades por elegir.`;
  }
  for (const group of otherChoices ?? []) {
    const chosen = char.wizard_data.otherProficiencyChoices?.[group.groupKey] ?? [];
    if (chosen.length < group.choose) {
      errors.other = 'Completa las competencias pendientes antes de continuar.';
      break;
    }
  }
  return errors;
}
