import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { creatorArt, creatorArtFallback } from '../../lib/creatorArt.js';
import { srdCampaignPath } from '../../lib/srdCampaign.js';

export { creatorArt, creatorArtFallback } from '../../lib/creatorArt.js';

const CLASS_EMBLEMS = {
  barbarian: 'M12 3v18M12 5C7 2 3 6 3 11l7-2M12 5c5-3 9 1 9 6l-7-2',
  bard: 'M15 3v12a4 4 0 1 1-3-4V5l7-2v5',
  cleric: 'M12 3v18M5 9h14M9 3h6M9 21h6',
  druid: 'M5 20C3 7 8 3 20 4c0 12-5 17-15 16ZM5 20 16 8M10 15l-1-5M10 15l5 1',
  fighter: 'm12 3 3 4v9H9V7l3-4ZM6 16h12M12 16v5M9 21h6',
  monk: 'M7 10V5a1 1 0 0 1 2 0v5-7a1 1 0 0 1 2 0v7-6a1 1 0 0 1 2 0v6-4a1 1 0 0 1 2 0v7l2-2a1 1 0 0 1 2 2l-3 7H8l-4-7a1 1 0 0 1 2-1l1 1v-3',
  paladin: 'm12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3ZM12 7v9M8 11h8',
  ranger: 'M6 3c14 2 14 16 0 18l5-9L6 3ZM3 12h18m-3-3 3 3-3 3',
  rogue: 'm17 3 4 0 0 4-10 10-4-4L17 3ZM5 11l8 8M4 20l4-4',
  sorcerer: 'M13 3c1 6-6 7-3 12-4-1-3-3-3-3-6 9 12 12 11 1-1 2-2 3-3 3 3-7 0-10-2-13Z',
  warlock: 'M2 12c6-9 14-9 20 0-6 9-14 9-20 0ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3V1M12 23v-2',
  wizard: 'M3 5c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 1-2-1-5-2-9-1V5ZM12 7v14M6 9l3 1M6 13l3 1M15 10l3-1',
};

const RACE_EMBLEMS = {
  dragonborn: 'M4 19 7 9l3 3 2-9 4 7 5-2-2 8-7 5-8-2ZM10 16l3 1 3-3',
  dwarf: 'M5 8 8 3h8l3 5-1 10-6 4-6-4L5 8ZM6 13l6 4 6-4M9 8h1m4 0h1',
  elf: 'M5 20C5 11 8 6 19 3c-1 11-4 17-14 17ZM5 20 15 8M8 15h5',
  gnome: 'M4 10 12 2l8 8M5 12h5v4H5v-4Zm9 0h5v4h-5v-4ZM10 13h4M8 19l4 3 4-3',
  'half-elf': 'M5 20C3 11 8 5 12 3c4 2 9 8 7 17M12 3v18M6 10l6 4 6-4',
  'half-orc': 'M5 6 8 3l4 2 4-2 3 3v10l-7 6-7-6V6ZM7 13v5l3-3m7-2v5l-3-3M8 9h1m6 0h1',
  halfling: 'M12 21V9M12 14C3 16 3 7 4 5c6 0 8 3 8 9Zm0-3C12 4 17 3 21 3c0 6-3 9-9 8ZM8 21h8',
  human: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-4c0-6 16-6 16 0v4M8 18v3m8-3v3',
  tiefling: 'M7 8C3 7 3 3 5 2c-1 4 4 3 5 6m7 0c4-1 4-5 2-6 1 4-4 3-5 6M6 9h12v7l-6 6-6-6V9ZM9 13h1m4 0h1M10 18h4',
};

export function CreatorEmblem({ category, index, className = '' }) {
  const path = (category === 'classes' ? CLASS_EMBLEMS : RACE_EMBLEMS)[index]
    ?? 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z';
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={path} /></svg>;
}

export function EntryBadges({ entry }) {
  return <>
    {!entry.translated && <span className="rounded border border-bone/25 px-1 text-[9px] font-sans tracking-normal text-bone/60">EN</span>}
    {entry.custom && <span className="rounded border border-gold/30 px-1 text-[9px] font-sans tracking-normal text-gold">{entry.sharedFromDm ? 'Del DM' : 'Propia'}</span>}
  </>;
}

