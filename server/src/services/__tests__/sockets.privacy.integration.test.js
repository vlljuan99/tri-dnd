// Matriz de privacidad — pruebas de integración de sockets.
//
// Regla del proyecto (CLAUDE.md): "si un dato no debe verse, no debe llegar al
// socket del jugador". Estas pruebas la verifican de extremo a extremo:
// arrancan el servidor real, conectan un socket del DM y otro de un jugador con
// sus cookies reales, provocan una acción y afirman qué llega a cada rol.
//
// PATRÓN PARA AFIRMAR UN NEGATIVO SIN ESPERAS ARBITRARIAS
// -------------------------------------------------------
// Para probar que algo NO llega al jugador, el DM dispara primero el dato
// oculto y JUSTO DESPUÉS un dato público-centinela. Socket.io conserva el orden
// de emisión por conexión, así que cuando el jugador recibe el centinela
// sabemos que el oculto —emitido antes— ya habría llegado si el filtro fallara.
// Nada de `setTimeout` a ojo.
//
// CADA FILA DE LA MATRIZ ES UNA COPIA DE LA PRIMERA. Los huecos `{ todo: ... }`
// de abajo marcan lo que falta cubrir; para rellenar uno, copia el cuerpo del
// primer test y cambia el evento y la aserción.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  startTestServer,
  registerUser,
  apiFetch,
  connectSocket,
  joinRoom,
  emitAck,
  collect,
  waitForEvent,
} from './helpers/liveServer.js';

// Monta una escaramuza con su DM y un jugador ya unido. Devuelve el servidor,
// las cookies y el id de campaña listos para conectar sockets.
async function setupCampaignWithPlayer() {
  const server = await startTestServer();
  const dmCookie = await registerUser(server.baseUrl, {
    username: 'dm-privacidad',
    displayName: 'DM Privacidad',
  });
  const playerCookie = await registerUser(server.baseUrl, {
    username: 'jugador-privacidad',
    displayName: 'Jugador Privacidad',
  });

  const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', {
    campaignType: 'escaramuza',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const campaignId = created.body.campaign.id;
  const inviteCode = created.body.campaign.inviteCode;
  assert.ok(inviteCode, 'el DM debe recibir el código de invitación');

  const joined = await apiFetch(server.baseUrl, playerCookie, 'POST', '/api/campaigns/join', {
    code: inviteCode,
  });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));

  return { server, dmCookie, playerCookie, campaignId };
}

// Monta una escaramuza CON preset: trae enemigos revelados en el tracker y un
// tablero activo con salas, base realista para las filas de mapa.
async function setupPresetSkirmish() {
  return setupCampaignWithPlayer();
}

// Sobre el tablero activo del preset, siembra por escritura directa a la BD
// (mismo enfoque que la fila del HP): una sala REVELADA con una trampa oculta y
// un cofre visible, y una sala SIN REVELAR con un enemigo. Devuelve el mapa que
// entrega /mapa-activo a cada rol (serializeFullMap para el DM,
// serializeMapForPlayer para el jugador).
async function seedMapPrivacyFixture() {
  const { server, dmCookie, playerCookie, campaignId } = await setupPresetSkirmish();
  const write = new Database(path.join(server.dataDir, 'tri-dnd.db'));
  try {
    write.pragma('busy_timeout = 5000');
    const mapId = write
      .prepare('SELECT active_map_id AS id FROM game_tables WHERE campaign_id = ?')
      .get(campaignId)?.id;
    assert.ok(mapId, 'el preset debe dejar un tablero activo');
    const floorId = write
      .prepare('SELECT id FROM map_floors WHERE map_id = ? ORDER BY position, id LIMIT 1')
      .get(mapId).id;
    const insertRoom = write.prepare(
      'INSERT INTO map_rooms (floor_id, name, x, y, width, height, revealed) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertToken = write.prepare(
      `INSERT INTO map_tokens
         (room_id, kind, name, monster_index, character_id, x, y, hidden, dc, skill,
          success_consequence, failure_consequence, consequence_scope, perception_dc, vision_radius, loot)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, '', '', 'player', ?, 6, '[]')`
    );
    const revealedRoomId = Number(insertRoom.run(floorId, 'SALA-VISIBLE', 50, 50, 3, 3, 1).lastInsertRowid);
    insertToken.run(revealedRoomId, 'trampa', 'TRAMPA-OCULTA', 51, 51, 1, 10);
    insertToken.run(revealedRoomId, 'objeto', 'COFRE-VISIBLE', 52, 52, 0, null);
    const secretRoomId = Number(insertRoom.run(floorId, 'SALA-SECRETA', 60, 60, 3, 3, 0).lastInsertRowid);
    insertToken.run(secretRoomId, 'enemigo', 'ACECHADOR-SECRETO', 61, 61, 0, null);
  } finally {
    write.close();
  }
  const dmMap = (await apiFetch(server.baseUrl, dmCookie, 'GET', `/api/campaigns/${campaignId}/mapa-activo`)).body.map;
  const playerMap = (
    await apiFetch(server.baseUrl, playerCookie, 'GET', `/api/campaigns/${campaignId}/mapa-activo`)
  ).body.map;
  return { server, dmMap, playerMap };
}

