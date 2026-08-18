import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  apiFetch,
  connectSocket,
  joinRoom,
  registerUser,
  startTestServer,
  waitForEvent,
} from './helpers/liveServer.js';

// Mover el personaje gasta casillas del turno (`trySpendMovement`), pero eso
// solo se avisaba a la mesa si además saltaba un ataque de oportunidad o un
// fluido. Sin el aviso, el HUD del jugador seguía pintando el movimiento
// intacto y el área de alcance entera hasta el siguiente evento de combate:
// parecía que el movimiento "volvía" después de gastarlo.
test('mover un personaje difunde el movimiento gastado al resto de la mesa', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, {
      username: 'jugadora-movimiento',
      displayName: 'Jugadora Movimiento',
    });

    // Un escenario sin DM (preset) deja al creador jugando como aventurero, que
    // es justo el rol cuyo movimiento pasa por el presupuesto del turno.
    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let characterId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'jugadora-movimiento'").get();
      characterId = Number(
        setup
          .prepare(
            `INSERT INTO characters (user_id, name, level, hp_max, hp_current, speed, ac, status, kind)
             VALUES (?, 'Alda andarina', 3, 24, 24, 30, 15, 'complete', 'pj')`
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
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.campaign.role, 'jugador');
    const campaignId = created.body.campaign.id;

    const board = new Database(path.join(server.dataDir, 'tri-dnd.db'), { readonly: true });
    let origin;
    let combatantId;
    try {
      origin = board
        .prepare('SELECT x, y FROM map_character_tokens WHERE character_id = ?')
        .get(characterId);
      combatantId = board
        .prepare("SELECT id FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
        .get(campaignId, characterId).id;
      const table = board.prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      assert.equal(table.combat_active, 1);
      assert.equal(table.combat_turn_id, combatantId, 'el escenario en solitario da el primer turno al PJ');
    } finally {
      board.close();
    }

    const socket = await connectSocket(server, cookie);
    const joined = await joinRoom(socket, campaignId);
    assert.equal(
      joined.combat.combatants.find((c) => c.id === combatantId).movedSquares,
      0,
      'el turno empieza con el movimiento intacto'
    );

    const pending = waitForEvent(socket, 'combat:state', (state) =>
      state.combatants.some((c) => c.id === combatantId && c.movedSquares > 0)
    );
    const moved = await apiFetch(
      server.baseUrl,
      cookie,
      'POST',
      `/api/campaigns/${campaignId}/mapa-activo/personajes/${characterId}/mover`,
      { x: origin.x + 2, y: origin.y }
    );
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    const state = await pending;
    const combatant = state.combatants.find((c) => c.id === combatantId);
    assert.equal(combatant.movedSquares, 2, 'la mesa recibe las casillas ya gastadas');
  } finally {
    await server.stop();
  }
});
