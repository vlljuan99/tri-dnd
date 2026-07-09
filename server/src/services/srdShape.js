// Resumen mínimo por categoría del SRD para pintar listados sin descargar el
// detalle. Extraído de routes/srd.js para poder reutilizarlo también con el
// contenido propio del DM (Fase 15), que se guarda con la misma forma de
// `data` que una entrada del SRD y así comparte serializador y consumo.
export function buildMeta(category, data) {
  if (category === 'spells') {
    return {
      level: data.level,
      school: data.school?.index,
      concentration: data.concentration,
      ritual: data.ritual,
      attackType: data.attack_type ?? null,
      hasDamage: Boolean(data.damage),
      dc: data.dc?.dc_type?.index ?? null,
    };
  }
  if (category === 'equipment') {
    return {
      equipmentCategory: data.equipment_category?.index,
      damage: data.damage
        ? { dice: data.damage.damage_dice, type: data.damage.damage_type?.index }
        : null,
      twoHandedDamage: data.two_handed_damage
        ? { dice: data.two_handed_damage.damage_dice, type: data.two_handed_damage.damage_type?.index }
        : null,
      properties: (data.properties ?? []).map((p) => p.index),
      weaponRange: data.weapon_range ?? null,
      armorClass: data.armor_class ?? null,
    };
  }
  if (category === 'monsters') {
    return { cr: data.challenge_rating, type: data.type, hp: data.hit_points, ac: data.armor_class?.[0]?.value };
  }
  return undefined;
}