export function CreatorCard({ category, entry, selected, subtitle, tags = [], onSelect, onPreview }) {
  const showPreview = () => onPreview?.(entry.index);
  return (
    <button type="button" aria-pressed={selected} onClick={() => onSelect(entry.index)}
      onMouseEnter={showPreview} onMouseLeave={() => onPreview?.(null)} onFocus={showPreview} onBlur={() => onPreview?.(null)} onTouchStart={showPreview}
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-lg border text-left shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none ${selected ? 'border-gold bg-[#29332f] ring-1 ring-gold/30' : 'border-[#596d65]/40 bg-[#142427] hover:border-gold/70'}`}>
      <div className="relative h-36 w-full overflow-hidden sm:h-40">
        <img src={creatorArt(category, entry.index)} alt="" loading="lazy" decoding="async" width="640" height="800"
          onError={(event) => {
            const fallback = creatorArtFallback(category, entry.index);
            if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
          }}
          className="h-full w-full object-cover object-[center_28%] opacity-90 transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none" />
        <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#142427] to-transparent" />
        <span className="absolute left-3 top-3 flex size-8 items-center justify-center rounded-full border border-gold/50 bg-[#102124]/85 text-[#dec58f] shadow-lg"><CreatorEmblem category={category} index={entry.index} className="size-5" /></span>
        {selected && <span className="absolute right-2 top-3 rounded-full border border-gold/70 bg-[#182a29]/95 px-2 py-1 text-[10px] text-[#efdab0]">Elegida <span aria-hidden="true">✓</span></span>}
      </div>
      <div className="relative -mt-4 flex flex-1 flex-col gap-2 px-3 pb-3">
        <span className="flex flex-wrap items-center gap-1.5 font-display text-sm tracking-wide text-[#e6d5af] sm:text-base">{entry.name}<EntryBadges entry={entry} /></span>
        <span className="text-[12px] leading-snug text-bone/70">{subtitle}</span>
        <span className="mt-auto flex flex-wrap gap-x-2 gap-y-1 pt-1 text-[10px] tracking-wide text-[#b3c2af]">{tags.map((tag) => <span key={tag}>{tag}</span>)}</span>
      </div>
    </button>
  );
}

const entryCache = new Map();
const catalogCache = new Map();

/** Los nombres también pertenecen al compendio; EN señala el respaldo original. */
export function useCompendiumNames(category, campaignId) {
  const [catalog, setCatalog] = useState({});
  useEffect(() => {
    let cancelled = false;
    const path = srdCampaignPath(category, campaignId);
    if (!catalogCache.has(path)) catalogCache.set(path, api(path).then(({ results }) => Object.fromEntries(results.map((entry) => [entry.index, entry]))).catch((error) => { catalogCache.delete(path); throw error; }));
    catalogCache.get(path).then((entries) => { if (!cancelled) setCatalog(entries); }).catch(() => { if (!cancelled) setCatalog({}); });
    return () => { cancelled = true; };
  }, [category, campaignId]);
  return catalog;
}

export function CompendiumNames({ references, catalog }) {
  return <>{references.map((reference, index) => {
    const entry = catalog[reference.index] ?? { ...reference, translated: false };
    return <span key={reference.index}>{index > 0 && ' · '}<span>{entry.name}</span>{!entry.translated && <span className="ml-1 inline-block rounded border border-bone/20 px-1 align-middle text-[9px] text-bone/45">EN</span>}</span>;
  })}</>;
}

function readEntry(category, index, campaignId) {
  const path = srdCampaignPath(category, campaignId, index);
  if (!entryCache.has(path)) entryCache.set(path, api(path).catch((error) => { entryCache.delete(path); throw error; }));
  return entryCache.get(path);
}

/** La prosa se lee del compendio: no replicamos textos ni inventamos rasgos. */
export function CreatorFeatures({ category, index, detail, campaignId }) {
  const [content, setContent] = useState({ key: null, entries: [], error: '' });
  const key = `${category}:${index}:${campaignId ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    if (!index || !detail) return undefined;
    async function load() {
      if (index.startsWith('custom:')) {
        return (detail.custom_features ?? []).map((feature, i) => ({ index: `custom-${i}`, name: feature.name, translated: true, paragraphs: [feature.text].filter(Boolean) }));
      }
      let references = detail.traits ?? [];
      if (category === 'classes') {
        const { level } = await api(`/srd/classes/${encodeURIComponent(index)}/niveles?nivel=1`);
        references = level.features ?? [];
      }
      const entries = await Promise.all(references.map(async (reference) => {
        const entry = await readEntry(category === 'classes' ? 'features' : 'traits', reference.index, campaignId);
        const desc = entry.descEs || entry.data?.desc || [];
        return { ...entry, paragraphs: Array.isArray(desc) ? desc : [desc], options: [] };
      }));
      // Las variantes de un rasgo (los estilos de combate del guerrero) cuelgan
      // de su padre en el SRD: se agrupan bajo él en vez de listarse sueltas.
      const byIndex = new Map(entries.map((entry) => [entry.index, entry]));
      return entries.filter((entry) => {
        const parent = entry.data?.parent?.index && byIndex.get(entry.data.parent.index);
        if (!parent) return true;
        parent.options.push(entry);
        return false;
      });
    }
    load().then((entries) => { if (!cancelled) setContent({ key, entries, error: '' }); })
      .catch(() => { if (!cancelled) setContent({ key, entries: [], error: 'No se pudieron consultar los rasgos. El resto de tu elección se conserva.' }); });
    return () => { cancelled = true; };
  }, [category, index, detail, campaignId, key]);

  return <div className="min-w-0 border-t border-gold/15 pt-3">
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#b8c9b6]">{category === 'classes' ? 'Tu inicio · rasgos de nivel 1' : 'Rasgos de tu especie'}</h4>
    {content.key !== key ? <p className="text-xs text-bone/50">Consultando el compendio…</p> : content.error ? <p className="text-xs text-bone/60">{content.error}</p> : content.entries.length === 0 ? <p className="text-xs text-bone/60">No hay rasgos narrativos registrados para esta elección.</p> : <div className="space-y-1.5">{content.entries.map((entry) => <details key={entry.index} className="rounded-md border border-bone/10 bg-black/10 px-3 py-2 open:border-gold/25">
      <summary className="cursor-pointer text-sm text-bone/85 marker:text-gold"><span className="ml-1 mr-2">{entry.name}</span><EntryBadges entry={entry} /></summary>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-bone/65">{entry.paragraphs.map((text, i) => <p key={i}>{text}</p>)}</div>
      {entry.options?.length > 0 && <div className="mt-2 space-y-1.5 border-l border-gold/20 pl-3">
        <p className="text-[10px] uppercase tracking-[0.15em] text-bone/45">Opciones ({entry.options.length}) · se elige en la ficha</p>
        {entry.options.map((option) => <details key={option.index} className="text-sm">
          <summary className="cursor-pointer text-bone/75 marker:text-gold/60"><span className="ml-1 mr-2">{option.name.replace(/^.*?:\s*/, '')}</span><EntryBadges entry={option} /></summary>
          <div className="mt-1 space-y-1 text-xs leading-relaxed text-bone/60">{option.paragraphs.map((text, i) => <p key={i}>{text}</p>)}</div>
        </details>)}
      </div>}
    </details>)}</div>}
  </div>;
}

export function CreatorDetail({ category, entry, children }) {
  return <section aria-label={`Detalle de ${entry.name}`} className="overflow-hidden rounded-lg border border-gold/30 bg-gradient-to-br from-[#233430] to-[#16272a] shadow-xl">
    <div className="flex items-center gap-3 border-b border-gold/15 px-4 py-3">
      <CreatorEmblem category={category} index={entry.index} className="size-8 shrink-0 text-gold" />
      <div><p className="text-[9px] uppercase tracking-[0.24em] text-[#b2c3ae]">Tu elección</p><h3 className="font-display text-lg text-[#e7d5ac]">{entry.name}</h3></div>
    </div>
    <div className="space-y-4 p-4">{children}</div>
  </section>;
}
