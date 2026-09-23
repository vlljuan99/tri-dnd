export const CLASS_ART_INDICES = Object.freeze([
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
]);

export const SPECIES_ART_INDICES = Object.freeze([
  'dragonborn',
  'dwarf',
  'elf',
  'gnome',
  'half-elf',
  'half-orc',
  'halfling',
  'human',
  'tiefling',
]);

export const UNFORGED_PREVIEW_ART = '/creador/preview-sin-forjar-gen.webp';

const CLASS_ART_INDEX_SET = new Set(CLASS_ART_INDICES);
const SPECIES_ART_INDEX_SET = new Set(SPECIES_ART_INDICES);

function artConfig(category) {
  if (category === 'classes') {
    return {
      indices: CLASS_ART_INDEX_SET,
      prefix: 'clase',
      custom: '/creador/clase-personalizada-gen.webp',
    };
  }
  return {
    indices: SPECIES_ART_INDEX_SET,
    prefix: 'especie',
    custom: '/creador/especie-personalizada-gen.webp',
  };
}

/** Devuelve arte local y versionado; una entrada del DM usa su retrato genérico. */
export function creatorArt(category, index) {
  const { indices, prefix, custom } = artConfig(category);
  return indices.has(index) ? `/creador/${prefix}-${index}-gen.webp` : custom;
}

/** Los SVG garantizan que una imagen dañada nunca rompa la selección. */
export function creatorArtFallback(category, index) {
  const { indices, prefix } = artConfig(category);
  return indices.has(index) ? `/creador/${prefix}-${index}.svg` : '/creador/personalizado.svg';
}
