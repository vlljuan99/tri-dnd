import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { campaignDmForMember, visibleCustomOwnerIds } from '../customLibraryAccess.js';

test('clases y razas incluyen al DM de la campaña, sin duplicar al propio DM', () => {
  assert.deepEqual(visibleCustomOwnerIds(20, 'classes', 10), [20, 10]);
  assert.deepEqual(visibleCustomOwnerIds(20, 'races', 10), [20, 10]);
  assert.deepEqual(visibleCustomOwnerIds(10, 'classes', 10), [10]);
});

test('objetos y hechizos continúan siendo privados aunque haya contexto de campaña', () => {
  assert.deepEqual(visibleCustomOwnerIds(20, 'equipment', 10), [20]);
  assert.deepEqual(visibleCustomOwnerIds(20, 'spells', 10), [20]);
});

test('solo una membresía real permite resolver el DM de la campaña', () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE campaigns (id INTEGER PRIMARY KEY, dm_user_id INTEGER NOT NULL);
    CREATE TABLE campaign_members (campaign_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    INSERT INTO campaigns (id, dm_user_id) VALUES (7, 10);
    INSERT INTO campaign_members (campaign_id, user_id) VALUES (7, 10), (7, 20);
  `);

  assert.equal(campaignDmForMember(database, 7, 20), 10);
  assert.equal(campaignDmForMember(database, 7, 99), null);
  assert.equal(campaignDmForMember(database, 999, 20), null);
  database.close();
});
