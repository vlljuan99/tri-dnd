// Convierte una entrada elegida en el selector de equipo en el mismo formato
// de botín que ya usan los marcadores saqueables. Así el objeto colocado no
// es solo una etiqueta: conserva su referencia SRD/propia y puede pasar al
// inventario de un personaje sin introducir otro formato persistido.
export function buildObjectMarkerLoot(entry, id) {
  if (!entry || typeof entry.index !== 'string' || !entry.index || typeof entry.name !== 'string') {
    return undefined;
  }

  return [
    {
      id:
        id ??
        (globalThis.crypto?.randomUUID?.() ?? `objeto-${Date.now()}-${Math.random()}`),
      name: entry.name.trim().slice(0, 80) || 'Objeto',
      source: entry.custom ? 'custom' : 'srd',
      index: entry.index,
      qty: 1,
      chance: 100,
    },
  ];
}

