import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRouteLabel,
  filterRoutesByVisibleLocations,
  findTravelRoute,
  normalizeRouteCost,
  routeAllowsTravel,
  sameRoutePair,
} from '../worldRoutes.js';

test('normaliza jornadas enteras positivas dentro del límite', () => {
  assert.equal(normalizeRouteCost(3), 3);
  assert.equal(normalizeRouteCost('12'), 12);
  assert.equal(normalizeRouteCost(0), null);
  assert.equal(normalizeRouteCost(1.5), null);
  assert.equal(normalizeRouteCost(3651), null);
});

test('una ruta bidireccional se recorre en ambos sentidos', () => {
  const route = { from_location_id: 4, to_location_id: 9, one_way: 0 };
  assert.equal(routeAllowsTravel(route, 4, 9), true);
  assert.equal(routeAllowsTravel(route, 9, 4), true);
});

test('una ruta direccional solo permite from → to', () => {
  const route = { fromLocationId: 4, toLocationId: 9, oneWay: true };
  assert.equal(routeAllowsTravel(route, 4, 9), true);
  assert.equal(routeAllowsTravel(route, 9, 4), false);
});

test('encuentra la arista recorrible y detecta pares sin importar el orden', () => {
  const routes = [
    { id: 1, from_location_id: 1, to_location_id: 2, one_way: 1 },
    { id: 2, from_location_id: 2, to_location_id: 3, one_way: 0 },
  ];
  assert.equal(findTravelRoute(routes, 3, 2)?.id, 2);
  assert.equal(findTravelRoute(routes, 2, 1), null);
  assert.equal(sameRoutePair(routes[0], 2, 1), true);
  assert.equal(cleanRouteLabel('  Camino viejo  '), 'Camino viejo');
  assert.equal(cleanRouteLabel({}), null);
});

test('una ruta no se serializa si cualquiera de sus extremos sigue oculto', () => {
  const routes = [
    { id: 1, from_location_id: 1, to_location_id: 2 },
    { id: 2, from_location_id: 2, to_location_id: 3 },
  ];
  assert.deepEqual(filterRoutesByVisibleLocations(routes, new Set([1, 2])).map((route) => route.id), [1]);
});
