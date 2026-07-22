import test from 'node:test';
import assert from 'node:assert/strict';
import { findTravelRoute, routeAllowsTravel, routeGeometry } from '../domain/routes.js';

test('respeta el sentido de una ruta al proponer viajes', () => {
  const route = { fromLocationId: 2, toLocationId: 8, oneWay: true };
  assert.equal(routeAllowsTravel(route, 2, 8), true);
  assert.equal(routeAllowsTravel(route, 8, 2), false);
  assert.equal(findTravelRoute([route], 8, 2), null);
});

test('una ruta bidireccional funciona desde cualquiera de sus extremos', () => {
  const route = { id: 4, fromLocationId: 2, toLocationId: 8, oneWay: false };
  assert.equal(findTravelRoute([route], 8, 2)?.id, 4);
});

test('calcula la geometría de una arista a partir de sus pins', () => {
  const geometry = routeGeometry(
    { fromLocationId: 1, toLocationId: 2 },
    [{ id: 1, x: 10, y: 20 }, { id: 2, x: 50, y: 60 }]
  );
  assert.deepEqual({ midX: geometry.midX, midY: geometry.midY }, { midX: 30, midY: 40 });
  assert.equal(routeGeometry({ fromLocationId: 1, toLocationId: 9 }, [{ id: 1, x: 0, y: 0 }]), null);
});