test('una tirada oculta del DM llega al DM pero nunca al jugador', { timeout: 30000 }, async () => {
  const { server, dmCookie, playerCookie, campaignId } = await setupCampaignWithPlayer();
  try {
    const dmSocket = await connectSocket(server, dmCookie);
    const playerSocket = await connectSocket(server, playerCookie);

    const dmJoin = await joinRoom(dmSocket, campaignId);
    const playerJoin = await joinRoom(playerSocket, campaignId);
    assert.equal(dmJoin.role, 'dm');
    assert.equal(playerJoin.role, 'jugador');

    // Todo lo que reciba cada rol durante la prueba.
    const dmMessages = collect(dmSocket, 'chat:new');
    const playerMessages = collect(playerSocket, 'chat:new');

    // Registramos la espera del centinela ANTES de emitir nada.
    const dmGotPublic = waitForEvent(
      dmSocket,
      'chat:new',
      (m) => m.type === 'roll' && m.body?.label === 'CENTINELA'
    );
    const playerGotPublic = waitForEvent(
      playerSocket,
      'chat:new',
      (m) => m.type === 'roll' && m.body?.label === 'CENTINELA'
    );

    // El DM tira algo OCULTO y, acto seguido, algo PÚBLICO (el centinela).
    await emitAck(dmSocket, 'roll:send', {
      campaignId,
      roll: { total: 17, label: 'OCULTA', notation: '1d20+2' },
      hidden: true,
    });
    await emitAck(dmSocket, 'roll:send', {
      campaignId,
      roll: { total: 9, label: 'CENTINELA', notation: '1d20' },
      hidden: false,
    });

    // Cuando ambos reciben el centinela, la oculta ya habría llegado si fuera a
    // llegar.
    await Promise.all([dmGotPublic, playerGotPublic]);

    // El DM ve su propia tirada oculta, marcada como oculta, y también la pública.
    assert.ok(
      dmMessages.some((m) => m.body?.label === 'OCULTA' && m.hidden === true),
      'el DM debe recibir su propia tirada oculta'
    );
    assert.ok(
      dmMessages.some((m) => m.body?.label === 'CENTINELA'),
      'el DM debe recibir la tirada pública'
    );

    // El jugador ve la pública pero NINGUNA oculta.
    assert.ok(
      playerMessages.some((m) => m.body?.label === 'CENTINELA'),
      'el jugador debe recibir la tirada pública'
    );
    assert.ok(
      !playerMessages.some((m) => m.hidden === true),
      'ninguna tirada marcada como oculta debe llegar al jugador'
    );
    assert.ok(
      !playerMessages.some((m) => m.body?.label === 'OCULTA'),
      'la tirada oculta del DM no debe llegar al socket del jugador'
    );
  } finally {
    await server.stop();
  }
});

// --- Resto de la matriz de privacidad (copiar el patrón de arriba) ----------
//
// Cada hueco es una fila del contrato de privacidad del proyecto. Para
// activarlo: quita el `skip`, monta el estado necesario (mapa, tokens,
// combate…) y afirma que el dato sensible llega al DM y no al jugador, usando
// el mismo truco del centinela para el negativo.

