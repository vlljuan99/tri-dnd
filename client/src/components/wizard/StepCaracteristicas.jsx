import { ABILITIES, abilityModifier, formatModifier, PRIMARY_ABILITY } from '../../lib/dnd.js';
import { ABILITY_METHODS, STANDARD_ARRAY, rollAbilityPool, applyRacialBonuses } from '../../lib/wizard.js';
import HelpBlock from './HelpBlock.jsx';

function availableValuesFor(pool, assignment, currentKey) {
  const usedCounts = {};
  for (const [k, v] of Object.entries(assignment)) {
    if (k === currentKey || v == null) continue;
    usedCounts[v] = (usedCounts[v] ?? 0) + 1;
  }
  const remaining = [...pool];
  for (const [val, cnt] of Object.entries(usedCounts)) {
    let c = cnt;
    for (let i = remaining.length - 1; i >= 0 && c > 0; i--) {
      if (remaining[i] === Number(val)) {
        remaining.splice(i, 1);
        c--;
      }
    }
  }
  return remaining.sort((a, b) => b - a);
}

export default function StepCaracteristicas({ char, patch, raceDetail, errors }) {
  const wd = char.wizard_data;
  const method = wd.abilityMethod;
  const pool = method === 'array' ? STANDARD_ARRAY : method === 'roll' ? wd.rolledPool : null;
  const assignment = wd.poolAssignment ?? {};
  const primaryKey = char.class_index ? PRIMARY_ABILITY[char.class_index] : null;

  function chooseMethod(id) {
    patch({
      wizard_data: {
        ...wd,
        abilityMethod: id,
        poolAssignment: {},
        rolledPool: id === 'roll' ? rollAbilityPool() : null,
        baseAbilities: id === 'manual' ? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } : null,
      },
    });
  }

  function reroll() {
    patch({ wizard_data: { ...wd, rolledPool: rollAbilityPool(), poolAssignment: {} } });
  }

  function assignFromPool(key, value) {
    const nextAssignment = { ...assignment, [key]: value === '' ? null : Number(value) };
    const complete = ABILITIES.every((a) => nextAssignment[a.key] != null);
    const nextBase = complete
      ? Object.fromEntries(ABILITIES.map((a) => [a.key, nextAssignment[a.key]]))
      : null;
    patch({ wizard_data: { ...wd, poolAssignment: nextAssignment, baseAbilities: nextBase } });
  }

  function setManual(key, value) {
    const base = { ...(wd.baseAbilities ?? {}), [key]: Math.max(1, Math.min(30, value)) };
    patch({ wizard_data: { ...wd, baseAbilities: base } });
  }

  const finalAbilities = wd.baseAbilities && raceDetail ? applyRacialBonuses(wd.baseAbilities, raceDetail, wd.raceAbilityChoice ?? []) : wd.baseAbilities;

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        Estas seis características definen lo que tu personaje hace bien. Elige cómo quieres
        obtener los valores.
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {ABILITY_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => chooseMethod(m.id)}
            aria-pressed={method === m.id}
            className={`rounded-md border p-2.5 text-left transition-colors ${
              method === m.id ? 'border-gold bg-gold/10' : 'border-bone/15 hover:border-bone/30'
            }`}
          >
            <p className="font-display text-sm text-gold">{m.name}</p>
            <p className="mt-0.5 text-xs text-bone/60">{m.desc}</p>
          </button>
        ))}
      </div>
      {errors.abilityMethod && <p className="text-xs text-blood">{errors.abilityMethod}</p>}

      {method === 'roll' && (
        <div className="flex items-center justify-between rounded-sm border border-bone/10 bg-night-950/50 p-2 text-sm">
          <span className="font-mono text-bone/70">Tirada: {(pool ?? []).join(', ')}</span>
          <button type="button" onClick={reroll} className="rounded-sm border border-gold/40 px-2 py-1 text-xs text-gold hover:bg-gold/10">
            Volver a tirar
          </button>
        </div>
      )}

      <div className="space-y-2">
        {ABILITIES.map((a) => {
          const isPrimary = a.key === primaryKey;
          const raceBonus = raceDetail?.ability_bonuses?.find((b) => b.ability_score.index === a.key)?.bonus ?? 0;
          const raceChoiceBonus =
            (wd.raceAbilityChoice ?? []).includes(a.key) && raceDetail?.ability_bonus_options
              ? (raceDetail.ability_bonus_options.from.options.find((o) => o.ability_score.index === a.key)?.bonus ?? 0)
              : 0;
          const totalRaceBonus = raceBonus + raceChoiceBonus;
          const base = method === 'manual' ? wd.baseAbilities?.[a.key] ?? 10 : assignment[a.key] ?? null;
          const final = method === 'manual' ? (finalAbilities?.[a.key] ?? base + totalRaceBonus) : base != null ? base + totalRaceBonus : null;

          return (
            <div
              key={a.key}
              className={`flex items-center gap-3 rounded-sm border p-2 ${
                isPrimary ? 'border-gold/40 bg-gold/5' : 'border-bone/10 bg-night-950/50'
              }`}
            >
              <div className="w-14 shrink-0">
                <p className="font-display text-sm text-bone">{a.short}</p>
                {isPrimary && <p className="text-[10px] text-gold/80">Principal</p>}
              </div>

              {method === 'manual' ? (
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={wd.baseAbilities?.[a.key] ?? 10}
                  onChange={(e) => setManual(a.key, parseInt(e.target.value, 10) || 1)}
                  className="w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-center font-mono text-bone focus:border-gold focus:outline-none"
                />
              ) : method ? (
                <select
                  value={assignment[a.key] ?? ''}
                  onChange={(e) => assignFromPool(a.key, e.target.value)}
                  className="w-24 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 font-mono text-bone focus:border-gold focus:outline-none"
                >
                  <option value="">—</option>
                  {availableValuesFor(pool ?? [], assignment, a.key).map((v, i) => (
                    <option key={`${v}-${i}`} value={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <span className="w-24 text-sm text-bone/40">Elige un método</span>
              )}

              <div className="flex-1 text-right font-mono text-sm text-bone/60">
                {totalRaceBonus !== 0 && final != null && <span className="mr-2 text-xs text-gold/80">+{totalRaceBonus} raza</span>}
                {final != null ? (
                  <>
                    <span className="text-bone">{final}</span>{' '}
                    <span>{formatModifier(abilityModifier(final))}</span>
                  </>
                ) : (
                  <span className="text-bone/30">sin asignar</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {errors.baseAbilities && <p className="text-xs text-blood">{errors.baseAbilities}</p>}

      {primaryKey && (
        <p className="text-xs text-bone/60">
          {ABILITIES.find((a) => a.key === primaryKey)?.name} es la característica principal de tu
          clase: afecta a sus hechizos y/o habilidades más importantes.
        </p>
      )}

      <HelpBlock title="¿Qué es el modificador?">
        Es el número que realmente usas al jugar: se suma a tus tiradas de ataque, salvaciones y
        pruebas de característica. Se calcula a partir del valor total (incluyendo bonificadores
        raciales) con la fórmula estándar de 5e: (valor − 10) ÷ 2, redondeado hacia abajo.
      </HelpBlock>
    </div>
  );
}

export function validateCaracteristicas(char) {
  const errors = {};
  const wd = char.wizard_data;
  if (!wd.abilityMethod) {
    errors.abilityMethod = 'Elige un método para asignar las características.';
    return errors;
  }
  if (!wd.baseAbilities || Object.values(wd.baseAbilities).some((v) => v == null)) {
    errors.baseAbilities = 'Asigna un valor a las seis características antes de continuar.';
  }
  return errors;
}
