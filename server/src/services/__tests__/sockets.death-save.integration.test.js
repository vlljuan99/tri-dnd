import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  apiFetch,
  connectSocket,
  emitAck,
  joinRoom,
  registerUser,
  startTestServer,
} from './helpers/liveServer.js';

test('la salvación de muerte avanza el turno salvo con un 20 natural', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, {
      username: 'dm-salvacion-muerte',
      displayName: 'DM Salvación',
    });
    const created = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', {
      campaignType: 'escaramuza',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaignId = created.body.campaign.id;

    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let dyingId;
    let nextId;
    let dyingCharacterId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'dm-salvacion-muerte'").get();
      dyingCharacterId = Number(
        setup
          .prepare(
            `INSERT INTO characters (user_id, campaign_id, name, hp_max, hp_current, status, kind)
             VALUES (?, ?, 'Alda agonizante', 12, 0, 'complete', 'pj')`
          )
          .run(user.id, campaignId).lastInsertRowid
      );
      const nextCharacterId = Number(
        setup
          .prepare(
            `INSERT INTO characters (user_id, campaign_id, name, hp_max, hp_current, status, kind)
             VALUES (?, ?, 'Brena consciente', 12, 12, 'complete', 'pj')`
          )
          .run(user.id, campaignId).lastInsertRowid
      );
      dyingId = Number(
        setup
          .prepare(
            `INSERT INTO combatants
               (campaign_id, character_id, kind, name, initiative, death_state, initiative_source)
             VALUES (?, ?, 'pj', 'Alda agonizante', 20, 'dying', 'manual')`
          )
          .run(campaignId, dyingCharacterId).lastInsertRowid
      );
      nextId = Number(
        setup
          .prepare(
            `INSERT INTO combatants
               (campaign_id, character_id, kind, name, initiative, death_state, initiative_source)
             VALUES (?, ?, 'pj', 'Brena consciente', 10, 'normal', 'manual')`
          )
          .run(campaignId, nextCharacterId).lastInsertRowid
      );
      setup
        .prepare(
          `UPDATE game_tables
           SET combat_active = 1, combat_round = 1, combat_turn_id = ?, enemy_ai_enabled = 0
           WHERE campaign_id = ?`
        )
        .run(dyingId, campaignId);
    } finally {
      setup.close();
    }

    const socket = await connectSocket(server, cookie);
    await joinRoom(socket, campaignId);

    const ordinary = await emitAck(socket, 'combat:death-save', {
      campaignId,
      combatantId: dyingId,
      d20: 12,
      roll: { total: 12, label: 'Salvación de muerte' },
    });
    assert.equal(ordinary.ok, true);
    assert.equal(ordinary.outcome, 'exito');
    assert.equal(ordinary.turnAdvanced, true);

    const afterOrdinary = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    try {
      const table = afterOrdinary
        .prepare('SELECT combat_turn_id FROM game_tables WHERE campaign_id = ?')
        .get(campaignId);
      assert.equal(table.combat_turn_id, nextId);

      afterOrdinary.prepare('UPDATE characters SET hp_current = 0 WHERE id = ?').run(dyingCharacterId);
      afterOrdinary
        .prepare(
          `UPDATE combatants
           SET death_state = 'dying', death_successes = 0, death_failures = 0, death_save_round = NULL
           WHERE id = ?`
        )
        .run(dyingId);
      afterOrdinary
        .prepare('UPDATE game_tables SET combat_round = 2, combat_turn_id = ? WHERE campaign_id = ?')
        .run(dyingId, campaignId);
    } finally {
      afterOrdinary.close();
    }

    const naturalTwenty = await emitAck(socket, 'combat:death-save', {
      campaignId,
      combatantId: dyingId,
      d20: 20,
      roll: { total: 20, label: 'Salvación de muerte' },
    });
    assert.equal(naturalTwenty.ok, true);
    assert.equal(naturalTwenty.outcome, 'revive');
    assert.equal(naturalTwenty.turnAdvanced, false);

    const afterTwenty = new Database(path.join(server.dataDir, 'tri-dnd.db'), { readonly: true });
    try {
      const table = afterTwenty
        .prepare('SELECT combat_turn_id FROM game_tables WHERE campaign_id = ?')
        .get(campaignId);
      const character = afterTwenty
        .prepare('SELECT hp_current FROM characters WHERE id = ?')
        .get(dyingCharacterId);
      assert.equal(table.combat_turn_id, dyingId);
      assert.equal(character.hp_current, 1);
    } finally {
      afterTwenty.close();
    }
  } finally {
    await server.stop();
  }
});
