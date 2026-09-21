import { ABILITIES, abilityModifier, formatModifier, PRIMARY_ABILITY } from '../../lib/dnd.js';
import { ABILITY_METHODS, STANDARD_ARRAY, rollAbilityPool, applyRacialBonuses, recommendedBuild, validateAbilityAssignment, pointBuyCost, POINT_BUY_BUDGET } from '../../lib/wizard.js';
import StatTooltip from '../StatTooltip.jsx';

function availableValuesFor(pool, assignment, currentKey) {
  const remaining = [...pool];
  Object.entries(assignment).forEach(([key, value]) => {
    if (key !== currentKey && value != null) {
      const index = remaining.indexOf(value);
      if (index >= 0) remaining.splice(index, 1);
    }
  });
  return remaining.sort((a, b) => b - a);
}

export default function StepCaracteristicas({ char, patch, classDetail, raceDetail, errors, onPreview }) {
  const wd = char.wizard_data;
  const method = wd.abilityMethod;
  const pool = method === 'array' ? STANDARD_ARRAY : wd.rolledPool ?? [];
  const assignment = wd.poolAssignment ?? {};
  const primaryKey = PRIMARY_ABILITY[char.class_index] ?? classDetail?.spellcasting?.spellcasting_ability?.index;
  const direct = method === 'manual' || method === 'point-buy';
  const cost = pointBuyCost(wd.baseAbilities);
  const finals = applyRacialBonuses(wd.baseAbilities ?? assignment, raceDetail, wd.raceAbilityChoice ?? []);
  const recommendation = () => recommendedBuild({ char, classDetail, raceDetail });

  function chooseMethod(id) {
    patch({ wizard_data: { ...wd, abilityMethod: id, poolAssignment: {},
      rolledPool: id === 'roll' ? rollAbilityPool() : null,
      baseAbilities: ['manual', 'point-buy'].includes(id)
        ? Object.fromEntries(ABILITIES.map(({ key }) => [key, id === 'point-buy' ? 8 : 10])) : null } });
  }
  function assignmentPatch(key, value) {
    if (direct) return { wizard_data: { ...wd, baseAbilities: { ...wd.baseAbilities, [key]: value } } };
    const next = { ...assignment, [key]: value };
    return { wizard_data: { ...wd, poolAssignment: next,
      baseAbilities: ABILITIES.every(({ key: k }) => next[k] != null) ? { ...next } : null } };
  }
  function showPreview(label, fields) { onPreview?.({ label, fields }); }

  return (
    <div className="space-y-5">
      <p className="text-sm text-bone/70">¿Fuerza bruta, reflejos o ingenio? Da forma a tu manera de jugar. Los bonos de tu especie se suman después.</p>
      <button type="button" disabled={!classDetail} className="w-full rounded-md border border-gold/50 bg-gold/10 p-4 text-left disabled:opacity-40"
        onClick={() => { patch(recommendation()); onPreview?.(null); }}
        onMouseEnter={() => classDetail && showPreview('Reparto recomendado', recommendation())} onMouseLeave={() => onPreview?.(null)}
        onFocus={() => classDetail && showPreview('Reparto recomendado', recommendation())} onBlur={() => onPreview?.(null)}>
        <span className="block font-display text-gold">✦ Reparto recomendado</span>
        <span className="mt-1 block text-sm text-bone/70">Una buena base para tu clase, con sus habilidades típicas. Puedes cambiarlo todo después.</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        {ABILITY_METHODS.map((m) => (
          <button key={m.id} type="button" onClick={() => chooseMethod(m.id)} aria-pressed={method === m.id}
            className={`min-w-0 rounded-md border p-3 text-left ${method === m.id ? 'border-gold bg-gold/10' : 'border-bone/15 hover:border-gold/50'}`}>
            <span className="block font-display text-xs text-gold">{m.name}</span>
            <span className="mt-1 block text-xs leading-relaxed text-bone/60">{m.desc}</span>
          </button>
        ))}
      </div>
      {errors.abilityMethod && <p role="alert" className="text-sm text-red-300">{errors.abilityMethod}</p>}
      {method === 'point-buy' && (
        <div className="rounded-md border border-teal-400/25 bg-teal-400/5 p-3">
          <p className="text-sm text-teal-200">Compra por puntos · <strong>{cost == null ? '—' : POINT_BUY_BUDGET - cost} puntos disponibles</strong></p>
          <p className="mt-1 text-xs text-bone/60">Regla oficial del Manual del Jugador 2014; no incluida en el SRD 5.1. Presupuesto de 27 puntos, valores de 8 a 15 antes de bonos raciales.</p>
          <p className="mt-1 text-xs text-bone/50">8–13: un punto por aumento. 14 y 15: dos puntos por aumento.</p>
        </div>
      )}
      {method === 'roll' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-bone/15 p-3 text-sm">
          <span className="font-mono text-bone/80">{pool.join(' · ')}</span>
          <button type="button" onClick={() => patch({ wizard_data: { ...wd, rolledPool: rollAbilityPool(), poolAssignment: {}, baseAbilities: null } })}
            className="rounded border border-gold/40 px-3 py-2 text-xs text-gold">Volver a tirar</button>
        </div>
      )}
      <div className="space-y-2">
        {ABILITIES.map((a) => {
          const base = direct ? wd.baseAbilities?.[a.key] : assignment[a.key];
          const final = base == null ? null : finals[a.key];
          const fieldError = errors[a.key] ?? errors[`baseAbilities.${a.key}`];
          return (
            <div key={a.key} className={`rounded-md border p-3 ${a.key === primaryKey ? 'border-gold/40 bg-gold/5' : 'border-bone/10 bg-black/15'}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <StatTooltip stat={a.key} className="font-display text-sm">{a.name}</StatTooltip>
                  {a.key === primaryKey && <p className="text-[10px] uppercase tracking-wider text-gold">Principal de tu clase</p>}
                </div>
                {method === 'point-buy' ? (
                  <div className="flex items-center gap-1">
                    <output className="w-6 text-center font-mono">{base}</output>
                    {[-1, 1].map((delta) => {
                      const fields = assignmentPatch(a.key, base + delta);
                      const nextCost = pointBuyCost(fields.wizard_data.baseAbilities);
                      const disabled = nextCost == null || nextCost > POINT_BUY_BUDGET;
                      const label = `${delta > 0 ? '+' : ''}${delta} ${a.short}`;
                      return <button key={delta} type="button" disabled={disabled} aria-label={`${delta > 0 ? 'Aumentar' : 'Reducir'} ${a.name}`}
                        onClick={() => { patch(fields); onPreview?.(null); }}
                        onMouseEnter={() => !disabled && showPreview(label, fields)} onMouseLeave={() => onPreview?.(null)}
                        onFocus={() => !disabled && showPreview(label, fields)} onBlur={() => onPreview?.(null)}
                        className="h-9 w-9 rounded border border-gold/30 text-gold disabled:opacity-25">{delta > 0 ? '+' : '−'}</button>;
                    })}
                  </div>
                ) : method === 'manual' ? (
                  <input aria-label={a.name} type="number" min={1} max={30} value={base ?? ''}
                    onChange={(e) => patch(assignmentPatch(a.key, e.target.value === '' ? null : Number(e.target.value)))}
                    className="w-16 rounded border border-bone/20 bg-night-950 p-2 text-center font-mono" />
                ) : method ? (
                  <select aria-label={a.name} value={base ?? ''} onChange={(e) => patch(assignmentPatch(a.key, e.target.value === '' ? null : Number(e.target.value)))}
                    className="w-16 rounded border border-bone/20 bg-night-950 p-2 font-mono">
                    <option value="">—</option>
                    {availableValuesFor(pool, assignment, a.key).map((v, i) => <option key={`${v}-${i}`} value={v}>{v}</option>)}
                  </select>
                ) : <span className="text-xs text-bone/40">Sin asignar</span>}
                <div className="w-14 shrink-0 text-right">
                  <p className="font-mono text-lg text-gold">{final == null ? '—' : formatModifier(abilityModifier(final))}</p>
                  <p className="text-[10px] text-bone/50">{final == null ? a.short : `${base}${final !== base ? ` + ${final - base}` : ''} = ${final}`}</p>
                </div>
              </div>
              {fieldError && <p role="alert" className="mt-2 text-xs text-red-300">{fieldError}</p>}
              {method && base == null && <p className="mt-2 text-xs text-gold/80">Asigna un valor a {a.name.toLowerCase()} para calcular su modificador.</p>}
            </div>
          );
        })}
      </div>
      {Object.entries(errors).filter(([key]) => !['abilityMethod', ...ABILITIES.map(a => a.key), ...ABILITIES.map(a => `baseAbilities.${a.key}`)].includes(key)).map(([key, value]) => <p key={key} role="alert" className="text-sm text-red-300">{value}</p>)}
      <p className="text-xs text-bone/50">El número grande es tu modificador: se suma a las tiradas. Debajo verás base + bono de especie = valor final.</p>
    </div>
  );
}

export function validateCaracteristicas(char) {
  return validateAbilityAssignment(char.wizard_data ?? {});
}
