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

export function weaponGeometry(weapon, equipmentData = null, { thrown = false } = {}) {
  const data = equipmentData ?? {};
  const weaponRange = weapon?.weaponRange ?? data.weapon_range ?? 'Melee';
  const properties = propertyIndexes(weapon?.properties?.length ? weapon.properties : data.properties);
  const thrownAttack = Boolean(thrown && properties.has('thrown'));
  const ranged = weaponRange === 'Ranged' || thrownAttack;
  const normalFeet = thrownAttack
    ? weapon?.throwRange?.normal ?? data.throw_range?.normal
    : weapon?.range?.normal ?? data.range?.normal;
  const longFeet = thrownAttack
    ? weapon?.throwRange?.long ?? data.throw_range?.long
    : weapon?.range?.long ?? data.range?.long;
  const normalSquares = feetToSquares(normalFeet, thrownAttack ? 4 : 24);
  return {
    ranged,
    reach: ranged ? 0 : properties.has('reach') ? 2 : 1,
    normalRange: ranged ? normalSquares : null,
    longRange: ranged
      ? feetToSquares(longFeet, thrownAttack ? Math.max(normalSquares, 12) : normalSquares)
      : null,
    thrownNormalRange: properties.has('thrown')
      ? feetToSquares(weapon?.throwRange?.normal ?? data.throw_range?.normal)
      : null,
    thrownLongRange: properties.has('thrown')
      ? feetToSquares(weapon?.throwRange?.long ?? data.throw_range?.long)
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
  if (miles) return Math.min(2000, Number(miles[1]) * 1056);
  return null;
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
