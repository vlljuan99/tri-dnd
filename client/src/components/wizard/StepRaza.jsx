import { ABILITIES, DAMAGE_TYPE_NAMES, SKILLS } from '../../lib/dnd.js';
import StatTooltip from '../StatTooltip.jsx';
import { CreatorCard, CreatorDetail, CreatorFeatures } from './CreatorSelection.jsx';
import HelpBlock from './HelpBlock.jsx';

const SIZE_NAMES = { Tiny: 'Diminuto', Small: 'Pequeño', Medium: 'Mediano', Large: 'Grande', Huge: 'Enorme', Gargantuan: 'Gigantesco' };

function abilityShort(key) {
  return ABILITIES.find((ability) => ability.key === key)?.short ?? key;
}

/** Resumen de una especie leído del compendio: nada de prosa inventada. */
function raceSubtitle(detail) {
  if (!detail) return 'Consultando el compendio…';
  const fixed = (detail.ability_bonuses ?? []).map((bonus) => `+${bonus.bonus} ${abilityShort(bonus.ability_score?.index)}`);
  const options = detail.ability_bonus_options;
  if (options?.choose) fixed.push(`+${options.from?.options?.[0]?.bonus ?? 1} a ${options.choose} a elegir`);
  return fixed.length ? fixed.join(' · ') : 'Sin bonos de característica';
}

function raceTags(detail) {
  if (!detail) return [];
  const tags = [`${detail.speed ?? 30} pies`];
  if (detail.size) tags.push(SIZE_NAMES[detail.size] ?? detail.size);
  if (detail.traits?.some((trait) => trait.index === 'darkvision') || detail.senses?.some((sense) => /oscuridad|darkvision/i.test(sense))) tags.push('Visión en la oscuridad');
  return tags;
}

