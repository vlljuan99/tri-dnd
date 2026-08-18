// Reglas de equipo (Fase A de la rebanada vertical): forma válida del
// inventario, slots exclusivos de equipamiento y CA derivada de la armadura
// equipada. Autoridad del servidor — el espejo del cliente vive en
// client/src/lib/equipment.js y debe dar los mismos resultados.
import { abilityModifier } from './abilities.js';

const SLOTS = new Set(['mano-principal', 'mano-secundaria', 'armadura', 'escudo']);
const ARMOR_CATEGORIES = new Set(['Light', 'Medium', 'Heavy', 'Shield']);

function isTwoHanded(weapon) {
  return Boolean(weapon?.properties?.includes('two-handed'));
}

function validWeapon(weapon) {
  if (weapon == null) return true;
  return (
    typeof weapon === 'object' &&
    typeof weapon.damageDice === 'string' &&
    weapon.damageDice.length <= 20 &&
    (weapon.damageType == null || typeof weapon.damageType === 'string') &&
    (weapon.versatileDice == null || typeof weapon.versatileDice === 'string') &&
    Array.isArray(weapon.properties) &&
    weapon.properties.every((p) => typeof p === 'string')
  );
}

function validArmor(armor) {
  if (armor == null) return true;
  return (
    typeof armor === 'object' &&
    (armor.category == null || ARMOR_CATEGORIES.has(armor.category)) &&
    Number.isFinite(armor.base) &&
    typeof armor.dexBonus === 'boolean' &&
    (armor.maxBonus == null || Number.isFinite(armor.maxBonus))
  );
}

/**
 * Valida la forma de un inventario completo y sus restricciones de slot:
 * un único ocupante por slot, el escudo ocupa la mano secundaria (no convive
 * con un arma en ella), un arma a dos manos excluye la mano contraria
 * (incluido el escudo), y solo armas/armaduras del tipo correcto entran en
 * los slots de combate.
 */
export function validateInventory(inventory) {
  if (!Array.isArray(inventory) || JSON.stringify(inventory).length > 50_000) return false;
  const occupied = new Set();
  for (const item of inventory) {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || item.name.length > 120) return false;
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 999) return false;
    if (item.slot != null && !SLOTS.has(item.slot)) return false;
    if (!validWeapon(item.weapon)) return false;
    if (!validArmor(item.armor)) return false;
    if (item.slot === 'armadura' && (!item.armor || item.armor.category === 'Shield')) return false;
    if (item.slot === 'escudo' && item.armor?.category !== 'Shield') return false;
    if ((item.slot === 'mano-principal' || item.slot === 'mano-secundaria') && !item.weapon) return false;
    if (item.slot === 'mano-secundaria' && isTwoHanded(item.weapon)) return false;
    if (item.slot) {
      if (occupied.has(item.slot)) return false;
      occupied.add(item.slot);
    }
  }
  // El escudo se empuña: ocupa la mano secundaria y no deja sitio a un arma
  // en ella (regla del manual, ver docs/VERTICAL-SLICE.md, Fase A).
  if (occupied.has('escudo') && occupied.has('mano-secundaria')) return false;
  const mainHand = inventory.find((item) => item.slot === 'mano-principal');
  const offHandOccupied = inventory.some((item) => item.slot === 'mano-secundaria' || item.slot === 'escudo');
  if (mainHand && isTwoHanded(mainHand.weapon) && offHandOccupied) return false;
  return true;
}

/**
 * Objeto de inventario a partir de una entrada del compendio (misma forma de
 * `meta` que sirve la ruta del SRD). Nace en la mochila: quién lo empuña se
 * decide después desde la ficha. Espejo de
 * client/src/lib/equipment.js#inventoryItemFromEntry, que hace lo mismo cuando
 * el objeto entra por el asistente o por el buscador de la ficha.
 */
export function inventoryItemFromEntry(entry, qty = 1) {
  const meta = entry?.meta ?? {};
  const isWeapon = Boolean(meta.damage);
  const isArmor = Boolean(meta.armorClass);
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random()}`,
    srdIndex: entry?.index ?? null,
    name: entry?.name ?? 'Objeto',
    qty,
    slot: null,
    weapon: isWeapon
      ? {
          damageDice: meta.damage.dice,
          damageType: meta.damage.type,
          versatileDice: meta.twoHandedDamage?.dice ?? null,
          properties: meta.properties ?? [],
          weaponCategory: meta.weaponCategory ?? null,
          weaponRange: meta.weaponRange,
          range: meta.range ?? null,
          throwRange: meta.throwRange ?? null,
          magical: false,
          silvered: false,
          adamantine: false,
        }
      : null,
    armor: isArmor
      ? {
          category: meta.armorCategory ?? null,
          base: meta.armorClass?.base ?? 10,
          dexBonus: meta.armorClass?.dex_bonus !== false,
          maxBonus: Number.isFinite(meta.armorClass?.max_bonus) ? meta.armorClass.max_bonus : null,
          strMinimum: meta.strMinimum ?? 0,
          stealthDisadvantage: Boolean(meta.stealthDisadvantage),
        }
      : null,
  };
}

/**
 * CA derivada: armadura equipada (+ tope de DES según su categoría) y escudo
 * equipado. `ac_override` (no NULL) fuerza un valor manual para lo que las
 * reglas todavía no cubren y tiene siempre la última palabra.
 */
export function computeArmorClass(character) {
  if (Number.isInteger(character.ac_override)) {
    return Math.max(0, Math.min(40, character.ac_override));
  }
  const dexMod = abilityModifier(character.abilities?.dex ?? 10);
  const inventory = character.inventory ?? [];
  const armorItem = inventory.find((item) => item.slot === 'armadura' && item.armor);
  const shieldItem = inventory.find((item) => item.slot === 'escudo' && item.armor);

  let base = 10;
  let dexBonus = dexMod;
  if (armorItem) {
    base = Number.isFinite(armorItem.armor.base) ? armorItem.armor.base : 10;
    dexBonus = armorItem.armor.dexBonus
      ? Number.isFinite(armorItem.armor.maxBonus)
        ? Math.min(dexMod, armorItem.armor.maxBonus)
        : dexMod
      : 0;
  }
  const shieldBonus = shieldItem && Number.isFinite(shieldItem.armor.base) ? shieldItem.armor.base : 0;
  return Math.max(0, Math.min(40, base + dexBonus + shieldBonus));
}
