import { archiveIconLabel, resolveArchiveIcon } from '../lib/archiveIcons.js';

export default function ArchiveIcon({ icon, node, className = 'h-4 w-4', decorative = true }) {
  const kind = icon || resolveArchiveIcon(node);
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': decorative ? true : undefined,
    'aria-label': decorative ? undefined : archiveIconLabel(kind),
    role: decorative ? undefined : 'img',
  };

  if (kind === 'book') return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22z" /></svg>;
  if (kind === 'users') return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20c.4-4 2.4-6 6-6s5.6 2 6 6" /><path d="M16 5.5a3 3 0 0 1 0 5.5M17 14c2.5.5 3.8 2.5 4 5" /></svg>;
  if (kind === 'flag') return <svg {...common}><path d="M5 22V3" /><path d="M5 4h12l-2 4 2 4H5" /></svg>;
  if (kind === 'pin') return <svg {...common}><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (kind === 'scroll') return <svg {...common}><path d="M6 3h12a3 3 0 0 0-3 3v13a2 2 0 0 1-2 2H6a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>;
  if (kind === 'document') return <svg {...common}><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></svg>;
  if (kind === 'map') return <svg {...common}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></svg>;
  if (kind === 'castle') return <svg {...common}><path d="M4 22V9h16v13M4 9V3h4v4h3V3h3v4h3V3h3v6" /><path d="M9 22v-5a3 3 0 0 1 6 0v5" /></svg>;
  if (kind === 'crown') return <svg {...common}><path d="m3 7 4 4 5-7 5 7 4-4-2 11H5z" /><path d="M5 21h14" /></svg>;
  if (kind === 'shield') return <svg {...common}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="M12 7v10M8 11h8" /></svg>;
  if (kind === 'sword') return <svg {...common}><path d="m14 4 6-2-2 6L9 17l-3-3z" /><path d="m5 13-2 2 6 6 2-2M12 14l3 3" /></svg>;
  if (kind === 'skull') return <svg {...common}><path d="M5 11a7 7 0 1 1 14 0c0 3-1.5 4-3 5v4H8v-4c-1.5-1-3-2-3-5z" /><circle cx="9" cy="11" r="1.5" /><circle cx="15" cy="11" r="1.5" /><path d="M12 14v2M10 20v2M14 20v2" /></svg>;
  if (kind === 'gem') return <svg {...common}><path d="m3 9 4-6h10l4 6-9 12z" /><path d="m3 9 9 3 9-3M7 3l5 9 5-9" /></svg>;
  if (kind === 'potion') return <svg {...common}><path d="M9 2h6M10 2v6l-5 8a4 4 0 0 0 3.5 6h7a4 4 0 0 0 3.5-6l-5-8V2" /><path d="M7 15h10" /></svg>;
  if (kind === 'sparkles') return <svg {...common}><path d="m12 2 1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7zM5 2v4M3 4h4" /></svg>;
  return <svg {...common}><path d="M3 6h7l2 2h9v11H3z" /></svg>;
}
