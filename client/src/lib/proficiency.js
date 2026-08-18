// Espejo cliente de server/src/rules/proficiency.js (Fase B): mismos cálculos
// para pintar y anticipar. El servidor revalida siempre.

const ARMOR_TOKENS = { Light: 'light-armor', Medium: 'medium-armor', Heavy: 'heavy-armor', Shield: 'shield' };

/** ¿El personaje es competente con esta arma? Por índice propio o por su categoría (simple/marcial). */
export function isProficientWithWeapon(weaponProficiencies, srdIndex, weaponCategory) {
  const tokens = new Set(weaponProficiencies ?? []);
  if (srdIndex && tokens.has(srdIndex)) return true;
  if (weaponCategory === 'Simple' && tokens.has('simple-weapons')) return true;
  if (weaponCategory === 'Martial' && tokens.has('martial-weapons')) return true;
  return false;
}

/** ¿El personaje es competente con esta armadura/escudo? `all-armor` cubre ligera/media/pesada, no escudos. */
export function isProficientWithArmor(armorProficiencies, armor) {
  if (!armor) return true;
  const token = ARMOR_TOKENS[armor.category];
  if (!token) return true;
  const tokens = new Set(armorProficiencies ?? []);
  if (tokens.has(token)) return true;
  if (token !== 'shield' && tokens.has('all-armor')) return true;
  return false;
}

/** Armadura o escudo equipado sin la competencia correspondiente (regla 2014: desventaja FUE/DES y sin conjuros). Las fichas del DM (jefe/enemigo/PNJ) no pasan por el asistente y quedan exentas, igual que con el nivel o la CA. */
export function wearingUnproficientArmor(character) {
  if (character?.kind === 'boss') return false;
  const inventory = character?.inventory ?? [];
  const armorProficiencies = character?.armor_proficiencies ?? [];
  return inventory.some(
    (item) =>
      (item.slot === 'armadura' || item.slot === 'escudo') &&
      item.armor &&
      !isProficientWithArmor(armorProficiencies, item.armor)
  );
}

/**
 * ¿Esta prueba o salvación sufre la desventaja por llevar armadura sin
 * competencia? La regla de 2014 la limita a FUERZA y DESTREZA: el resto de
 * características (y los conjuros, que directamente no se pueden lanzar) van
 * por su cuenta. Espejo de server/src/rules/proficiency.js.
 */
export function armorPenaltyAppliesTo(character, ability) {
  return (ability === 'str' || ability === 'dex') && wearingUnproficientArmor(character);
}