test(
  'el HP/CA exacto de un enemigo solo viaja en el combat:state del DM',
  { timeout: 30000 },
  async () => {
    const { server, dmCookie, playerCookie, campaignId } = await setupCampaignWithPlayer();
    try {
      const dbPath = path.join(server.dataDir, 'tri-dnd.db');
      const write = new Database(dbPath);
      let enemyId;
      try {
        write.pragma('busy_timeout = 5000');
        const enemy = write.prepare(
          `INSERT INTO combatants
             (campaign_id, kind, name, initiative, hp_current, hp_max, hp_temp, ac)
           VALUES (?, 'enemigo', 'Acechador de prueba', 17, 27, 30, 5, 15)`
        ).run(campaignId);
        enemyId = Number(enemy.lastInsertRowid);
      } finally {
        write.close();
      }

      // El estado inicial de combate llega en la respuesta de room:join, ya con
      // la vista que corresponde a cada rol.
      const dmSocket = await connectSocket(server, dmCookie);
      const playerSocket = await connectSocket(server, playerCookie);
      const dmState = await joinRoom(dmSocket, campaignId);
      const playerState = await joinRoom(playerSocket, campaignId);

      // El DM ve las estadísticas ocultas del enemigo con sus valores exactos.
      const dmEnemy = dmState.combat.combatants.find((c) => c.id === enemyId);
      assert.ok(dmEnemy, 'el DM debe ver al enemigo en el tracker');
      assert.equal(dmEnemy.kind, 'enemigo');
      assert.equal(dmEnemy.hpCurrent, 27, 'el DM debe ver el HP actual exacto del enemigo');
      assert.equal(dmEnemy.hpMax, 30, 'el DM debe ver el HP máximo del enemigo');
      assert.equal(dmEnemy.hpTemp, 5, 'el DM debe ver los PG temporales del enemigo');
      assert.equal(dmEnemy.ac, 15, 'el DM debe ver la CA del enemigo');

      // El jugador ve al MISMO enemigo en el orden de iniciativa (público: el
      // orden de turnos y el nombre siempre lo han sido)…
      const playerEnemy = playerState.combat.combatants.find((c) => c.id === enemyId);
      assert.ok(playerEnemy, 'el jugador debe ver al enemigo en el orden de turnos');
      assert.equal(playerEnemy.name, dmEnemy.name, 'el nombre del enemigo es público');
      assert.equal(playerEnemy.initiative, dmEnemy.initiative, 'el total de iniciativa es público');

      // …pero el contrato es que esas claves NUNCA se asignan a la vista del
      // jugador: no basta con que valgan undefined, no deben existir siquiera.
      for (const secret of ['hpCurrent', 'hpMax', 'hpTemp', 'ac', 'initiativeRoll', 'monsterIndex', 'overrides']) {
        assert.ok(
          !(secret in playerEnemy),
          `el jugador no debe recibir "${secret}" del enemigo (fuga de datos)`
        );
      }
    } finally {
      await server.stop();
    }
  }
);

test('una trampa oculta no aparece en el mapa del jugador', { timeout: 30000 }, async () => {
  const { server, dmMap, playerMap } = await seedMapPrivacyFixture();
  try {
    const dmTokens = dmMap.tokens.map((t) => t.name);
    const playerTokens = playerMap.tokens.map((t) => t.name);

    // El DM ve la trampa oculta y el cofre visible de la misma sala revelada.
    assert.ok(dmTokens.includes('TRAMPA-OCULTA'), 'el DM ve la trampa oculta');
    assert.ok(dmTokens.includes('COFRE-VISIBLE'), 'el DM ve el cofre');

    // El jugador ve el cofre (control positivo: la sala está revelada) pero
    // NUNCA la trampa oculta, filtrada por su flag hidden en el servidor.
    assert.ok(
      playerTokens.includes('COFRE-VISIBLE'),
      'el jugador ve el marcador visible de la sala revelada'
    );
    assert.ok(!playerTokens.includes('TRAMPA-OCULTA'), 'la trampa oculta no debe llegar al jugador');
  } finally {
    await server.stop();
  }
});

test('un enemigo en una sala sin revelar (niebla de guerra) no llega al jugador', { timeout: 30000 }, async () => {
  const { server, dmMap, playerMap } = await seedMapPrivacyFixture();
  try {
    const dmRooms = dmMap.floors.flatMap((f) => f.rooms).map((r) => r.name);
    const playerRooms = playerMap.floors.flatMap((f) => f.rooms).map((r) => r.name);

    // El DM ve la sala sin revelar y a su enemigo.
    assert.ok(dmRooms.includes('SALA-SECRETA'), 'el DM ve la sala sin revelar');
    assert.ok(
      dmMap.tokens.some((t) => t.name === 'ACECHADOR-SECRETO'),
      'el DM ve al enemigo de la sala secreta'
    );

    // El jugador ve la sala revelada (control positivo) pero la niebla de guerra
    // le oculta la sala sin revelar y a todo lo que hay dentro.
    assert.ok(playerRooms.includes('SALA-VISIBLE'), 'el jugador ve la sala revelada');
    assert.ok(!playerRooms.includes('SALA-SECRETA'), 'la sala sin revelar no debe llegar al jugador');
    assert.ok(
      !playerMap.tokens.some((t) => t.name === 'ACECHADOR-SECRETO'),
      'el enemigo de una sala sin revelar no debe llegar al jugador'
    );
  } finally {
    await server.stop();
  }
});

