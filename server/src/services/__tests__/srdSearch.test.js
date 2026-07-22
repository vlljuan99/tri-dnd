import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildSearchText, buildSnippet, collectReferenceIndexes } from '../srdShape.js';
import { ftsQueryString } from '../srdSearch.js';

test('buildSearchText aplana toda la prosa de la entrada, no solo el nombre', () => {
  const data = {
    name: 'Fire Bolt',
    index: 'fire-bolt',
    url: '/api/2014/spells/fire-bolt',
    school: { index: 'evocation', name: 'Evocation', url: '/api/2014/magic-schools/evocation' },
    desc: ['You hurl a mote of fire at a creature.'],
    higher_level: ['The damage increases at higher levels.'],
  };
  const text = buildSearchText(data, { nameEs: 'Rayo de fuego', nameEn: 'Fire Bolt', descEs: 'Lanzas una mota de fuego.' });

  assert.match(text, /Rayo de fuego/);
  assert.match(text, /Fire Bolt/);
  assert.match(text, /mota de fuego/);
  assert.match(text, /Evocation/); // nombre de la referencia, antes no indexado
  assert.match(text, /higher levels/); // rama higher_level
  // No cuela rutas de la API ni URLs.
  assert.doesNotMatch(text, /\/api\//);
});

test('buildSearchText recoge texto anidado de acciones y rasgos de monstruo', () => {
  const data = {
    name: 'Goblin',
    special_abilities: [{ name: 'Nimble Escape', desc: 'The goblin can disengage as a bonus action.' }],
    actions: [{ name: 'Scimitar', desc: 'Melee weapon attack, slashing damage.' }],
  };
  const text = buildSearchText(data, { nameEn: 'Goblin' });
  assert.match(text, /Nimble Escape/);
  assert.match(text, /disengage as a bonus action/);
  assert.match(text, /slashing damage/);
});

test('recoge referencias anidadas y añade sus nombres traducidos al índice', () => {
  const data = {
    damage: { damage_type: { index: 'fire', name: 'Fire' } },
    classes: [{ index: 'wizard', name: 'Wizard' }],
  };
  assert.deepEqual([...collectReferenceIndexes(data)], ['fire', 'wizard']);
  const text = buildSearchText(data, { relatedNames: ['Fuego', 'Mago'] });
  assert.match(text, /Fuego/);
  assert.match(text, /Mago/);
});

test('buildSnippet prioriza el español y recorta con elipsis', () => {
  assert.equal(buildSnippet({ desc: ['English text'] }, 'Texto en español'), 'Texto en español');
  const long = 'a'.repeat(300);
  const snippet = buildSnippet({ desc: [long] }, null, 240);
  assert.ok(snippet.length <= 241);
  assert.ok(snippet.endsWith('…'));
});

test('ftsQueryString convierte cada palabra en un prefijo unido por AND', () => {
  assert.equal(ftsQueryString('bola fue'), '"bola"* AND "fue"*');
  assert.equal(ftsQueryString('  Fire  '), '"fire"*');
  assert.equal(ftsQueryString('   '), null);
  assert.equal(ftsQueryString('!!!'), null);
});

test('el índice FTS encuentra por prosa y por prefijo ignorando acentos', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE VIRTUAL TABLE srd_fts USING fts5(
    category UNINDEXED, idx UNINDEXED, text,
    tokenize = 'unicode61 remove_diacritics 2'
  );`);
  const insert = db.prepare('INSERT INTO srd_fts (category, idx, text) VALUES (?, ?, ?)');
  insert.run('spells', 'fire-bolt', buildSearchText(
    { desc: ['You hurl a mote of fire'] },
    { nameEs: 'Ráfaga ígnea de fuego', nameEn: 'Fire Bolt' }
  ));
  insert.run('monsters', 'goblin', buildSearchText(
    { special_abilities: [{ name: 'Nimble Escape', desc: 'disengage' }] },
    { nameEs: 'Trasgo', nameEn: 'Goblin' }
  ));

  const search = (q) =>
    db.prepare('SELECT idx FROM srd_fts WHERE srd_fts MATCH ? ORDER BY rank').all(ftsQueryString(q)).map((r) => r.idx);

  assert.deepEqual(search('fuego'), ['fire-bolt']); // acento plegado, término en español
  assert.deepEqual(search('rafaga ignea'), ['fire-bolt']); // remove_diacritics pliega tildes
  assert.deepEqual(search('escape'), ['goblin']); // prosa de un rasgo anidado
  assert.deepEqual(search('fue'), ['fire-bolt']); // prefijo
  assert.deepEqual(search('trasgo escape'), ['goblin']); // dos términos AND
  assert.deepEqual(search('inexistente'), []);
  db.close();
});
