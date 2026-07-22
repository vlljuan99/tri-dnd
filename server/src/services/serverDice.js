function die(sides, random) {
  return 1 + Math.floor(random() * sides);
}

export function buildServerD20Roll({ bonus = 0, advantage = 'none', label, actorName, random = Math.random }) {
  const rolls = advantage === 'none' ? [die(20, random)] : [die(20, random), die(20, random)];
  const kept = advantage === 'adv' ? Math.max(...rolls) : advantage === 'dis' ? Math.min(...rolls) : rolls[0];
  const modifier = Math.trunc(Number(bonus) || 0);
  return {
    kind: 'attack',
    label,
    actorName,
    formula: `1d20${modifier ? ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}` : ''}`,
    groups: [{ die: 'd20', sides: 20, results: [{ rolls, kept }] }],
    modifier,
    advantage,
    total: kept + modifier,
    crit: kept === 20,
    fumble: kept === 1,
  };
}

export function parseDiceNotation(notation) {
  const match = /^\s*(\d{1,2})d(\d{1,3})(?:\s*([+-])\s*(\d{1,3}))?\s*$/i.exec(notation ?? '');
  if (!match) return null;
  const number = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(`${match[3]}${match[4]}`) : 0;
  if (number < 1 || number > 40 || sides < 2 || sides > 100) return null;
  return { number, sides, modifier };
}

export function buildServerDamageRoll({
  components,
  crit = false,
  label,
  actorName,
  random = Math.random,
}) {
  const groups = new Map();
  const resolved = [];
  let modifier = 0;
  for (const component of components) {
    const parsed = parseDiceNotation(component.dice);
    if (!parsed) {
      const amount = Math.max(0, Math.trunc(Number(component.amount) || 0));
      resolved.push({ ...component, amount });
      modifier += amount;
      continue;
    }
    const count = parsed.number * (crit ? 2 : 1);
    const results = [];
    let subtotal = parsed.modifier + Math.trunc(Number(component.modifier) || 0);
    for (let i = 0; i < count; i += 1) {
      const value = die(parsed.sides, random);
      results.push({ rolls: [value], kept: value });
      subtotal += value;
    }
    const key = `d${parsed.sides}`;
    const group = groups.get(key) ?? { die: key, sides: parsed.sides, results: [] };
    group.results.push(...results);
    groups.set(key, group);
    const componentModifier = parsed.modifier + Math.trunc(Number(component.modifier) || 0);
    modifier += componentModifier;
    resolved.push({ ...component, amount: Math.max(0, subtotal) });
  }
  const total = resolved.reduce((sum, component) => sum + component.amount, 0);
  const formulas = components.map((component) => {
    const parsed = parseDiceNotation(component.dice);
    if (!parsed) return String(Math.max(0, Math.trunc(Number(component.amount) || 0)));
    const count = parsed.number * (crit ? 2 : 1);
    const extra = parsed.modifier + Math.trunc(Number(component.modifier) || 0);
    return `${count}d${parsed.sides}${extra ? ` ${extra > 0 ? '+' : '−'} ${Math.abs(extra)}` : ''}`;
  });
  return {
    roll: {
      kind: 'damage',
      label,
      actorName,
      formula: formulas.join(' + '),
      groups: [...groups.values()],
      modifier,
      advantage: 'none',
      total,
      crit,
      fumble: false,
    },
    components: resolved,
  };
}
