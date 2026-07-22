export function feetToSquares(feet, fallback = null) {
  const value = Number(feet);
  return Number.isFinite(value) && value >= 0 ? Math.max(0, Math.ceil(value / 5)) : fallback;
}

export function gridDistance(from, to) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

function propertyIndexes(properties) {
  return new Set(
    (Array.isArray(properties) ? properties : [])
      .map((property) => (typeof property === 'string' ? property : property?.index))
      .filter(Boolean)
  );
}

export function weaponGeometry(weapon, { thrown = false } = {}) {
  const properties = propertyIndexes(weapon?.properties);
  const thrownAttack = Boolean(thrown && properties.has('thrown'));
  const ranged = weapon?.weaponRange === 'Ranged' || thrownAttack;
  const normal = feetToSquares(
    thrownAttack ? weapon?.throwRange?.normal : weapon?.range?.normal,
    thrownAttack ? 4 : 24
  );
  return {
    ranged,
    reach: ranged ? 0 : properties.has('reach') ? 2 : 1,
    normalRange: ranged ? normal : null,
    longRange: ranged
      ? feetToSquares(
          thrownAttack ? weapon?.throwRange?.long : weapon?.range?.long,
          thrownAttack ? Math.max(normal, 12) : normal
        )
      : null,
    thrown: thrownAttack,
  };
}

export function monsterAttackGeometry(action) {
  const text = `${action?.name ?? ''} ${action?.desc ?? ''}`;
  const ranged = /ranged/i.test(text) && !/melee or ranged/i.test(text);
  const reach = /reach\s+(\d+)\s*ft/i.exec(text);
  const range = /range\s+(\d+)(?:\s*\/\s*(\d+))?\s*ft/i.exec(text);
  if (ranged || range) {
    const normal = feetToSquares(range?.[1], 24);
    return { ranged: true, reach: 0, normalRange: normal, longRange: feetToSquares(range?.[2], normal) };
  }
  return { ranged: false, reach: feetToSquares(reach?.[1], 1), normalRange: null, longRange: null };
}

export function spellRangeSquares(data) {
  const range = typeof data?.range === 'string' ? data.range : '';
  if (/^touch$/i.test(range)) return 1;
  if (/^self$/i.test(range)) return 0;
  const feet = /(\d+)\s*(?:feet|foot|ft)/i.exec(range);
  if (feet) return feetToSquares(feet[1], 0);
  const miles = /(\d+)\s*miles?/i.exec(range);
  return miles ? Math.min(2000, Number(miles[1]) * 1056) : null;
}

export function rangeValidation(distance, { ranged, reach = 1, normalRange = null, longRange = null } = {}) {
  if (!ranged) {
    return distance <= reach
      ? { ok: true, longRange: false }
      : { ok: false, error: `Demasiado lejos: alcance ${reach * 5} pies` };
  }
  if (Number.isInteger(longRange) && distance > longRange) {
    return { ok: false, error: `Fuera de alcance: máximo ${longRange * 5} pies` };
  }
  return { ok: true, longRange: Number.isInteger(normalRange) && distance > normalRange };
}
