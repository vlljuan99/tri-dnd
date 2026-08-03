import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const translations = JSON.parse(
  fs.readFileSync(new URL('../../../data/translations/es.json', import.meta.url), 'utf8')
);

test('todos los nombres de hechizos del SRD tienen traducción', () => {
  assert.equal(Object.keys(translations.spells).length, 319);
  assert.equal(
    Object.values(translations.spells).every(({ name }) => typeof name === 'string' && name.trim()),
    true
  );
});

test('el catálogo histórico de equipo conserva todos sus nombres traducidos', () => {
  assert.equal(Object.keys(translations.equipment).length, 245);
  assert.equal(
    Object.values(translations.equipment).every(({ name }) => typeof name === 'string' && name.trim()),
    true
  );
});
