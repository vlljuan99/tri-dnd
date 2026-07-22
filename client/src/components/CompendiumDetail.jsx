import { MonsterStatsContent } from './MonsterStatBlock.jsx';
import { createPortal } from 'react-dom';

export const COMPENDIUM_CATEGORY_GROUPS = [
  {
    label: 'Criaturas, magia y equipo',
    categories: [
      ['monsters', 'Monstruos'],
      ['spells', 'Hechizos'],
      ['magic-items', 'Objetos mágicos'],
      ['equipment', 'Equipo'],
      ['equipment-categories', 'Categorías de equipo'],
      ['conditions', 'Condiciones'],
      ['damage-types', 'Tipos de daño'],
      ['weapon-properties', 'Propiedades de armas'],
    ],
  },
  {
    label: 'Creación de personajes',
    categories: [
      ['backgrounds', 'Trasfondos'],
      ['classes', 'Clases'],
      ['subclasses', 'Subclases'],
      ['features', 'Rasgos de clase'],
      ['races', 'Razas'],
      ['subraces', 'Subrazas'],
      ['traits', 'Rasgos raciales'],
      ['feats', 'Dotes'],
      ['ability-scores', 'Características'],
      ['skills', 'Habilidades'],
      ['proficiencies', 'Competencias'],
      ['languages', 'Idiomas'],
    ],
  },
  {
    label: 'Reglas y referencias',
    categories: [
      ['alignments', 'Alineamientos'],
      ['magic-schools', 'Escuelas de magia'],
      ['rules', 'Reglas'],
      ['rule-sections', 'Secciones de reglas'],
    ],
  },
];

export const COMPENDIUM_CATEGORIES = COMPENDIUM_CATEGORY_GROUPS.flatMap(({ categories }) => categories);
export const COMPENDIUM_LABELS = Object.fromEntries(COMPENDIUM_CATEGORIES);

const CURRENCY_LABELS = { cp: 'pc', sp: 'pp', ep: 'pe', gp: 'po', pp: 'ppt' };

export function readableCompendiumIndex(value) {
  return typeof value === 'string' ? value.replaceAll('-', ' ') : value;
}

function referenceName(reference) {
  return reference?.name ?? readableCompendiumIndex(reference?.index) ?? null;
}

function referenceNames(references) {
  if (!Array.isArray(references)) return '';
  return references.map(referenceName).filter(Boolean).join(', ');
}

function textValue(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).join('\n\n');
  return typeof value === 'string' ? value.trim() : '';
}

function formatCost(cost) {
  if (!cost || cost.quantity == null) return null;
  return `${cost.quantity} ${CURRENCY_LABELS[cost.unit] ?? cost.unit ?? ''}`.trim();
}

function formatArmorClass(armorClass) {
  if (!armorClass) return null;
  if (Number.isFinite(armorClass)) return String(armorClass);
  if (Number.isFinite(armorClass.base)) {
    return `${armorClass.base}${armorClass.dex_bonus ? ' + DES' : ''}`;
  }
  return null;
}

function formatMonsterArmorClass(armorClass) {
  if (Number.isFinite(armorClass)) return String(armorClass);
  if (!Array.isArray(armorClass)) return null;
  return armorClass
    .filter((item) => Number.isFinite(item?.value))
    .map((item) => `${item.value}${item.type ? ` (${readableCompendiumIndex(item.type)})` : ''}`)
    .join(', ');
}

function formatComponents(data) {
  if (!Array.isArray(data.components)) return null;
  const components = data.components.join(', ');
  return data.material ? `${components} — ${data.material}` : components;
}

