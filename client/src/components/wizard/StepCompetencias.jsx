import { useEffect, useState } from 'react';
import { ABILITIES, SKILLS } from '../../lib/dnd.js';
import { api } from '../../api.js';
import { srdCampaignPath } from '../../lib/srdCampaign.js';
import { parseProficiencyChoices, classAutoProficiencies } from '../../lib/wizard.js';
import HelpBlock from './HelpBlock.jsx';
import StatTooltip from '../StatTooltip.jsx';

export default function StepCompetencias({ char, patch, classDetail, errors, onPreview }) {
  const { skillChoice, otherChoices } = classDetail ? parseProficiencyChoices(classDetail) : {};
  const autoProf = classDetail ? classAutoProficiencies(classDetail) : [];
  const wd = char.wizard_data;
  const raceSkills = wd.appliedRaceSkillProficiencies ?? [];
  const chosenSkills = char.skill_proficiencies.filter((key) => !raceSkills.includes(key));

  // El `data` de la clase trae los nombres de sus competencias en inglés; el
  // compendio ya los tiene traducidos, así que se piden y se sustituyen. Si
  // una no está traducida todavía, se queda el nombre del SRD.
  const [profNames, setProfNames] = useState({});
  useEffect(() => {
    let cancelled = false;
    api(srdCampaignPath('proficiencies', char.campaign_id))
      .then(({ results }) => {
        if (!cancelled) setProfNames(Object.fromEntries(results.map((entry) => [entry.index, entry.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [char.campaign_id]);
  const profName = (entry) => profNames[entry.index] ?? entry.name;

  // Parche que produciría marcar o desmarcar una habilidad; null si el cupo
  // de la clase ya está completo. Sirve tanto para aplicar como para anticipar.
  function skillFields(key) {
    const current = chosenSkills;
    let next;
    if (current.includes(key)) next = current.filter((k) => k !== key);
    else if (current.length < (skillChoice?.choose ?? 0)) next = [...current, key];
    else return null;
    return { skill_proficiencies: [...new Set([...next, ...raceSkills])] };
  }

  function toggleSkill(key) {
    const fields = skillFields(key);
    if (!fields) return;
    onPreview?.(null);
    patch(fields);
  }

  function previewSkill(option) {
    const fields = skillFields(option.key);
    if (fields) onPreview?.({ label: option.name, fields });
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
      (nextChoices[g.groupKey] ?? [])
        .map((k) => profNames[k] ?? g.options.find((o) => o.key === k)?.name)
        .filter(Boolean)
    );
    patch({ wizard_data: { ...wd, otherProficiencyChoices: nextChoices }, other_proficiencies: allNames });
  }

  if (!classDetail) {
    return <p className="text-sm text-bone/50">Elige antes una clase en el paso anterior.</p>;
  }

  const skillsLeft = (skillChoice?.choose ?? 0) - chosenSkills.length;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-bone/70">
        ¿En qué destaca tu héroe? En las <StatTooltip stat="competencia">competencias</StatTooltip> sumas tu bonificador
        de competencia a la tirada. Tu clase y tu especie ya te conceden algunas; pasa por encima de una habilidad para ver
        cuánto subiría.
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
              <span key={p.index} className="rounded-sm border border-bone/15 px-2 py-1 text-xs text-bone/60">{profName(p)}</span>
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
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs uppercase tracking-wider text-bone/50">Habilidades de tu clase</p>
            <p className={`text-xs ${errors.skills ? 'text-red-300' : skillsLeft > 0 ? 'text-gold' : 'text-emerald-300'}`} aria-live="polite">
              {skillsLeft > 0
                ? `Elige ${skillChoice.choose}: te quedan ${skillsLeft}.`
                : `Selección completa (${skillChoice.choose}).`}
            </p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-label="Habilidades de tu clase" aria-describedby={errors.skills ? 'wizard-skills-error' : undefined}>
            {skillChoice.options.map((o) => {
              const automatic = raceSkills.includes(o.key);
              const checked = chosenSkills.includes(o.key);
              const disabled = automatic || (!checked && skillsLeft <= 0);
              const skill = SKILLS.find((entry) => entry.index === o.key);
              const abilityShort = ABILITIES.find((ability) => ability.key === skill?.ability)?.short;
              return (
                <label
                  key={o.key}
                  onMouseEnter={() => !disabled && previewSkill(o)} onMouseLeave={() => onPreview?.(null)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors motion-reduce:transition-none ${
                    checked ? 'border-gold/60 bg-gold/10 text-gold' : 'border-bone/10 text-bone/85'
                  } ${disabled ? 'opacity-40' : 'cursor-pointer hover:border-gold/50'}`}
                >
                  <input type="checkbox" checked={checked || automatic} disabled={disabled} onChange={() => toggleSkill(o.key)}
                    onFocus={() => !disabled && previewSkill(o)} onBlur={() => onPreview?.(null)} className="accent-gold" />
                  <span className="min-w-0 flex-1">{o.name}{automatic ? <span className="text-bone/50"> · ya la concede tu especie</span> : ''}</span>
                  {abilityShort && <span className="shrink-0 font-mono text-[10px] text-bone/45">{abilityShort}</span>}
                </label>
              );
            })}
          </div>
          {errors.skills && <p id="wizard-skills-error" role="alert" className="mt-2 text-xs text-red-300">{errors.skills}</p>}
        </div>
      )}

      {(otherChoices ?? []).map((group) => {
        const chosen = wd.otherProficiencyChoices?.[group.groupKey] ?? [];
        const left = group.choose - chosen.length;
        return (
          <div key={group.groupKey}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-xs uppercase tracking-wider text-bone/50">Otras competencias</p>
              <p className={`text-xs ${errors.other && left > 0 ? 'text-red-300' : left > 0 ? 'text-gold' : 'text-emerald-300'}`} aria-live="polite">
                {left > 0 ? `Elige ${group.choose}: te quedan ${left}.` : `Selección completa (${group.choose}).`}
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
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors motion-reduce:transition-none ${
                      checked ? 'border-gold/60 bg-gold/10 text-gold' : 'border-bone/10 text-bone/85'
                    } ${disabled ? 'opacity-40' : 'cursor-pointer hover:border-gold/50'}`}
                  >
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleOther(group, o.key)} className="accent-gold" />
                    {profNames[o.key] ?? o.name}
                  </label>
                );
              })}
            </div>
            {errors.other && left > 0 && <p role="alert" className="mt-2 text-xs text-red-300">{errors.other}</p>}
          </div>
        );
      })}

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
    const left = skillChoice.choose - chosenCount;
    errors.skills = left === 1
      ? 'Te falta 1 habilidad por elegir: tu clase te concede competencia en ella y sumarás +2 a sus tiradas.'
      : `Te faltan ${left} habilidades por elegir: tu clase te concede competencia en ellas y sumarás +2 a sus tiradas.`;
  }
  for (const group of otherChoices ?? []) {
    const chosen = char.wizard_data.otherProficiencyChoices?.[group.groupKey] ?? [];
    if (chosen.length < group.choose) {
      errors.other = `Elige ${group.choose - chosen.length} más: tu clase te concede también estas competencias.`;
      break;
    }
  }
  return errors;
}