test('el archivo narrativo privado del DM nunca se sirve a un jugador', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const dmCookie = await registerUser(server.baseUrl, {
      username: 'dm-archivo',
      displayName: 'DM Archivo',
    });
    const playerCookie = await registerUser(server.baseUrl, {
      username: 'jugador-archivo',
      displayName: 'Jugador Archivo',
    });

    // El archivo narrativo solo existe en campañas, no en escaramuzas.
    const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', {
      campaignType: 'campana',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaignId = created.body.campaign.id;
    const joined = await apiFetch(server.baseUrl, playerCookie, 'POST', '/api/campaigns/join', {
      code: created.body.campaign.inviteCode,
    });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));

    // El DM crea una entrada PRIVADA y otra PUBLICADA para el grupo.
    const secret = await apiFetch(
      server.baseUrl,
      dmCookie,
      'POST',
      `/api/campaigns/${campaignId}/archivo/nodos`,
      { kind: 'entrada', title: 'SECRETO-DM', visibility: 'private' }
    );
    assert.equal(secret.status, 201, JSON.stringify(secret.body));
    const secretNodeId = secret.body.node.id;
    const shared = await apiFetch(
      server.baseUrl,
      dmCookie,
      'POST',
      `/api/campaigns/${campaignId}/archivo/nodos`,
      { kind: 'entrada', title: 'PUBLICO-GRUPO', visibility: 'players' }
    );
    assert.equal(shared.status, 201, JSON.stringify(shared.body));

    // Un bloque de imagen dentro de la entrada privada, con su imagen subida
    // (PNG mínimo de 1×1). Su media vive fuera de /uploads: solo la API la sirve.
    const block = await apiFetch(
      server.baseUrl,
      dmCookie,
      'POST',
      `/api/campaigns/${campaignId}/archivo/nodos/${secretNodeId}/bloques`,
      { type: 'imagen' }
    );
    assert.equal(block.status, 201, JSON.stringify(block.body));
    const blockId = block.body.block.id;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const upload = await fetch(
      `${server.baseUrl}/api/campaigns/${campaignId}/archivo/bloques/${blockId}/imagen`,
      { method: 'PATCH', headers: { Cookie: dmCookie, 'Content-Type': 'image/png' }, body: png }
    );
    assert.equal(upload.status, 200, await upload.text());

    // Listado del archivo: el DM ve su entrada privada; el jugador solo la
    // publicada, y no puede editar.
    const dmArchive = await apiFetch(server.baseUrl, dmCookie, 'GET', `/api/campaigns/${campaignId}/archivo`);
    const playerArchive = await apiFetch(
      server.baseUrl,
      playerCookie,
      'GET',
      `/api/campaigns/${campaignId}/archivo`
    );
    const dmTitles = dmArchive.body.nodes.map((n) => n.title);
    const playerTitles = playerArchive.body.nodes.map((n) => n.title);
    assert.ok(dmTitles.includes('SECRETO-DM'), 'el DM ve su entrada privada');
    assert.ok(playerTitles.includes('PUBLICO-GRUPO'), 'el jugador ve la entrada publicada (control positivo)');
    assert.ok(!playerTitles.includes('SECRETO-DM'), 'la entrada privada no debe aparecer en el archivo del jugador');
    assert.equal(playerArchive.body.canEdit, false, 'el jugador no puede editar el archivo');

    // La búsqueda tampoco filtra la entrada privada hacia el jugador.
    const playerSearch = await apiFetch(
      server.baseUrl,
      playerCookie,
      'GET',
      `/api/campaigns/${campaignId}/archivo/buscar?q=SECRETO`
    );
    assert.ok(
      !playerSearch.body.results.some((n) => n.title === 'SECRETO-DM'),
      'la búsqueda del jugador no debe revelar la entrada privada'
    );

    // La imagen privada: 200 para el DM, 404 para el jugador.
    const dmImage = await fetch(
      `${server.baseUrl}/api/campaigns/${campaignId}/archivo/bloques/${blockId}/imagen`,
      { headers: { Cookie: dmCookie } }
    );
    assert.equal(dmImage.status, 200, 'el DM puede ver su propia imagen privada');
    const playerImage = await fetch(
      `${server.baseUrl}/api/campaigns/${campaignId}/archivo/bloques/${blockId}/imagen`,
      { headers: { Cookie: playerCookie } }
    );
    assert.equal(playerImage.status, 404, 'la imagen de una entrada privada no debe servirse a un jugador');
  } finally {
    await server.stop();
  }
});
