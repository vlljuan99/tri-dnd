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
  if (Number.isInteger(count) && count > 0) {
    return { count: Math.min(MAX_MULTIATTACKS, count) };
  }

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

  if (/number of heads/i.test(text)) {
    // La hidra SRD empieza con cinco cabezas. El DM puede corregir el número
    // al iniciar la secuencia porque durante el encuentro puede perder y
    // regenerar cabezas.
    return { count: 5, variableCount: 'heads' };
  }
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

function attackActions(data) {
  return new Map(
    (data?.actions ?? [])
      .filter((action) => Number.isInteger(action.attack_bonus) && actionKey(action.name))
      .map((action) => [actionKey(action.name), action.name.trim()])
  );
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
    // El SRD normalmente agrupa cada ataque en una sola entrada. Si repite
    // una entrada numérica, las sumamos sin perder el tipo de alcance.
    if (!current.countFormula && !current.variableCount && !spec.countFormula && !spec.variableCount) {
      current.count = Math.min(MAX_MULTIATTACKS, current.count + spec.count);
    }
    if (current.type !== (action.type ?? null)) current.type = null;
  }
  const result = [...merged.values()];
  if (result.length === 0 || result.reduce((sum, action) => sum + maximumCount(action), 0) < 2) return null;
  return { id, label, actions: result };
}

// Convierte tanto `actions` como `action_options` de dnd5eapi en planes
// concretos. Las aptitudes sin tirada de ataque (p. ej. Presencia pavorosa)
// quedan narrativas; los golpes del plan sí se contabilizan en servidor.
export function buildMultiattackPlans(data) {
  const allowed = attackActions(data);
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
        return spec
          ? [{ actionName: action.action_name, ...spec, type: action.type ?? null }]
          : [];
      });
      const plan = cleanPlan(`multi-${multiIndex}`, 'Multiataque', actions, allowed);
      if (plan) plans.push(plan);
    }
  }
  return plans;
}

export function parseMultiattackState(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rollCountFormula(formula, random) {
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(formula ?? '');
  if (!match) return 0;
  const number = Number(match[1]);
  const sides = Number(match[2]);
  let total = Number(match[3] ?? 0);
  for (let i = 0; i < number; i += 1) total += 1 + Math.floor(random() * sides);
  return Math.max(1, Math.min(MAX_MULTIATTACKS, total));
}

function resolvePlan(plan, countOverrides, random) {
  const overrides = countOverrides && typeof countOverrides === 'object' ? countOverrides : {};
  return plan.actions.map((entry) => {
    let count = entry.count;
    if (entry.countFormula) count = rollCountFormula(entry.countFormula, random);
    if (entry.variableCount) {
      const requested = Number(overrides[entry.actionName]);
      if (Number.isInteger(requested)) count = Math.max(1, Math.min(MAX_MULTIATTACKS, requested));
    }
    return { actionName: entry.actionName, count, type: entry.type ?? null };
  });
}

export function consumeMonsterAttack({
  actionUsed,
  state,
  actionName,
  planId,
  plans,
  countOverrides = {},
  random = Math.random,
}) {
  const active = parseMultiattackState(state);
  const activeRemaining = Array.isArray(active.remaining) ? active.remaining : [];
  const requestedName = typeof actionName === 'string' ? actionName.trim() : '';
  if (!requestedName) return { ok: false, error: 'Ataque de monstruo no válido' };

  if (active.planId && activeRemaining.length > 0) {
    if (planId && planId !== active.planId) {
      return { ok: false, error: 'Debe terminar el multiataque que ya ha empezado' };
    }
    const index = activeRemaining.findIndex(
      (entry) => actionKey(entry.actionName) === actionKey(requestedName) && entry.count > 0
    );
    if (index < 0) return { ok: false, error: 'Ese golpe ya no está disponible en el multiataque' };
    const remaining = activeRemaining.map((entry) => ({ ...entry }));
    remaining[index].count -= 1;
    const nextRemaining = remaining.filter((entry) => entry.count > 0);
    const nextState = nextRemaining.length > 0 ? { planId: active.planId, label: active.label, remaining: nextRemaining } : {};
    return { ok: true, actionUsed: true, state: nextState, completed: nextRemaining.length === 0 };
  }

  if (actionUsed) return { ok: false, error: 'Ya se ha usado la acción de este combatiente este turno' };
  if (!planId) return { ok: true, actionUsed: true, state: {}, completed: true };

  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) return { ok: false, error: 'Multiataque no válido' };
  const resolved = resolvePlan(plan, countOverrides, random);
  const index = resolved.findIndex((entry) => actionKey(entry.actionName) === actionKey(requestedName));
  if (index < 0) return { ok: false, error: 'Ese golpe no forma parte del multiataque elegido' };
  const remaining = resolved.map((entry) => ({ ...entry }));
  remaining[index].count -= 1;
  const nextRemaining = remaining.filter((entry) => entry.count > 0);
  const nextState = nextRemaining.length > 0 ? { planId: plan.id, label: plan.label, remaining: nextRemaining } : {};
  return {
    ok: true,
    actionUsed: true,
    state: nextState,
    completed: nextRemaining.length === 0,
    resolvedCounts: resolved.map(({ actionName: name, count }) => ({ actionName: name, count })),
  };
}
