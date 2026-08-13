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
  waitForEvent,
} from './helpers/liveServer.js';

test('la IA enemiga mueve el turno, tira en servidor y aplica daño al PJ', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, {
      username: 'dm-ia',
      displayName: 'DM IA',
    });
    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let characterId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'dm-ia'").get();
      const character = setup
        .prepare(
          `INSERT INTO characters (user_id, name, level, hp_max, hp_current, ac, status, kind)
           VALUES (?, 'Alda', 4, 30, 30, 14, 'complete', 'pj')`
        )
        .run(user.id);
      characterId = Number(character.lastInsertRowid);
    } finally {
      setup.close();
    }
    const created = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', {
      campaignType: 'escaramuza',
      presetId: 'paso-del-cuervo',
      characterId,
    });
    assert.equal(created.status, 201);
    const campaignId = created.body.campaign.id;

    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let pjCombatantId;
    try {
      const table = database.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const enemy = database
        .prepare(
          `SELECT combatant.id, combatant.map_token_id, token.room_id, token.x, token.y
           FROM combatants combatant JOIN map_tokens token ON token.id = combatant.map_token_id
           WHERE combatant.campaign_id = ? AND combatant.kind = 'enemigo' LIMIT 1`
        )
        .get(campaignId);
      assert.ok(enemy);

      const monster = {
        name: 'Autómata de prueba',
        speed: { walk: '30 ft.' },
        actions: [
          {
            name: 'Golpe automático',
            attack_bonus: 100,
            desc: 'Melee Weapon Attack: reach 5 ft., one target.',
            damage: [{ damage_dice: '1d4+1', damage_type: { index: 'bludgeoning' } }],
          },
        ],
      };
      database
        .prepare(
          `INSERT INTO srd_entries (category, idx, name_en, name_es, data)
           VALUES ('monsters', 'automata-prueba', 'Test Automaton', 'Autómata de prueba', ?)`
        )
        .run(JSON.stringify(monster));
      const pjCombatant = database
        .prepare("SELECT id FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
        .get(campaignId, characterId);
      assert.ok(pjCombatant);
      pjCombatantId = pjCombatant.id;
      database
        .prepare('DELETE FROM combatants WHERE campaign_id = ? AND id NOT IN (?, ?)')
        .run(campaignId, enemy.id, pjCombatantId);
      database
        .prepare(
          `UPDATE combatants SET name = 'Autómata de prueba', monster_index = 'automata-prueba',
             initiative = 20, hp_current = 20, hp_max = 20, ac = 12
           WHERE id = ?`
        )
        .run(enemy.id);
      database
        .prepare("UPDATE map_tokens SET name = 'Autómata de prueba', monster_index = 'automata-prueba' WHERE id = ?")
        .run(enemy.map_token_id);

      database
        .prepare(
          `UPDATE map_character_tokens SET room_id = ?, x = ?, y = ?
            WHERE map_id = ? AND character_id = ?`
        )
        .run(enemy.room_id, enemy.x, enemy.y, table.active_map_id, characterId);
      database
        .prepare("UPDATE combatants SET initiative = 10, initiative_source = 'manual' WHERE id = ?")
        .run(pjCombatantId);
      database
        .prepare(
          `UPDATE game_tables
           SET combat_active = 1, combat_round = 1, combat_turn_id = ?, enemy_ai_enabled = 1
           WHERE campaign_id = ?`
        )
        .run(enemy.id, campaignId);
    } finally {
      database.close();
    }

    const socket = await connectSocket(server, cookie);
    const attackRoll = waitForEvent(
      socket,
      'chat:new',
      (message) => message.type === 'roll' && message.body?.actorName === 'Autómata de prueba',
      5000
    );
    const playerTurn = waitForEvent(
      socket,
      'combat:state',
      (state) => state.turnId === pjCombatantId,
      5000
    );
    await joinRoom(socket, campaignId);
    let roll;
    let state;
    try {
      [roll, state] = await Promise.all([attackRoll, playerTurn]);
    } catch (error) {
      throw new Error(`${error.message}\n${server.logs.join('')}`);
    }

    assert.equal(roll.body.kind, 'attack');
    assert.equal(state.enemyAiEnabled, true);
    const ownerEnemy = state.combatants.find((combatant) => combatant.kind === 'enemigo');
    assert.ok(ownerEnemy, 'el aventurero debe ver al enemigo en iniciativa');
    assert.ok(!('hpCurrent' in ownerEnemy), 'el propietario técnico conserva la privacidad de jugador');
    assert.ok(!('ac' in ownerEnemy), 'la CA enemiga no debe viajar al modo solitario');
    const paused = await emitAck(socket, 'combat:set-enemy-ai', { campaignId, enabled: false });
    assert.equal(paused.ok, true, 'el propietario solitario debe poder pausar el director');
    const resumed = await emitAck(socket, 'combat:set-enemy-ai', { campaignId, enabled: true });
    assert.equal(resumed.ok, true, 'el propietario solitario debe poder reanudar el director');
    const after = new Database(path.join(server.dataDir, 'tri-dnd.db'), { readonly: true });
    try {
      const character = after.prepare('SELECT hp_current FROM characters WHERE id = ?').get(characterId);
      assert.ok(character.hp_current < 30, 'el ataque automático debe aplicar daño real');
    } finally {
      after.close();
    }
  } finally {
    await server.stop();
  }
});