function buildFacts(category, data) {
  let facts = [];
  switch (category) {
    case 'ability-scores':
      facts = [['Nombre completo', data.full_name]];
      break;
    case 'alignments':
      facts = [['Abreviatura', data.abbreviation]];
      break;
    case 'backgrounds':
      facts = [
        ['Rasgo', data.feature?.name],
        ['Competencias iniciales', referenceNames(data.starting_proficiencies)],
      ];
      break;
    case 'classes':
      facts = [
        ['Dado de golpe', data.hit_die ? `d${data.hit_die}` : null],
        ['Salvaciones', referenceNames(data.saving_throws)],
        ['Conjuración', data.spellcasting ? 'Sí' : 'No'],
      ];
      break;
    case 'equipment':
      facts = [
        ['Categoría', referenceName(data.equipment_category)],
        ['Tipo', referenceName(data.gear_category) ?? data.weapon_category ?? data.armor_category],
        ['Coste', formatCost(data.cost)],
        ['Peso', data.weight != null ? `${data.weight} lb` : null],
        ['Daño', data.damage?.damage_dice ? `${data.damage.damage_dice} ${referenceName(data.damage.damage_type) ?? ''}`.trim() : null],
        ['Daño a dos manos', data.two_handed_damage?.damage_dice],
        ['Alcance', data.weapon_range],
        ['Clase de armadura', formatArmorClass(data.armor_class)],
      ];
      break;
    case 'equipment-categories':
      facts = [['Entradas incluidas', Array.isArray(data.equipment) ? data.equipment.length : null]];
      break;
    case 'features':
      facts = [
        ['Nivel', data.level],
        ['Clase', referenceName(data.class)],
        ['Subclase', referenceName(data.subclass)],
      ];
      break;
    case 'languages':
      facts = [
        ['Tipo', data.type],
        ['Escritura', data.script],
        ['Hablantes habituales', Array.isArray(data.typical_speakers) ? data.typical_speakers.join(', ') : null],
      ];
      break;
    case 'magic-items':
      facts = [
        ['Categoría', referenceName(data.equipment_category)],
        ['Rareza', data.rarity?.name],
        ['Variante', typeof data.variant === 'boolean' ? (data.variant ? 'Sí' : 'No') : null],
      ];
      break;
    case 'monsters':
      facts = [
        ['Tamaño y tipo', [data.size, data.type, data.subtype].filter(Boolean).join(' · ')],
        ['Alineamiento', data.alignment],
        ['Desafío', data.challenge_rating != null ? `${data.challenge_rating} (${data.xp ?? 0} PX)` : null],
        ['Clase de armadura', formatMonsterArmorClass(data.armor_class)],
        ['Idiomas', data.languages],
      ];
      break;
    case 'proficiencies':
      facts = [
        ['Tipo', data.type],
        ['Referencia', referenceName(data.reference)],
      ];
      break;
    case 'races':
      facts = [
        ['Velocidad', data.speed != null ? `${data.speed} pies` : null],
        ['Tamaño', data.size],
        ['Idiomas', referenceNames(data.languages)],
      ];
      break;
    case 'rules':
      facts = [['Secciones', Array.isArray(data.subsections) ? data.subsections.length : null]];
      break;
    case 'skills':
      facts = [['Característica', referenceName(data.ability_score)]];
      break;
    case 'spells':
      facts = [
        ['Nivel', data.level === 0 ? 'Truco' : data.level],
        ['Escuela', referenceName(data.school)],
        ['Tiempo de lanzamiento', data.casting_time],
        ['Alcance', data.range],
        ['Componentes', formatComponents(data)],
        ['Duración', `${data.concentration ? 'Concentración, ' : ''}${data.duration ?? ''}`.trim()],
        ['Ritual', typeof data.ritual === 'boolean' ? (data.ritual ? 'Sí' : 'No') : null],
        ['Clases', referenceNames(data.classes)],
      ];
      break;
    case 'subclasses':
      facts = [
        ['Clase', referenceName(data.class)],
        ['Tradición', data.subclass_flavor],
      ];
      break;
    case 'subraces':
      facts = [['Raza', referenceName(data.race)]];
      break;
    case 'traits':
      facts = [
        ['Razas', referenceNames(data.races)],
        ['Subrazas', referenceNames(data.subraces)],
      ];
      break;
    default:
      break;
  }
  return facts.filter(([, value]) => value !== null && value !== undefined && value !== '');
}