export default function StepRaza({ char, patch, races, raceDetails, errors, onPreview }) {
  const detail = char.race_index ? raceDetails[char.race_index] : null;
  const entry = races.find((race) => race.index === char.race_index);
  const wizardData = char.wizard_data;
  const choice = wizardData.raceAbilityChoice ?? [];

  function raceFields(index) {
    return {
      race_index: index,
      speed: raceDetails[index]?.speed ?? 30,
      wizard_data: { ...wizardData, raceAbilityChoice: [], raceLanguageChoice: null },
    };
  }

  function selectRace(index) {
    onPreview?.(null);
    if (index === char.race_index) return;
    patch(raceFields(index));
  }

  function previewRace(index) {
    if (!index || index === char.race_index) return onPreview?.(null);
    onPreview?.({ label: races.find((race) => race.index === index)?.name ?? index, fields: raceFields(index) });
  }

  function nextChoice(key) {
    const max = detail.ability_bonus_options?.choose ?? 0;
    if (choice.includes(key)) return choice.filter((k) => k !== key);
    if (choice.length < max) return [...choice, key];
    return null;
  }

  function choiceFields(key) {
    const next = nextChoice(key);
    return next ? { wizard_data: { ...wizardData, raceAbilityChoice: next } } : null;
  }

  const choiceError = errors.raceAbilityChoice;
  const languageError = errors.raceLanguageChoice;

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-bone/70">¿De dónde viene tu héroe? La especie aporta velocidad, sentidos, idiomas y rasgos propios. Pasa por encima de cada tarjeta para ver cómo cambiaría tu ficha.</p>

      {races.length === 0 ? (
        <p className="text-sm text-bone/50">Cargando especies del compendio…</p>
      ) : (
        <div role="group" aria-label="Especies disponibles" aria-describedby={errors.race_index ? 'wizard-race-error' : undefined}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {races.map((race) => (
            <CreatorCard key={race.index} category="races" entry={race} selected={char.race_index === race.index}
              subtitle={raceSubtitle(raceDetails[race.index])} tags={raceTags(raceDetails[race.index])}
              onSelect={selectRace} onPreview={previewRace} />
          ))}
        </div>
      )}
      {errors.race_index && <p id="wizard-race-error" role="alert" className="text-sm text-red-300">{errors.race_index}</p>}

      {detail && entry && (
        <CreatorDetail category="races" entry={entry}>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2 border-b border-bone/10 pb-1">
              <dt><StatTooltip stat="velocidad" className="text-bone/60">Velocidad</StatTooltip></dt>
              <dd className="font-mono text-bone">{detail.speed ?? 30} pies</dd>
            </div>
            {detail.size && <div className="flex justify-between gap-2 border-b border-bone/10 pb-1"><dt className="text-bone/60">Tamaño</dt><dd className="text-bone">{SIZE_NAMES[detail.size] ?? detail.size}</dd></div>}
            {detail.ability_bonuses?.length > 0 && (
              <div className="flex justify-between gap-2 border-b border-bone/10 pb-1">
                <dt className="text-bone/60">Bonos fijos</dt>
                <dd className="font-mono text-bone">{detail.ability_bonuses.map((bonus) => `${abilityShort(bonus.ability_score?.index)} +${bonus.bonus}`).join(', ')}</dd>
              </div>
            )}
            {detail.languages?.length > 0 && <div className="flex justify-between gap-2 border-b border-bone/10 pb-1"><dt className="text-bone/60">Idiomas</dt><dd className="text-right text-bone">{detail.languages.map((language) => language.name).join(', ')}</dd></div>}
            {detail.skill_proficiencies?.length > 0 && (
              <div className="flex justify-between gap-2 border-b border-bone/10 pb-1">
                <dt className="text-bone/60">Habilidades</dt>
                <dd className="text-right text-bone">{detail.skill_proficiencies.map((key) => SKILLS.find((skill) => skill.index === key)?.name ?? key).join(', ')}</dd>
              </div>
            )}
            {detail.damage_resistances?.length > 0 && (
              <div className="flex justify-between gap-2 border-b border-bone/10 pb-1">
                <dt className="text-bone/60">Resistencias</dt>
                <dd className="text-right text-bone">{detail.damage_resistances.map((key) => DAMAGE_TYPE_NAMES[key] ?? key).join(', ')}</dd>
              </div>
            )}
            {detail.senses?.length > 0 && <div className="flex justify-between gap-2 border-b border-bone/10 pb-1"><dt className="text-bone/60">Sentidos</dt><dd className="text-right text-bone">{detail.senses.join(', ')}</dd></div>}
          </dl>

          {detail.ability_bonus_options && (
            <div>
              <p className="mb-2 text-xs text-bone/70">
                Elige {detail.ability_bonus_options.choose} característica{detail.ability_bonus_options.choose > 1 ? 's' : ''} para el bono adicional
                <span className={`ml-2 font-mono ${choice.length >= detail.ability_bonus_options.choose ? 'text-emerald-300' : 'text-gold'}`}>{choice.length}/{detail.ability_bonus_options.choose}</span>
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Bono de característica a elegir">
                {detail.ability_bonus_options.from.options.map((option) => {
                  const key = option.ability_score.index;
                  const checked = choice.includes(key);
                  const fields = choiceFields(key);
                  const label = `${ABILITIES.find((ability) => ability.key === key)?.name} +${option.bonus}`;
                  return (
                    <button key={key} type="button" aria-pressed={checked} disabled={!fields}
                      onClick={() => { onPreview?.(null); patch(fields); }}
                      onMouseEnter={() => fields && onPreview?.({ label, fields })} onMouseLeave={() => onPreview?.(null)}
                      onFocus={() => fields && onPreview?.({ label, fields })} onBlur={() => onPreview?.(null)}
                      className={`rounded-md border px-3 py-2 text-xs transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-35 ${checked ? 'border-gold bg-gold/15 text-gold' : 'border-bone/20 text-bone/75 hover:border-gold/60'}`}>
                      {checked ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
              {choiceError && <p role="alert" className="mt-2 text-xs text-red-300">{choiceError}</p>}
            </div>
          )}

          {detail.language_options && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-bone/70">Idioma adicional</span>
              <select value={wizardData.raceLanguageChoice ?? ''} aria-invalid={Boolean(languageError)}
                onChange={(event) => patch({ wizard_data: { ...wizardData, raceLanguageChoice: event.target.value || null } })}
                className="rounded-md border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone focus:border-gold focus:outline-none">
                <option value="">— Elige un idioma —</option>
                {detail.language_options.from.options.map((option) => <option key={option.item.index} value={option.item.index}>{option.item.name}</option>)}
              </select>
              <span className={`text-xs ${languageError ? 'text-red-300' : 'text-bone/45'}`}>{languageError ?? 'Tu especie sabe un idioma más de tu elección.'}</span>
            </label>
          )}

          <CreatorFeatures category="races" index={char.race_index} detail={detail} campaignId={char.campaign_id} />
        </CreatorDetail>
      )}

      <HelpBlock title="¿Por qué no puedo editar la velocidad aquí?">
        La velocidad, los idiomas y los rasgos de especie son valores derivados de tu elección.
        Se aplican solos para evitar datos duplicados o inconsistentes; si necesitas un ajuste
        especial, podrás hacerlo después desde la ficha.
      </HelpBlock>
    </div>
  );
}

export function validateRaza(char, raceDetail = null) {
  const errors = {};
  if (!char.race_index) {
    errors.race_index = 'Elige una especie: decide tu velocidad, tus sentidos y los bonos que se suman a tus características.';
    return errors;
  }
  const options = raceDetail?.ability_bonus_options;
  const chosen = char.wizard_data?.raceAbilityChoice ?? [];
  if (options?.choose && chosen.length < options.choose) {
    errors.raceAbilityChoice = `Te falta${options.choose - chosen.length > 1 ? 'n' : ''} ${options.choose - chosen.length} bono${options.choose - chosen.length > 1 ? 's' : ''} por elegir: tu especie los concede a la característica que prefieras.`;
  }
  if (raceDetail?.language_options && !char.wizard_data?.raceLanguageChoice) {
    errors.raceLanguageChoice = 'Elige el idioma adicional que concede tu especie.';
  }
  return errors;
}
