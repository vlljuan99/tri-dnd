import { ABILITIES, DAMAGE_TYPE_NAMES, SKILLS } from '../../lib/dnd.js';
import HelpBlock from './HelpBlock.jsx';

function RaceCard({ entry, detail, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.index)}
      aria-pressed={selected}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-gold bg-gold/10' : 'border-bone/15 bg-night-950/50 hover:border-bone/30'
      }`}
    >
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
      {detail && (
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-bone/70">
          <span className="rounded-sm border border-bone/15 px-1.5 py-0.5">Velocidad {detail.speed} pies</span>
          <span className="rounded-sm border border-bone/15 px-1.5 py-0.5">{detail.size}</span>
          {detail.traits?.some((t) => t.index === 'darkvision') && (
            <span className="rounded-sm border border-bone/15 px-1.5 py-0.5">Visión en la oscuridad</span>
          )}
        </div>
      )}
    </button>
  );
}

export default function StepRaza({ char, patch, races, raceDetails, errors }) {
  const detail = char.race_index ? raceDetails[char.race_index] : null;
  const wizardData = char.wizard_data;

  function selectRace(idx) {
    const raceDetail = raceDetails[idx];
    patch({
      race_index: idx,
      speed: raceDetail?.speed ?? 30,
      wizard_data: { ...wizardData, raceAbilityChoice: [], raceLanguageChoice: null },
    });
  }

  function toggleAbilityChoice(key) {
    const max = detail.ability_bonus_options?.choose ?? 0;
    const current = wizardData.raceAbilityChoice ?? [];
    let next;
    if (current.includes(key)) next = current.filter((k) => k !== key);
    else if (current.length < max) next = [...current, key];
    else return;
    patch({ wizard_data: { ...wizardData, raceAbilityChoice: next } });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        La raza o especie aporta velocidad, idiomas y rasgos propios. Al elegirla se aplicarán
        automáticamente a tu ficha.
      </p>

      {races.length === 0 ? (
        <p className="text-sm text-bone/50">Cargando razas del compendio…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {races.map((r) => (
            <RaceCard
              key={r.index}
              entry={r}
              detail={raceDetails[r.index]}
              selected={char.race_index === r.index}
              onSelect={selectRace}
            />
          ))}
        </div>
      )}
      {errors.race_index && <p className="text-xs text-blood">{errors.race_index}</p>}

      {detail && (
        <div className="rounded-md border border-gold/20 bg-night-900 p-3 space-y-3">
          <p className="font-display text-sm tracking-wide text-gold">
            Al elegir {detail.name} se aplica automáticamente
          </p>
          <ul className="space-y-1 text-sm text-bone/70">
            <li>Velocidad: {detail.speed} pies</li>
            {detail.ability_bonuses?.length > 0 && (
              <li>
                Bonificadores fijos:{' '}
                {detail.ability_bonuses
                  .map((b) => `${ABILITIES.find((a) => a.key === b.ability_score.index)?.short} +${b.bonus}`)
                  .join(', ')}
              </li>
            )}
            {detail.languages?.length > 0 && (
              <li>Idiomas: {detail.languages.map((l) => l.name).join(', ')}</li>
            )}
            {detail.traits?.length > 0 && (
              <li>Rasgos: {detail.traits.map((t) => t.name).join(', ')}</li>
            )}
            {detail.skill_proficiencies?.length > 0 && (
              <li>
                Habilidades automáticas:{' '}
                {detail.skill_proficiencies.map((key) => SKILLS.find((skill) => skill.index === key)?.name ?? key).join(', ')}
              </li>
            )}
            {detail.damage_resistances?.length > 0 && (
              <li>
                Resistencias:{' '}
                {detail.damage_resistances.map((key) => DAMAGE_TYPE_NAMES[key] ?? key).join(', ')}
              </li>
            )}
            {detail.senses?.length > 0 && <li>Sentidos: {detail.senses.join(', ')}</li>}
          </ul>

          {detail.ability_bonus_options && (
            <div>
              <p className="mb-1 text-xs text-bone/60">
                Elige {detail.ability_bonus_options.choose} característica(s) para el bonificador
                adicional ({(wizardData.raceAbilityChoice ?? []).length}/{detail.ability_bonus_options.choose})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {detail.ability_bonus_options.from.options.map((o) => {
                  const key = o.ability_score.index;
                  const checked = (wizardData.raceAbilityChoice ?? []).includes(key);
                  return (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-xs ${
                        checked ? 'border-gold bg-gold/10 text-gold' : 'border-bone/20 text-bone/70'
                      }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleAbilityChoice(key)} className="accent-gold" />
                      {ABILITIES.find((a) => a.key === key)?.name} +{o.bonus}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {detail.language_options && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-bone/60">Idioma adicional a elegir</span>
              <select
                value={wizardData.raceLanguageChoice ?? ''}
                onChange={(e) => patch({ wizard_data: { ...wizardData, raceLanguageChoice: e.target.value || null } })}
                className="rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none"
              >
                <option value="">— Elige un idioma —</option>
                {detail.language_options.from.options.map((o) => (
                  <option key={o.item.index} value={o.item.index}>{o.item.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <HelpBlock title="¿Por qué no puedo editar la velocidad aquí?">
        La velocidad, los idiomas y los rasgos raciales son valores derivados de la raza elegida.
        Se aplican solos para evitar datos duplicados o inconsistentes; si necesitas un ajuste
        especial, podrás hacerlo después desde la ficha.
      </HelpBlock>
    </div>
  );
}

export function validateRaza(char) {
  const errors = {};
  if (!char.race_index) errors.race_index = 'Elige una raza o especie para continuar.';
  return errors;
}
