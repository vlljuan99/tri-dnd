// Tipos de ubicación del mapa de mundo (v34) y su glifo para el pin. El tipo
// es sobre todo semántico: 'ciudad' es el único que salta a un submapa
// (target_world_map_id); el resto pueden enlazar un tablero táctico (map_id).
export const LOCATION_KINDS = [
  { value: 'dungeon', label: 'Dungeon / tablero', glyph: '⚔' },
  { value: 'ciudad', label: 'Ciudad (submapa)', glyph: '🏰' },
  { value: 'campamento', label: 'Campamento', glyph: '⛺' },
  { value: 'evento', label: 'Evento de camino', glyph: '❗' },
];

export function kindGlyph(kind) {
  return LOCATION_KINDS.find((k) => k.value === kind)?.glyph ?? '⚔';
}

export function kindLabel(kind) {
  return LOCATION_KINDS.find((k) => k.value === kind)?.label ?? 'Dungeon / tablero';
}
