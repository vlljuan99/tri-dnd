const MAX_MULTIATTACKS = 20;

function actionKey(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function countSpec(value) {
  const count = Number(value);
  if (Number.isInteger(count) && count > 0) return { count: Math.min(MAX_MULTIATTACKS, count) };
  const text = typeof value === 'string' ? value.trim() : '';
  const dice = /^(\d{1,2})d(\d{1,3})(?:\s*([+-])\s*(\d{1,2}))?$/i.exec(text);
  if (dice) {
    const number = Number(dice[1]);
    const sides = Number(dice[2]);
    const modifier = dice[3] ? Number(`${dice[3]}${dice[4]}`) : 0;
    const minimum = Math.max(0, number + modifier);
    const maximum = Math.min(MAX_MULTIATTACKS, number * sides + modifier);
    if (number > 0 && sides > 0 && minimum <= maximum && maximum > 0) {
      return { count: 0, countFormula: `${number}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}` };
    }
  }
  if (/number of heads/i.test(text)) return { count: 5, variableCount: 'heads' };
  return null;
}

function optionActions(option) {
  if (!option || typeof option !== 'object') return [];
  if (option.option_type === 'action') {
    const spec = countSpec(option.count);
    return spec ? [{ actionName: option.action_name, ...spec, type: option.type ?? null }] : [];
  }
  if (option.option_type === 'multiple') return (option.items ?? []).flatMap(optionActions);
  return [];
}

function maximumCount(action) {
  if (!action.countFormula) return action.count;
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(action.countFormula);
  return match
    ? Math.min(MAX_MULTIATTACKS, Number(match[1]) * Number(match[2]) + Number(match[3] ?? 0))
    : 0;
}

function cleanPlan(id, label, actions, allowed) {
  const merged = new Map();
  for (const action of actions) {
    const key = actionKey(action.actionName);
    const canonicalName = allowed.get(key);
    const spec = action.countFormula || action.variableCount ? action : countSpec(action.count);
    if (!canonicalName || !spec) continue;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        actionName: canonicalName,
        count: spec.count,
        ...(spec.countFormula ? { countFormula: spec.countFormula } : {}),
        ...(spec.variableCount ? { variableCount: spec.variableCount } : {}),
        type: action.type ?? null,
      });
      continue;
    }
    if (!current.countFormula && !current.variableCount && !spec.countFormula && !spec.variableCount) {
      current.count = Math.min(MAX_MULTIATTACKS, current.count + spec.count);
    }
    if (current.type !== (action.type ?? null)) current.type = null;
  }
  const result = [...merged.values()];
  if (result.length === 0 || result.reduce((sum, action) => sum + maximumCount(action), 0) < 2) return null;
  return { id, label, actions: result };
}

export function buildMultiattackPlans(data) {
  const allowed = new Map(
    (data?.actions ?? [])
      .filter((action) => Number.isInteger(action.attack_bonus) && actionKey(action.name))
      .map((action) => [actionKey(action.name), action.name.trim()])
  );
  const plans = [];
  for (const [multiIndex, multi] of (data?.actions ?? []).entries()) {
    if (multi.name?.toLowerCase() !== 'multiattack') continue;
    if (multi.multiattack_type === 'action_options') {
      const options = multi.action_options?.from?.options ?? [];
      options.forEach((option, optionIndex) => {
        const plan = cleanPlan(
          `multi-${multiIndex}-option-${optionIndex}`,
          options.length > 1 ? `Multiataque · opción ${optionIndex + 1}` : 'Multiataque',
          optionActions(option),
          allowed
        );
        if (plan) plans.push(plan);
      });
    } else {
      const actions = (multi.actions ?? []).flatMap((action) => {
        const spec = countSpec(action.count);
        return spec ? [{ actionName: action.action_name, ...spec, type: action.type ?? null }] : [];
      });
      const plan = cleanPlan(`multi-${multiIndex}`, 'Multiataque', actions, allowed);
      if (plan) plans.push(plan);
    }
  }
  return plans;
}

export function planCountLabel(action) {
  if (action.countFormula) return action.countFormula;
  if (action.variableCount === 'heads') return `${action.count} cabezas`;
  return String(action.count);
}

export function planSummary(plan) {
  return plan.actions.map((action) => `${planCountLabel(action)}× ${action.actionName}`).join(' + ');
}
