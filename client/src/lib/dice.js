// Motor de dados de TriDnD.
// Un resultado de tirada tiene esta forma (se comparte tal cual por Socket.io):
// {
//   kind: 'dice' | 'attack' | 'damage' | 'check',
//   label: 'Espada larga — ataque',
//   formula: '1d20+5',
//   groups: [{ die: 'd20', sides: 20, results: [{ rolls: [14, 3], kept: 14 }] }],
//   modifier: 5, advantage: 'none'|'adv'|'dis',
//   total: 19, crit: false, fumble: false,
// }

export const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

export function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

function formatFormula(pool, modifier) {
  const parts = DICE_TYPES.filter((d) => pool[d] > 0).map((d) => `${pool[d]}${d}`);
  let formula = parts.join(' + ') || '0';
  if (modifier > 0) formula += ` + ${modifier}`;
  if (modifier < 0) formula += ` − ${Math.abs(modifier)}`;
  return formula;
}

/**
 * Tira un conjunto de dados. `pool` = { d4: 0, d6: 2, ... }.
 * La ventaja/desventaja solo afecta a los d20: cada d20 se tira dos veces
 * y se conserva el mayor (ventaja) o el menor (desventaja).
 */
export function rollPool(pool, { modifier = 0, advantage = 'none', kind = 'dice', label = '' } = {}) {
  const groups = [];
  let total = 0;

  for (const die of DICE_TYPES) {
    const count = pool[die] ?? 0;
    if (count <= 0) continue;
    const sides = Number(die.slice(1));
    const results = [];
    for (let i = 0; i < count; i++) {
      if (sides === 20 && advantage !== 'none') {
        const a = rollDie(20);
        const b = rollDie(20);
        const kept = advantage === 'adv' ? Math.max(a, b) : Math.min(a, b);
        results.push({ rolls: [a, b], kept });
        total += kept;
      } else {
        const r = rollDie(sides);
        results.push({ rolls: [r], kept: r });
        total += r;
      }
    }
    groups.push({ die, sides, results });
  }

  total += modifier;
  const naturals = groups.find((g) => g.sides === 20)?.results.map((r) => r.kept) ?? [];

  return {
    kind,
    label,
    formula: formatFormula(pool, modifier),
    groups,
    modifier,
    advantage,
    total,
    crit: naturals.includes(20),
    fumble: naturals.includes(1),
  };
}

/** Parsea notación tipo "2d6" / "1d8" a { count, sides }; null si no es válida. */
export function parseDice(notation) {
  const m = /^(\d{1,2})d(\d{1,3})$/i.exec(String(notation).trim());
  if (!m) return null;
  const count = Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || count > 40 || sides < 2 || sides > 100) return null;
  return { count, sides };
}

/** Tirada de ataque: 1d20 + bonificador, con ventaja/desventaja. */
export function rollAttack(bonus, { advantage = 'none', label = 'Ataque' } = {}) {
  return rollPool({ d20: 1 }, { modifier: bonus, advantage, kind: 'attack', label });
}

/**
 * Tirada de daño desde notación ("1d8", "8d6"…) + modificador.
 * Un crítico dobla el número de dados, nunca el modificador.
 */
export function rollDamage(notation, { modifier = 0, crit = false, label = 'Daño' } = {}) {
  const parsed = parseDice(notation);
  if (!parsed) return null;
  const count = crit ? parsed.count * 2 : parsed.count;
  const sides = parsed.sides;

  const results = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const r = rollDie(sides);
    results.push({ rolls: [r], kept: r });
    total += r;
  }
  total += modifier;

  let formula = `${count}d${sides}`;
  if (modifier > 0) formula += ` + ${modifier}`;
  if (modifier < 0) formula += ` − ${Math.abs(modifier)}`;
  if (crit) formula += ' (crítico)';

  return {
    kind: 'damage',
    label,
    formula,
    groups: [{ die: `d${sides}`, sides, results }],
    modifier,
    advantage: 'none',
    total,
    crit,
    fumble: false,
  };
}
