export function buildMapCreationHref({ campaignId, locationId, name }) {
  const params = new URLSearchParams({
    nuevo: '1',
    nombre: name?.trim() || 'Nuevo tablero',
    ubicacion: String(locationId),
    volver: 'mundo',
  });
  return `/campanas/${campaignId}/editor?${params.toString()}`;
}

export function readMapCreationIntent(searchParams) {
  return {
    requestedMapId: Number(searchParams.get('mapa')) || null,
    createMapIntent: searchParams.get('nuevo') === '1',
    requestedMapName: searchParams.get('nombre')?.trim().slice(0, 80) || 'Nuevo tablero',
    requestedLocationId: Number(searchParams.get('ubicacion')) || null,
    returnToWorld: searchParams.get('volver') === 'mundo',
  };
}
