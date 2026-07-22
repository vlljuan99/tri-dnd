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

// --- Texto de búsqueda para el índice FTS -----------------------------------
// El buscador transversal antes solo miraba unas pocas ramas concretas del
// JSON (`$.desc`, `$.higher_level`…). Para que el compendio sea de verdad
// buscable, se aplana TODO el texto descriptivo de la entrada: rasgos y
// acciones de monstruos, prosa de rasgos de clase, efectos de condiciones,
// secciones de reglas, nombres de referencias (clase, escuela, tipo de daño)…
// El `data` del SRD está en inglés; los nombres/descripciones en español viven
// en name_es/desc_es y se añaden aparte, así que el índice cubre ambos idiomas.

// Claves cuyo valor nunca es prosa útil (rutas de la API, imágenes): se saltan
// para no ensuciar el índice con URLs ni fragmentos de ruta.
const SEARCH_SKIP_KEYS = new Set(['url', 'image', 'icon']);

function collectSearchStrings(value, out) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text && !text.startsWith('/api/') && !/^https?:\/\//.test(text)) out.add(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchStrings(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SEARCH_SKIP_KEYS.has(key) || key.endsWith('_url')) continue;
      collectSearchStrings(child, out);
    }
  }
}

export function collectReferenceIndexes(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceIndexes(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    if (typeof value.index === 'string' && value.index) out.add(value.index);
    for (const child of Object.values(value)) collectReferenceIndexes(child, out);
  }
  return out;
}

// Blob de texto de una entrada para el índice FTS. Reúne los nombres español e
// inglés, la descripción traducida y todo el texto libre del `data`.
export function buildSearchText(
  data = {},
  { nameEs = null, nameEn = null, descEs = null, relatedNames = [] } = {}
) {
  const strings = new Set();
  if (nameEs) strings.add(nameEs);
  if (nameEn) strings.add(nameEn);
  if (descEs) strings.add(descEs);
  for (const name of relatedNames) if (name) strings.add(name);
  collectSearchStrings(data, strings);
  return [...strings].join('\n');
}

// Primeras líneas de la descripción para la tarjeta suelta del chat: prioriza
// el español traducido y cae al inglés del SRD si aún no hay traducción.
export function buildSnippet(data = {}, descEs = null, limit = 240) {
  const source = descEs
    ?? (Array.isArray(data.desc) ? data.desc.filter(Boolean).join(' ') : data.desc)
    ?? '';
  const text = String(source).replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

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
        range: data.range ?? null,
        throwRange: data.throw_range ?? null,
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
        range: data.range ?? null,
        area: data.area ?? data.area_of_effect ?? null,
        castingTime: data.casting_time ?? null,
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
