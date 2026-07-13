// Condiciones de combate 5e (más inconsciente). Mismo listado que el servidor
// (turnEconomy.COMBAT_CONDITIONS); aquí se les da etiqueta en español y un
// símbolo corto para pintar el chip sobre el token y en el tracker. La app no
// aplica efectos automáticos: son estado que el DM narra.
export const CONDITIONS = [
  { key: 'envenenado', label: 'Envenenado', symbol: '☠' },
  { key: 'derribado', label: 'Derribado', symbol: '⤓' },
  { key: 'agarrado', label: 'Agarrado', symbol: '✊' },
  { key: 'aturdido', label: 'Aturdido', symbol: '✦' },
  { key: 'cegado', label: 'Cegado', symbol: '⊘' },
  { key: 'ensordecido', label: 'Ensordecido', symbol: '🔇' },
  { key: 'asustado', label: 'Asustado', symbol: '❗' },
  { key: 'hechizado', label: 'Hechizado', symbol: '✨' },
  { key: 'paralizado', label: 'Paralizado', symbol: '⚡' },
  { key: 'petrificado', label: 'Petrificado', symbol: '🪨' },
  { key: 'apresado', label: 'Apresado', symbol: '⛓' },
  { key: 'invisible', label: 'Invisible', symbol: '◌' },
  { key: 'inconsciente', label: 'Inconsciente', symbol: '💤' },
];

const BY_KEY = Object.fromEntries(CONDITIONS.map((c) => [c.key, c]));

export function conditionLabel(key) {
  return BY_KEY[key]?.label ?? key;
}

export function conditionSymbol(key) {
  return BY_KEY[key]?.symbol ?? '•';
}
