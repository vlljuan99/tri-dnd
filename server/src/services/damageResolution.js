// Resolución pura del daño 5e por componentes. Las defensas del SRD son
// cadenas (incluidos calificadores como "from nonmagical attacks"), por lo
// que se interpretan de forma conservadora: un calificador solo se aplica si
// el origen del golpe aporta la información necesaria.

export const DAMAGE_TYPES = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

export const DAMAGE_TYPE_ES = {
  acid: 'ácido',
  bludgeoning: 'contundente',
  cold: 'frío',
  fire: 'fuego',
  force: 'fuerza',
  lightning: 'relámpago',
  necrotic: 'necrótico',
  piercing: 'perforante',
  poison: 'veneno',
  psychic: 'psíquico',
  radiant: 'radiante',
  slashing: 'cortante',
  thunder: 'trueno',
};

export function sanitizeDamageComponents(components, total, { forcedTypes = null } = {}) {
  const cleanTotal = Math.max(0, Math.min(999, Math.round(Number(total)) || 0));
  if (!Array.isArray(components) || components.length === 0) {
    if (forcedTypes?.length > 1) return { error: 'Faltan componentes del daño' };
    return {
      components: [{ amount: cleanTotal, type: forcedTypes?.[0] ?? null, magical: false }],
      total: cleanTotal,
    };
  }
  if (components.length > 8) return { error: 'Demasiados componentes de daño' };
  if (forcedTypes && forcedTypes.length !== components.length) {
    return { error: 'Los componentes no coinciden con el ataque' };
  }

  const clean = [];
  for (let i = 0; i < components.length; i += 1) {
    const component = components[i];
    const amount = Math.max(0, Math.min(999, Math.round(Number(component?.amount)) || 0));
    const suppliedType = typeof component?.type === 'string' ? component.type.toLowerCase() : null;
    const type = forcedTypes?.[i] ?? suppliedType;
    if (type !== null && !DAMAGE_TYPES.has(type)) return { error: 'Tipo de daño no válido' };
    clean.push({
      amount,
      type,
      magical: Boolean(component?.magical),
      silvered: Boolean(component?.silvered),
      adamantine: Boolean(component?.adamantine),
    });
  }
  const componentTotal = clean.reduce((sum, component) => sum + component.amount, 0);
  if (componentTotal !== cleanTotal) return { error: 'El desglose de daño no coincide con la tirada' };
  return { components: clean, total: cleanTotal };
}

function defenseMatches(entry, component, source) {
  if (!component.type || typeof entry !== 'string') return false;
  const text = entry.toLowerCase();
  if (!new RegExp(`\\b${component.type}\\b`).test(text)) return false;

  if (text.includes('from nonmagical attacks')) {
    if (source !== 'attack' || component.magical) return false;
  } else if (text.includes('nonmagical') && component.magical) {
    return false;
  }
  if ((text.includes("aren't silvered") || text.includes('not silvered')) && component.silvered) return false;
  if ((text.includes("aren't adamantine") || text.includes('not adamantine')) && component.adamantine) return false;
  return true;
}

function matchesAny(entries, component, source) {
  return (Array.isArray(entries) ? entries : []).some((entry) => defenseMatches(entry, component, source));
}

export function resolveDamageComponents(
  components,
  { resistances = [], vulnerabilities = [], immunities = [], petrified = false } = {},
  { source = 'attack' } = {}
) {
  const resolved = components.map((component) => {
    const immune = matchesAny(immunities, component, source);
    const resistant = Boolean(petrified) || matchesAny(resistances, component, source);
    const vulnerable = matchesAny(vulnerabilities, component, source);
    let applied = component.amount;
    let adjustment = 'normal';
    if (immune) {
      applied = 0;
      adjustment = 'immunity';
    } else if (resistant && vulnerable) {
      adjustment = 'cancelled';
    } else if (resistant) {
      applied = Math.floor(component.amount / 2);
      adjustment = 'resistance';
    } else if (vulnerable) {
      applied = Math.min(999, component.amount * 2);
      adjustment = 'vulnerability';
    }
    return { ...component, applied, adjustment };
  });
  return {
    components: resolved,
    rolledTotal: resolved.reduce((sum, component) => sum + component.amount, 0),
    appliedTotal: Math.min(999, resolved.reduce((sum, component) => sum + component.applied, 0)),
  };
}

export function damageAdjustmentText(components) {
  const labels = [];
  for (const component of components) {
    if (component.adjustment === 'normal') continue;
    const type = DAMAGE_TYPE_ES[component.type] ?? component.type ?? 'sin tipo';
    const prefix = {
      immunity: 'inmunidad',
      resistance: 'resistencia',
      vulnerability: 'vulnerabilidad',
      cancelled: 'resistencia y vulnerabilidad se cancelan',
    }[component.adjustment];
    labels.push(`${prefix}: ${type}`);
  }
  return [...new Set(labels)];
}

export function absorbTemporaryHitPoints(damage, temporaryHitPoints) {
  const incoming = Math.max(0, Math.round(Number(damage)) || 0);
  const available = Math.max(0, Math.round(Number(temporaryHitPoints)) || 0);
  const absorbed = Math.min(incoming, available);
  return {
    absorbed,
    remainingTemporaryHitPoints: available - absorbed,
    hitPointDamage: incoming - absorbed,
  };
}

// Los PG exactos de un enemigo son información del DM. El jugador recibe el
// resultado observable (daño, defensas y si cayó), pero no puede reconstruir
// sus PG reales ni su reserva temporal desde la respuesta privada del socket.
export function damageDetailForViewer(detail, { enemy = false, isDm = false } = {}) {
  if (!enemy || isDm) return detail;
  return {
    ...detail,
    tempAbsorbed: detail.tempAbsorbed > 0 ? true : 0,
    remainingTempHp: null,
    remainingHp: null,
    maxHp: null,
  };
}
