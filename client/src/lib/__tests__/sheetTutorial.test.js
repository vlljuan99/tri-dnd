import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartSheetTutorial } from '../sheetTutorial.js';

test('el tutorial conserva su petición hasta que la ficha y el compendio estén listos', () => {
  assert.equal(canStartSheetTutorial({
    requested: true,
    characterReady: false,
    compendiumSettled: false,
  }), false);
  assert.equal(canStartSheetTutorial({
    requested: true,
    characterReady: true,
    compendiumSettled: false,
  }), false);
  assert.equal(canStartSheetTutorial({
    requested: true,
    characterReady: true,
    compendiumSettled: true,
  }), true);
});

test('el tutorial no arranca sin una petición explícita aunque la ficha esté lista', () => {
  assert.equal(canStartSheetTutorial({
    requested: false,
    characterReady: true,
    compendiumSettled: true,
  }), false);
});
