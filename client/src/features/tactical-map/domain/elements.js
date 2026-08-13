// Color por tipo de daño 5e, usado SOLO para pintar la mira y el destello de
// un conjuro en el tablero. Es cosmético: no cambia ninguna regla, no aplica
// estados y no altera el daño (5e clásico no liga condiciones al elemento;
// eso queda para la fase homebrew de efectos elementales del ROADMAP).
export const ELEMENT_COLORS = {
  acid: '#8ed14f',
  bludgeoning: '#c9c2b4',
  cold: '#7fd8ff',
  fire: '#ff7a2a',
  force: '#c58cff',
  lightning: '#ffe45c',
  necrotic: '#9a6ab5',
  piercing: '#d8cfc0',
  poison: '#7fbf4a',
  psychic: '#ff86d0',
  radiant: '#ffe9b0',
  slashing: '#d8cfc0',
  thunder: '#8fb6ff',
};

// Violeta arcano: conjuros sin daño tipado (control, ilusión, utilidad…)
export const ARCANE_COLOR = '#b78cff';
export const INVALID_COLOR = '#ff6b5e';

export function elementColor(type) {
  if (!type) return ARCANE_COLOR;
  return ELEMENT_COLORS[String(type).toLowerCase()] ?? ARCANE_COLOR;
}

/** Tipo de daño de una entrada de conjuro del SRD, o null si no lo tiene. */
export function spellElement(data) {
  const raw = data?.damage?.damage_type?.index ?? data?.damage?.damage_type?.name;
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  return ELEMENT_COLORS[key] ? key : null;
}
