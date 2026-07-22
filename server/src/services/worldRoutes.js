// Reglas de dominio de las rutas del mapa de mundo. Se mantienen fuera del
// router para que dirección, coste y selección de arista se prueben sin HTTP.

export const MAX_ROUTE_COST = 3650;

export function normalizeRouteCost(value) {
  const cost = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(cost) && cost >= 1 && cost <= MAX_ROUTE_COST ? cost : null;
}

export function cleanRouteLabel(value) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 120);
}

export function routeAllowsTravel(route, fromLocationId, toLocationId) {
  const from = Number(fromLocationId);
  const to = Number(toLocationId);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;

  const forward = Number(route.from_location_id ?? route.fromLocationId) === from
    && Number(route.to_location_id ?? route.toLocationId) === to;
  if (forward) return true;
  if (Boolean(route.one_way ?? route.oneWay)) return false;
  return Number(route.from_location_id ?? route.fromLocationId) === to
    && Number(route.to_location_id ?? route.toLocationId) === from;
}

export function findTravelRoute(routes, fromLocationId, toLocationId) {
  return routes.find((route) => routeAllowsTravel(route, fromLocationId, toLocationId)) ?? null;
}

export function sameRoutePair(route, firstLocationId, secondLocationId) {
  const from = Number(route.from_location_id ?? route.fromLocationId);
  const to = Number(route.to_location_id ?? route.toLocationId);
  const first = Number(firstLocationId);
  const second = Number(secondLocationId);
  return (from === first && to === second) || (from === second && to === first);
}

export function filterRoutesByVisibleLocations(routes, visibleLocationIds) {
  const visible = visibleLocationIds instanceof Set ? visibleLocationIds : new Set(visibleLocationIds);
  return routes.filter(
    (route) =>
      visible.has(Number(route.from_location_id ?? route.fromLocationId))
      && visible.has(Number(route.to_location_id ?? route.toLocationId))
  );
}
