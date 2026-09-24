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

// Fase 4d: el DM como narrador. Lo que importa aquí es la privacidad: con el
// nombre oculto, el nombre real no puede llegar al jugador por NINGUNA vía
// (mapa, combate, mensajes, bestiario) hasta que el DM lo revele; y la
// presentación de jefe sale una sola vez, cuando la mesa lo ve.

// Una sala revelada con un enemigo visible sobre el tablero de la escaramuza:
// la visibilidad la decide solo el «oculto» del marcador.
function seedEnemy(database, mapId, name) {
  const floorId = database.prepare('SELECT id FROM map_floors WHERE map_id = ? ORDER BY position, id LIMIT 1').get(mapId).id;
  const roomId = Number(
    database
      .prepare('INSERT INTO map_rooms (floor_id, name, x, y, width, height, revealed) VALUES (?, ?, 50, 50, 5, 5, 1)')
      .run(floorId, 'Guarida').lastInsertRowid
  );
  return Number(
    database
      .prepare(
        `INSERT INTO map_tokens (room_id, kind, name, x, y, hidden, consequence_scope, vision_radius, loot)
         VALUES (?, 'enemigo', ?, 52, 52, 0, 'player', 6, '[]')`
      )
      .run(roomId, name).lastInsertRowid
  );
}

const REAL_NAME = 'Dragón rojo joven';
const SHOWN_NAME = 'Criatura escamosa';

test('nombre oculto sin fugas, presentación de jefe única y narración solo del DM', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const dmCookie = await registerUser(server.baseUrl, { username: 'dm-narrador', displayName: 'DM' });
    const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', { campaignType: 'escaramuza' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaignId = created.body.campaign.id;
    const playerCookie = await registerUser(server.baseUrl, { username: 'jugadora-narr', displayName: 'Jugadora' });
    const joined = await apiFetch(server.baseUrl, playerCookie, 'POST', '/api/campaigns/join', {
      code: created.body.campaign.inviteCode,
    });
    assert.ok([200, 201].includes(joined.status), JSON.stringify(joined.body));

    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let mapId;
    let tokenId;
    try {
      mapId = database.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId).active_map_id;
      tokenId = seedEnemy(database, mapId, 'Bandido');
    } finally {
      database.close();
    }

    const dm = await connectSocket(server, dmCookie);
    await joinRoom(dm, campaignId);
    const player = await connectSocket(server, playerCookie);
    await joinRoom(player, campaignId);
    const playerEvents = [];
    player.onAny((event, payload) => playerEvents.push({ event, payload }));

    // El DM prepara al jefe oculto: nombre real, nombre visible y presentación
    const tokenPath = `/api/campaigns/${campaignId}/mapas/${mapId}/fichas/${tokenId}`;
    const prepared = await apiFetch(server.baseUrl, dmCookie, 'PATCH', tokenPath, {
      name: REAL_NAME,
      visibleName: SHOWN_NAME,
      hidden: true,
      bossIntro: true,
      bossTitle: 'El terror del paso',
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      playerEvents.filter((entry) => entry.event === 'jefe:presentacion').length,
      0,
      'oculto, todavía no se presenta'
    );

    // Deja de estar oculto: se presenta una vez, con el nombre visible
    const intro = waitForEvent(player, 'jefe:presentacion');
    const unhidden = await apiFetch(server.baseUrl, dmCookie, 'PATCH', tokenPath, { hidden: false });
    assert.equal(unhidden.status, 200);
    const presented = await intro;
    assert.equal(presented.name, SHOWN_NAME);
    assert.equal(presented.title, 'El terror del paso');
    await apiFetch(server.baseUrl, dmCookie, 'PATCH', tokenPath, { hidden: false });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(playerEvents.filter((entry) => entry.event === 'jefe:presentacion').length, 1, 'una sola vez');

    // Todo lo que tiene el jugador por cualquier vía, sin el nombre real
    const playerMap = await apiFetch(server.baseUrl, playerCookie, 'GET', `/api/campaigns/${campaignId}/mapa-activo`);
    const playerBestiary = await apiFetch(server.baseUrl, playerCookie, 'GET', `/api/campaigns/${campaignId}/bestiario`);
    const rejoin = await joinRoom(player, campaignId);
    const everything = JSON.stringify({ playerEvents, playerMap: playerMap.body, playerBestiary: playerBestiary.body, rejoin });
    assert.ok(everything.includes(SHOWN_NAME), 'la mesa ve el nombre visible');
    assert.ok(!everything.includes(REAL_NAME), 'el nombre real no llega al jugador por ninguna vía');
    assert.ok(!everything.includes('trueName'), 'ni siquiera el campo del DM');
    const dmMap = await apiFetch(server.baseUrl, dmCookie, 'GET', `/api/campaigns/${campaignId}/mapa-activo`);
    assert.ok(JSON.stringify(dmMap.body).includes(REAL_NAME), 'el DM sí lo tiene');

    // El jugador no narra; el DM sí
    await assert.rejects(
      emitAck(player, 'chat:send', { campaignId, text: 'Hola', style: 'narracion' }),
      /Solo el DM/
    );
    const narration = waitForEvent(player, 'chat:new', (message) => message.style === 'narracion');
    await emitAck(dm, 'chat:send', { campaignId, text: 'El viento aúlla en el desfiladero.', style: 'narracion' });
    assert.equal((await narration).body, 'El viento aúlla en el desfiladero.');

    // Revelar: desde aquí el nombre real es el de todos
    const reveal = waitForEvent(player, 'chat:new', (message) => message.type === 'system' && message.body.includes(REAL_NAME));
    await emitAck(dm, 'combat:revelar-nombre', { campaignId, tokenId });
    assert.match((await reveal).body, new RegExp(`${SHOWN_NAME} se revela: es ${REAL_NAME}`));
    const afterReveal = await apiFetch(server.baseUrl, playerCookie, 'GET', `/api/campaigns/${campaignId}/mapa-activo`);
    assert.ok(JSON.stringify(afterReveal.body).includes(REAL_NAME));
  } finally {
    await server.stop();
  }
});

test('el jugador ve la etiqueta de salud del enemigo, nunca sus PG del tracker', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const dmCookie = await registerUser(server.baseUrl, { username: 'dm-salud', displayName: 'DM' });
    const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', { campaignType: 'escaramuza' });
    const campaignId = created.body.campaign.id;
    const playerCookie = await registerUser(server.baseUrl, { username: 'jugador-salud', displayName: 'Jugador' });
    await apiFetch(server.baseUrl, playerCookie, 'POST', '/api/campaigns/join', { code: created.body.campaign.inviteCode });

    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    try {
      const table = database.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const tokenId = seedEnemy(database, table.active_map_id, 'Bandido herido');
      database
        .prepare(
          `INSERT INTO combatants (campaign_id, map_token_id, kind, name, initiative, hp_current, hp_max, ac)
           VALUES (?, ?, 'enemigo', 'Bandido herido', 12, 9, 40, 12)`
        )
        .run(campaignId, tokenId);
    } finally {
      database.close();
    }
    const player = await connectSocket(server, playerCookie);
    const state = await joinRoom(player, campaignId);
    const enemy = state.combat.combatants.find((combatant) => combatant.name === 'Bandido herido');
    assert.ok(enemy);
    assert.equal(enemy.healthLabel, 'a punto de caer');
    assert.ok(!('hpCurrent' in enemy) && !('hpMax' in enemy), 'los PG del tracker siguen siendo del DM');
  } finally {
    await server.stop();
  }
});
