// El tirador flotante solo pertenece a pantallas donde se juega de verdad.
// Mantener esta lista positiva evita que reaparezca por accidente en nuevos
// pasos de preparación, archivos o editores.
export function isDiceContext(pathname) {
  const segments = String(pathname ?? '')
    .split('/')
    .filter(Boolean);

  return (
    (segments[0] === 'campanas' && segments.length === 2) ||
    (segments[0] === 'personajes' && segments.length === 2)
  );
}

// La entrada a una campaña nunca usa el campamento como antesala. Si el
// mundo tiene un tablero para la ubicación actual, se abre; en caso contrario
// se muestra el mapa de mundo para que el usuario decida adónde ir.
export function initialCampaignScreen({ hasWorldMap, currentLocationId, currentLocation }) {
  if (!hasWorldMap) return 'board';
  if (!currentLocationId || currentLocation?.targetMapId) return 'world';
  return currentLocation?.mapId ? 'board' : 'world';
}