function buildDescriptionSections(entry) {
  const data = entry.data ?? {};
  const sections = [];
  const add = (title, value) => {
    const body = textValue(value);
    if (body) sections.push({ title, body });
  };

  add('Descripción', entry.descEs || data.desc);
  if (entry.category === 'spells') add('A niveles superiores', data.higher_level);
  if (entry.category === 'backgrounds') add(`Rasgo${data.feature?.name ? `: ${data.feature.name}` : ''}`, data.feature?.desc);
  if (entry.category === 'equipment') add('Información especial', data.special);
  if (entry.category === 'races') {
    add('Edad', data.age);
    add('Alineamiento', data.alignment);
    add('Tamaño', data.size_description);
    add('Idiomas', data.language_desc);
  }
  for (const info of data.spellcasting?.info ?? []) add(info.name || 'Conjuración', info.desc);
  return sections;
}

function formatCollectionItem(item) {
  if (item?.equipment) {
    return `${referenceName(item.equipment)}${item.quantity != null ? ` × ${item.quantity}` : ''}`;
  }
  return referenceName(item) ?? (typeof item === 'string' ? item : null);
}

function buildCollections(category, data) {
  const definitions = [];
  const add = (title, values) => {
    if (!Array.isArray(values)) return;
    const items = values.map(formatCollectionItem).filter(Boolean);
    if (items.length) definitions.push({ title, items });
  };

  if (category === 'ability-scores') add('Habilidades relacionadas', data.skills);
  if (category === 'backgrounds') add('Equipo inicial', data.starting_equipment);
  if (category === 'classes') {
    add('Competencias', data.proficiencies);
    add('Equipo inicial', data.starting_equipment);
    add('Subclases', data.subclasses);
  }
  if (category === 'equipment') add('Propiedades', data.properties);
  if (category === 'equipment-categories') add('Contenido', data.equipment);
  if (category === 'magic-items') add('Variantes', data.variants);
  if (category === 'proficiencies') {
    add('Clases', data.classes);
    add('Razas', data.races);
  }
  if (category === 'races') {
    add('Competencias iniciales', data.starting_proficiencies);
    add('Rasgos', data.traits);
    add('Subrazas', data.subraces);
  }
  if (category === 'rules') add('Secciones', data.subsections);
  if (category === 'subraces') {
    add('Competencias iniciales', data.starting_proficiencies);
    add('Idiomas', data.languages);
    add('Rasgos raciales', data.racial_traits);
  }
  return definitions;
}

export function CompendiumMeta({ entry }) {
  const meta = entry.meta ?? {};
  switch (entry.category) {
    case 'spells':
      return <>{meta.level === 0 ? 'Truco' : `Nivel ${meta.level ?? '—'}`}{meta.concentration ? ' · concentración' : ''}</>;
    case 'monsters':
      return <>VD {meta.cr ?? '—'} · {meta.hp ?? '—'} PG · CA {meta.ac ?? '—'}</>;
    case 'equipment':
      return <>{readableCompendiumIndex(meta.gearCategory ?? meta.equipmentCategory) || 'Equipo'}</>;
    case 'equipment-categories':
      return <>{meta.entries ?? 0} entradas</>;
    case 'magic-items':
      return <>{meta.rarity || 'Objeto mágico'}</>;
    case 'classes':
      return <>d{meta.hitDie ?? '—'}{meta.spellcaster ? ' · conjuros' : ''}</>;
    case 'features':
      return <>Nivel {meta.level ?? '—'}{meta.class ? ` · ${readableCompendiumIndex(meta.class)}` : ''}</>;
    case 'languages':
      return <>{meta.type || 'Idioma'}{meta.script ? ` · ${meta.script}` : ''}</>;
    case 'proficiencies':
      return <>{meta.type || 'Competencia'}</>;
    case 'races':
      return <>{meta.size || 'Raza'}{meta.speed != null ? ` · ${meta.speed} pies` : ''}</>;
    case 'skills':
      return <>{meta.abilityScore ? `Característica: ${readableCompendiumIndex(meta.abilityScore)}` : 'Habilidad'}</>;
    case 'subclasses':
      return <>{meta.class ? `Clase: ${readableCompendiumIndex(meta.class)}` : 'Subclase'}</>;
    case 'subraces':
      return <>{meta.race ? `Raza: ${readableCompendiumIndex(meta.race)}` : 'Subraza'}</>;
    case 'feats':
      return <>{meta.prerequisites ? `${meta.prerequisites} prerrequisitos` : 'Dote'}</>;
    case 'rules':
      return <>{meta.sections?.length ?? 0} secciones</>;
    default:
      return <>{COMPENDIUM_LABELS[entry.category] ?? 'Referencia'}</>;
  }
}

