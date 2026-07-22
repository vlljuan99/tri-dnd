export const REPARTO_CATEGORIES = [
  { id: 'todos', label: 'Todos' },
  { id: 'pnj', label: 'PNJ' },
  { id: 'enemigo', label: 'Enemigos' },
  { id: 'jefe', label: 'Jefes' },
];

export function normalizeRepartoText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function repartoCategory(character) {
  return ['pnj', 'enemigo', 'jefe'].includes(character?.dmCategory)
    ? character.dmCategory
    : 'jefe';
}

export function filterRepartoCharacters(characters, { query = '', category = 'todos', onlyCampaign = true } = {}) {
  const needle = normalizeRepartoText(query);
  return (characters ?? []).filter((character) => {
    if (onlyCampaign && !character.assigned) return false;
    if (category !== 'todos' && repartoCategory(character) !== category) return false;
    if (needle && !normalizeRepartoText(character.name).includes(needle)) return false;
    return true;
  });
}

export function repartoCategoryCounts(characters, { query = '', onlyCampaign = true } = {}) {
  const scoped = filterRepartoCharacters(characters, { query, category: 'todos', onlyCampaign });
  return scoped.reduce(
    (counts, character) => {
      counts.todos += 1;
      counts[repartoCategory(character)] += 1;
      return counts;
    },
    { todos: 0, pnj: 0, enemigo: 0, jefe: 0 }
  );
}

export function filterRepartoLibrary(entries, { query = '', onlyCampaign = true } = {}) {
  const needle = normalizeRepartoText(query);
  return (entries ?? []).filter((entry) => {
    if (onlyCampaign && !entry.assigned) return false;
    return !needle || normalizeRepartoText(entry.name).includes(needle);
  });
}
