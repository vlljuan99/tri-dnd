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

// Fase 4b: la mesa revela cada tirada por pasos y retiene sus efectos hasta que
// el dado cae. Para eso el servidor tiene que (1) mandar la tirada ANTES que su
// efecto visual y (2) acompañarla de su veredicto (`outcome`), que escribe él y
// nunca el cliente.

test('el ataque de la IA sale con su veredicto y antes que su efecto', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, { username: 'dm-revelado', displayName: 'DM Revelado' });
    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let characterId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'dm-revelado'").get();
      characterId = Number(
        setup
          .prepare(
            `INSERT INTO characters (user_id, name, level, hp_max, hp_current, ac, status, kind)
             VALUES (?, 'Alda', 4, 30, 30, 14, 'complete', 'pj')`
          )
          .run(user.id).lastInsertRowid
      );
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
    try {
      const table = database.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const enemy = database
        .prepare(
          `SELECT combatant.id, combatant.map_token_id, token.room_id, token.x, token.y
           FROM combatants combatant JOIN map_tokens token ON token.id = combatant.map_token_id
           WHERE combatant.campaign_id = ? AND combatant.kind = 'enemigo' LIMIT 1`
        )
        .get(campaignId);
      const monster = {
        name: 'Autómata de prueba',
        speed: { walk: '30 ft.' },
        actions: [
          {
            name: 'Golpe automático',
            attack_bonus: 3,
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
      database
        .prepare('DELETE FROM combatants WHERE campaign_id = ? AND id NOT IN (?, ?)')
        .run(campaignId, enemy.id, pjCombatant.id);
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
        .prepare('UPDATE map_character_tokens SET room_id = ?, x = ?, y = ? WHERE map_id = ? AND character_id = ?')
        .run(enemy.room_id, enemy.x, enemy.y, table.active_map_id, characterId);
      database
        .prepare("UPDATE combatants SET initiative = 10, initiative_source = 'manual' WHERE id = ?")
        .run(pjCombatant.id);
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
    // Orden de llegada de todo lo que importa para el revelado
    const order = [];
    socket.onAny((event, payload) => {
      if (event === 'chat:new' && payload?.type === 'roll') order.push({ kind: 'roll', payload });
      if (event === 'combat:visual' && ['hit', 'miss'].includes(payload?.type)) order.push({ kind: 'visual', payload });
    });
    const firstVisual = waitForEvent(
      socket,
      'combat:visual',
      (visual) => visual.type === 'hit' || visual.type === 'miss',
      5000
    );
    await joinRoom(socket, campaignId);
    try {
      await firstVisual;
    } catch (error) {
      throw new Error(`${error.message}\n${server.logs.join('')}`);
    }

    const visualIndex = order.findIndex((entry) => entry.kind === 'visual');
    const attackIndex = order.findIndex(
      (entry) => entry.kind === 'roll' && entry.payload.body?.kind === 'attack'
    );
    assert.ok(attackIndex >= 0, 'la tirada de ataque debe llegar a la mesa');
    assert.ok(attackIndex < visualIndex, 'la tirada debe llegar antes que el destello del golpe');

    const { outcome, total, fumble, crit } = order[attackIndex].payload.body;
    assert.equal(outcome.tipo, 'ataque');
    assert.equal(outcome.objetivo, 'Alda');
    assert.deepEqual(outcome.contra, { etiqueta: 'CA', valor: 14 });
    const expected = crit ? 'critico' : fumble ? 'pifia' : total >= 14 ? 'impacta' : 'falla';
    assert.equal(outcome.resultado, expected);
  } finally {
    await server.stop();
  }
});

test('el veredicto lo escribe el servidor: el del cliente se descarta y el uid viaja intacto', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, { username: 'dm-veredicto', displayName: 'DM Veredicto' });
    const created = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', { campaignType: 'escaramuza' });
    assert.equal(created.status, 201);
    const campaignId = created.body.campaign.id;

    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let dyingId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'dm-veredicto'").get();
      const characterId = Number(
        setup
          .prepare(
            `INSERT INTO characters (user_id, campaign_id, name, hp_max, hp_current, status, kind)
             VALUES (?, ?, 'Alda agonizante', 12, 0, 'complete', 'pj')`
          )
          .run(user.id, campaignId).lastInsertRowid
      );
      dyingId = Number(
        setup
          .prepare(
            `INSERT INTO combatants (campaign_id, character_id, kind, name, initiative, death_state, initiative_source)
             VALUES (?, ?, 'pj', 'Alda agonizante', 20, 'dying', 'manual')`
          )
          .run(campaignId, characterId).lastInsertRowid
      );
      setup
        .prepare(
          `UPDATE game_tables SET combat_active = 1, combat_round = 1, combat_turn_id = ?, enemy_ai_enabled = 0
           WHERE campaign_id = ?`
        )
        .run(dyingId, campaignId);
    } finally {
      setup.close();
    }

    const socket = await connectSocket(server, cookie);
    await joinRoom(socket, campaignId);

    // Una tirada libre con un veredicto inventado por el cliente
    const freeEcho = waitForEvent(socket, 'chat:new', (message) => message.type === 'roll');
    await emitAck(socket, 'roll:send', {
      campaignId,
      roll: { uid: 'libre-1', label: 'Tirada', total: 3, outcome: { resultado: 'critico' } },
    });
    const free = await freeEcho;
    assert.equal(free.body.uid, 'libre-1');
    assert.equal(free.body.outcome, undefined, 'el cliente no puede ponerle veredicto a su tirada');

    // La salvación de muerte sale con el veredicto del servidor y el uid intacto
    const deathEcho = waitForEvent(socket, 'chat:new', (message) => message.type === 'roll');
    await emitAck(socket, 'combat:death-save', {
      campaignId,
      combatantId: dyingId,
      d20: 12,
      roll: { uid: 'muerte-1', total: 12, label: 'Salvación de muerte', outcome: { resultado: 'critico' } },
    });
    const death = await deathEcho;
    assert.equal(death.body.uid, 'muerte-1');
    assert.equal(death.body.outcome.tipo, 'muerte');
    assert.equal(death.body.outcome.resultado, 'supera');
    assert.deepEqual(death.body.outcome.contra, { etiqueta: 'CD', valor: 10 });
  } finally {
    await server.stop();
  }
});
