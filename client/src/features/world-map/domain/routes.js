// Reglas de lectura de rutas compartidas por la mesa y el editor. La autoridad
// sigue siendo el servidor; aquí solo se decide qué affordance dibujar.

export function routeAllowsTravel(route, fromLocationId, toLocationId) {
  const from = Number(fromLocationId);
  const to = Number(toLocationId);
  const forward = Number(route.fromLocationId) === from && Number(route.toLocationId) === to;
  if (forward) return true;
  if (route.oneWay) return false;
  return Number(route.fromLocationId) === to && Number(route.toLocationId) === from;
}

export function findTravelRoute(routes, fromLocationId, toLocationId) {
  if (fromLocationId == null || toLocationId == null) return null;
  return (routes ?? []).find((route) => routeAllowsTravel(route, fromLocationId, toLocationId)) ?? null;
}

export function routeGeometry(route, locations) {
  const from = (locations ?? []).find((location) => location.id === route.fromLocationId);
  const to = (locations ?? []).find((location) => location.id === route.toLocationId);
  if (!from || !to) return null;
  return {
    from,
    to,
    midX: (from.x + to.x) / 2,
    midY: (from.y + to.y) / 2,
  };
}
