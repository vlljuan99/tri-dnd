// Catálogo completo de recursos que publica la API SRD 2014. Esta lista es la
// única fuente de verdad del servidor: la usan tanto la sincronización como
// las rutas de lectura para que una categoría descargada nunca quede oculta.
export const SRD_CATEGORIES = Object.freeze([
  { key: 'ability-scores', label: 'Características' },
  { key: 'alignments', label: 'Alineamientos' },
  { key: 'backgrounds', label: 'Trasfondos' },
  { key: 'classes', label: 'Clases' },
  { key: 'conditions', label: 'Condiciones' },
  { key: 'damage-types', label: 'Tipos de daño' },
  { key: 'equipment', label: 'Equipo' },
  { key: 'equipment-categories', label: 'Categorías de equipo' },
  { key: 'feats', label: 'Dotes' },
  { key: 'features', label: 'Rasgos de clase' },
  { key: 'languages', label: 'Idiomas' },
  { key: 'magic-items', label: 'Objetos mágicos' },
  { key: 'magic-schools', label: 'Escuelas de magia' },
  { key: 'monsters', label: 'Monstruos' },
  { key: 'proficiencies', label: 'Competencias' },
  { key: 'races', label: 'Razas' },
  { key: 'rule-sections', label: 'Secciones de reglas' },
  { key: 'rules', label: 'Reglas' },
  { key: 'skills', label: 'Habilidades' },
  { key: 'spells', label: 'Hechizos' },
  { key: 'subclasses', label: 'Subclases' },
  { key: 'subraces', label: 'Subrazas' },
  { key: 'traits', label: 'Rasgos raciales' },
  { key: 'weapon-properties', label: 'Propiedades de armas' },
]);

export const SRD_CATEGORY_KEYS = Object.freeze(SRD_CATEGORIES.map(({ key }) => key));

function referenceIndex(reference) {
  return reference?.index ?? null;
}

function referenceIndexes(references) {
  return Array.isArray(references) ? references.map(referenceIndex).filter(Boolean) : [];
}

function armorClassValue(armorClass) {
  if (Number.isFinite(armorClass)) return armorClass;
  if (!Array.isArray(armorClass)) return null;
  return armorClass.find((entry) => Number.isFinite(entry?.value))?.value ?? null;
}

// Resumen mínimo por categoría del SRD para pintar listados sin descargar el
// detalle. También se reutiliza con el contenido propio del DM (Fase 15), que
// guarda `data` con la misma forma que el SRD.
export function buildMeta(category, data = {}) {
  switch (category) {
    case 'ability-scores':
      return { fullName: data.full_name ?? null, skills: referenceIndexes(data.skills) };
    case 'alignments':
      return { abbreviation: data.abbreviation ?? null };
    case 'backgrounds':
      return {
        feature: data.feature?.name ?? null,
        proficiencies: referenceIndexes(data.starting_proficiencies),
      };
    case 'classes':
      return {
        hitDie: data.hit_die ?? null,
        savingThrows: referenceIndexes(data.saving_throws),
        spellcaster: Boolean(data.spellcasting),
      };
    case 'equipment':
      return {
        equipmentCategory: referenceIndex(data.equipment_category),
        gearCategory: referenceIndex(data.gear_category),
        damage: data.damage
          ? { dice: data.damage.damage_dice, type: referenceIndex(data.damage.damage_type) }
          : null,
        twoHandedDamage: data.two_handed_damage
          ? { dice: data.two_handed_damage.damage_dice, type: referenceIndex(data.two_handed_damage.damage_type) }
          : null,
        properties: referenceIndexes(data.properties),
        weaponRange: data.weapon_range ?? null,
        armorClass: data.armor_class ?? null,
        cost: data.cost ?? null,
        weight: data.weight ?? null,
      };
    case 'equipment-categories':
      return { entries: Array.isArray(data.equipment) ? data.equipment.length : 0 };
    case 'feats':
      return { prerequisites: Array.isArray(data.prerequisites) ? data.prerequisites.length : 0 };
    case 'features':
      return {
        level: data.level ?? null,
        class: referenceIndex(data.class),
        subclass: referenceIndex(data.subclass),
      };
    case 'languages':
      return { type: data.type ?? null, script: data.script ?? null };
    case 'magic-items':
      return {
        equipmentCategory: referenceIndex(data.equipment_category),
        rarity: data.rarity?.name ?? null,
      };
    case 'monsters':
      return {
        cr: data.challenge_rating ?? null,
        type: data.type ?? null,
        hp: data.hit_points ?? null,
        ac: armorClassValue(data.armor_class),
        size: data.size ?? null,
      };
    case 'proficiencies':
      return { type: data.type ?? null, reference: referenceIndex(data.reference) };
    case 'races':
      return { speed: data.speed ?? null, size: data.size ?? null };
    case 'rules':
      return { sections: referenceIndexes(data.subsections) };
    case 'skills':
      return { abilityScore: referenceIndex(data.ability_score) };
    case 'spells':
      return {
        level: data.level ?? null,
        school: referenceIndex(data.school),
        concentration: Boolean(data.concentration),
        ritual: Boolean(data.ritual),
        attackType: data.attack_type ?? null,
        hasDamage: Boolean(data.damage),
        dc: referenceIndex(data.dc?.dc_type),
        classes: referenceIndexes(data.classes),
      };
    case 'subclasses':
      return { class: referenceIndex(data.class), flavor: data.subclass_flavor ?? null };
    case 'subraces':
      return { race: referenceIndex(data.race) };
    case 'traits':
      return { races: referenceIndexes(data.races), subraces: referenceIndexes(data.subraces) };
    default:
      return {};
  }
}
