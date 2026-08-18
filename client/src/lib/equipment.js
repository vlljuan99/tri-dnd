// Espejo cliente de server/src/rules/equipment.js (Fase A): mismos cálculos
// para pintar y anticipar en la ficha y el asistente. El servidor revalida
// siempre — ver la nota de arquitectura en CLAUDE.md/AGENTS.md.
import { abilityModifier } from './dnd.js';

export const HAND_SLOTS = ['mano-principal', 'mano-secundaria'];

export const SLOT_LABELS = {
  'mano-principal': 'Mano principal',
  'mano-secundaria': 'Mano secundaria',
  armadura: 'Armadura',
  escudo: 'Escudo',
};

export function isTwoHanded(weapon) {
  return Boolean(weapon?.properties?.includes('two-handed'));
}

export function isVersatile(weapon) {
  return Boolean(weapon?.properties?.includes('versatile'));
}

/** Slots válidos para un objeto concreto, según sea arma, armadura o escudo. */
export function availableSlotsFor(item) {
  if (item.armor?.category === 'Shield') return ['escudo'];
  if (item.armor) return ['armadura'];
  if (item.weapon) return isTwoHanded(item.weapon) ? ['mano-principal'] : HAND_SLOTS;
  return [];
}

/**
 * Nuevo inventario con `item` puesto en `slot` (o de vuelta en la mochila si
 * `slot` es null). Libera el slot de destino si estaba ocupado, la mano
 * contraria cuando un arma a dos manos entra en juego (equiparla ocupa las
 * dos manos; equipar algo en la mano/escudo contrario la desequipa) y el
 * escudo cuando un arma pasa a la mano secundaria (y al revés): el escudo se
 * empuña con esa misma mano.
 */
export function equipItem(inventory, itemId, slot) {
  const item = inventory.find((i) => i.id === itemId);
  if (!item) return inventory;
  if (slot != null && !availableSlotsFor(item).includes(slot)) return inventory;

  let next = inventory.map((i) => {
    if (i.id === itemId) return { ...i, slot };
    if (slot != null && i.slot === slot) return { ...i, slot: null };
    return i;
  });

  if (slot === 'mano-principal' && isTwoHanded(item.weapon)) {
    next = next.map((i) =>
      i.id !== itemId && (i.slot === 'mano-secundaria' || i.slot === 'escudo') ? { ...i, slot: null } : i
    );
  }
  if (slot === 'mano-secundaria' || slot === 'escudo') {
    const rival = slot === 'escudo' ? 'mano-secundaria' : 'escudo';
    next = next.map((i) =>
      i.id !== itemId && (i.slot === rival || (i.slot === 'mano-principal' && isTwoHanded(i.weapon)))
        ? { ...i, slot: null }
        : i
    );
  }
  return next;
}

/** Item nuevo de inventario a partir de una entrada del compendio (SrdPicker/wizard). */
export function inventoryItemFromEntry(entry, qty = 1) {
  const meta = entry?.meta ?? {};
  const isWeapon = Boolean(meta.damage);
  const isArmor = Boolean(meta.armorClass);
  return {
    id: crypto.randomUUID(),
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

/** CA derivada de la armadura/escudo equipados + DES (mismo cálculo que el servidor). */
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
