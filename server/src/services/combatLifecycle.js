// Transiciones puras del ciclo de combate. Mantenerlas sin acceso a la BD
// permite probar las reglas delicadas (muerte y caducidad de condiciones) sin
// levantar una campaña completa.

export const DEATH_STATES = Object.freeze({
  NORMAL: 'normal',
  DYING: 'dying',
  STABLE: 'stable',
  DEAD: 'dead',
});

export const CONDITION_TIMINGS = Object.freeze(['start', 'end']);

function boundedMark(value) {
  return Math.max(0, Math.min(3, Math.round(Number(value)) || 0));
}

export function resolveDeathSave({ state, successes, failures }, d20) {
  if (state !== DEATH_STATES.DYING) {
    return { ok: false, error: state === DEATH_STATES.STABLE ? 'El personaje ya está estable' : 'El personaje no está agonizando' };
  }

  const natural = Math.max(1, Math.min(20, Math.round(Number(d20)) || 1));
  let nextSuccesses = boundedMark(successes);
  let nextFailures = boundedMark(failures);
  let nextState = DEATH_STATES.DYING;
  let outcome;

  if (natural === 20) {
    nextSuccesses = 0;
    nextFailures = 0;
    nextState = DEATH_STATES.NORMAL;
    outcome = 'revive';
  } else if (natural === 1) {
    nextFailures = Math.min(3, nextFailures + 2);
    outcome = nextFailures >= 3 ? 'muere' : 'fallo';
  } else if (natural >= 10) {
    nextSuccesses = Math.min(3, nextSuccesses + 1);
    outcome = nextSuccesses >= 3 ? 'estable' : 'exito';
  } else {
    nextFailures = Math.min(3, nextFailures + 1);
    outcome = nextFailures >= 3 ? 'muere' : 'fallo';
  }

  if (outcome === 'estable') {
    // Al estabilizarse se borran éxitos y fallos; el estado explícito conserva
    // la información que antes se perdía al dejar ambos contadores a cero.
    nextState = DEATH_STATES.STABLE;
    nextSuccesses = 0;
    nextFailures = 0;
  }
  if (outcome === 'muere') nextState = DEATH_STATES.DEAD;

  return {
    ok: true,
    natural,
    outcome,
    state: nextState,
    successes: nextSuccesses,
    failures: nextFailures,
  };
}

export function damageAtZeroTransition({ state, successes, failures, critical = false, massive = false }) {
  if (state === DEATH_STATES.DEAD) {
    return { state, successes: boundedMark(successes), failures: 3, addedFailures: 0, died: true };
  }
  if (massive) {
    return { state: DEATH_STATES.DEAD, successes: 0, failures: 3, addedFailures: 0, died: true };
  }

  const wasStable = state === DEATH_STATES.STABLE;
  const addedFailures = critical ? 2 : 1;
  const nextFailures = Math.min(3, (wasStable ? 0 : boundedMark(failures)) + addedFailures);
  return {
    state: nextFailures >= 3 ? DEATH_STATES.DEAD : DEATH_STATES.DYING,
    successes: wasStable ? 0 : boundedMark(successes),
    failures: nextFailures,
    addedFailures,
    died: nextFailures >= 3,
  };
}

export function isMassiveDamage({ previousHp, hpMax, hitPointDamage }) {
  const maximum = Number(hpMax);
  if (!Number.isFinite(maximum) || maximum <= 0) return false;
  const remainingDamage = Math.max(0, Number(hitPointDamage) - Math.max(0, Number(previousHp) || 0));
  return remainingDamage >= maximum;
}

export function normalizeConditionTimers(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const byCondition = new Map();
  for (const entry of parsed) {
    const condition = typeof entry?.condition === 'string' ? entry.condition : '';
    const remaining = Math.round(Number(entry?.remaining));
    const timing = CONDITION_TIMINGS.includes(entry?.timing) ? entry.timing : null;
    if (!condition || !Number.isInteger(remaining) || remaining < 1 || remaining > 99 || !timing) continue;
    byCondition.set(condition, { condition, remaining, timing });
  }
  return [...byCondition.values()];
}

export function conditionTimer(condition, { duration, timing } = {}) {
  const remaining = Math.round(Number(duration));
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 99) return null;
  return {
    condition,
    remaining,
    timing: CONDITION_TIMINGS.includes(timing) ? timing : 'end',
  };
}

export function tickConditionTimers({ conditions, timers, fluidConditions, timing }) {
  const currentConditions = Array.isArray(conditions) ? [...new Set(conditions)] : [];
  const automatic = new Set(Array.isArray(fluidConditions) ? fluidConditions : []);
  const nextTimers = [];
  const expired = [];

  for (const timer of normalizeConditionTimers(timers)) {
    if (timer.timing !== timing) {
      nextTimers.push(timer);
      continue;
    }
    if (timer.remaining > 1) {
      nextTimers.push({ ...timer, remaining: timer.remaining - 1 });
      continue;
    }
    expired.push(timer.condition);
  }

  const expiredSet = new Set(expired.filter((condition) => !automatic.has(condition)));
  return {
    conditions: currentConditions.filter((condition) => !expiredSet.has(condition)),
    timers: nextTimers,
    // Solo se anuncia lo que realmente desaparece. Si un fluido mantiene la
    // misma condición, caduca el temporizador manual pero el efecto sigue.
    expired: [...expiredSet],
  };
}
