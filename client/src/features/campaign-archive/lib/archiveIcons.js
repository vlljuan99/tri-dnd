export const ARCHIVE_ICONS = [
  { id: 'folder', label: 'Carpeta' },
  { id: 'book', label: 'Libro' },
  { id: 'scroll', label: 'Pergamino' },
  { id: 'document', label: 'Documento' },
  { id: 'users', label: 'Personajes' },
  { id: 'flag', label: 'Facción' },
  { id: 'pin', label: 'Ubicación' },
  { id: 'map', label: 'Mapa' },
  { id: 'castle', label: 'Fortaleza' },
  { id: 'crown', label: 'Corona' },
  { id: 'shield', label: 'Escudo' },
  { id: 'sword', label: 'Arma' },
  { id: 'skull', label: 'Peligro' },
  { id: 'gem', label: 'Tesoro' },
  { id: 'potion', label: 'Poción' },
  { id: 'sparkles', label: 'Magia' },
];

export const ARCHIVE_ICON_IDS = new Set(ARCHIVE_ICONS.map((icon) => icon.id));

function normalizedTitle(title) {
  return String(title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function inferArchiveIcon(kind, title) {
  const clean = normalizedTitle(title);
  if (/lore|historia|cronica|leyenda/.test(clean)) return 'book';
  if (/personaje|p[jn]j|reparto|npc|aliado/.test(clean)) return 'users';
  if (/faccion|gremio|bando|organizacion|culto/.test(clean)) return 'flag';
  if (/mapa|mundo|continente/.test(clean)) return 'map';
  if (/lugar|region|ciudad|pueblo|aldea|ubicacion/.test(clean)) return 'pin';
  if (/trama|sesion|aventura|mision|capitulo/.test(clean)) return 'scroll';
  if (/reino|castillo|fortaleza|torre/.test(clean)) return 'castle';
  if (/rey|reina|corona|noble/.test(clean)) return 'crown';
  if (/guerra|combate|arma|espada/.test(clean)) return 'sword';
  if (/enemigo|monstruo|muerte|peligro/.test(clean)) return 'skull';
  if (/tesoro|objeto|reliquia|gema/.test(clean)) return 'gem';
  if (/magia|hechizo|arcano/.test(clean)) return 'sparkles';
  return kind === 'seccion' ? 'folder' : 'document';
}

export function resolveArchiveIcon(node) {
  if (ARCHIVE_ICON_IDS.has(node?.icon)) return node.icon;
  return inferArchiveIcon(node?.kind ?? node?.type, node?.title);
}

export function archiveIconLabel(iconId) {
  return ARCHIVE_ICONS.find((icon) => icon.id === iconId)?.label ?? 'Documento';
}