function MonsterExtraActions({ title, actions }) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  return (
    <section className="mt-4 space-y-2">
      <h3 className="font-display text-sm uppercase tracking-widest text-gold/70">{title}</h3>
      {actions.map((action, index) => (
        <div key={`${action.name}-${index}`} className="rounded-sm border border-bone/10 bg-night-950/50 p-2">
          <p className="font-medium text-bone">{action.name}</p>
          {action.desc && <p className="mt-1 whitespace-pre-line text-xs text-bone/60">{action.desc}</p>}
        </div>
      ))}
    </section>
  );
}

export default function CompendiumDetail({ entry, onClose, actions = null }) {
  const data = entry.data ?? {};
  const facts = buildFacts(entry.category, data);
  const sections = buildDescriptionSections(entry);
  const collections = buildCollections(entry.category, data);
  const hasMonsterData = entry.category === 'monsters' && Number.isFinite(data.strength);
  const hasContent = facts.length || sections.length || collections.length || hasMonsterData;

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
      <article
        role="dialog"
        aria-modal="true"
        aria-labelledby="compendium-detail-title"
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-t-lg border border-ink/20 bg-parchment-100 p-5 text-ink shadow-2xl sm:rounded-lg sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xs uppercase tracking-widest text-ember">{COMPENDIUM_LABELS[entry.category]}</p>
            <h2 id="compendium-detail-title" className="font-display text-2xl font-bold">{entry.name}</h2>
            {entry.nameEn && entry.nameEn !== entry.name && <p className="text-sm italic text-ink/55">{entry.nameEn}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar detalle" className="rounded px-2 text-2xl text-ink/60 hover:bg-ink/5">×</button>
        </div>

        <p className="mt-3 text-sm font-semibold text-ink/65"><CompendiumMeta entry={entry} /></p>
        {actions && <div className="mt-4">{actions}</div>}

        {facts.length > 0 && (
          <dl className="mt-5 grid gap-2 sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-sm border border-ink/10 bg-parchment-50/70 px-3 py-2">
                <dt className="text-xs uppercase tracking-wide text-ink/45">{label}</dt>
                <dd className="mt-0.5 text-sm text-ink/85">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {sections.map(({ title, body }) => (
          <section key={`${title}-${body.slice(0, 24)}`} className="mt-5">
            <h3 className="font-display text-sm uppercase tracking-widest text-ember/80">{title}</h3>
            <div className="mt-2 whitespace-pre-line leading-relaxed text-ink/85">{body}</div>
          </section>
        ))}

        {collections.map(({ title, items }) => (
          <section key={title} className="mt-5">
            <h3 className="font-display text-sm uppercase tracking-widest text-ember/80">{title}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {items.map((item, index) => (
                <li key={`${item}-${index}`} className="rounded-full border border-ink/15 bg-parchment-50 px-3 py-1 text-sm text-ink/75">{item}</li>
              ))}
            </ul>
          </section>
        ))}

        {hasMonsterData && (
          <div className="mt-5 rounded-lg bg-night-900 p-4 text-bone">
            <MonsterStatsContent data={data} monsterName={entry.name} />
            <MonsterExtraActions title="Reacciones" actions={data.reactions} />
            <MonsterExtraActions title="Acciones legendarias" actions={data.legendary_actions} />
          </div>
        )}

        {!hasContent && <p className="mt-5 italic text-ink/50">Esta entrada no incluye información adicional.</p>}
      </article>
    </div>
  ), document.body);
}
