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
    // Un preset de escaramuza ya deja enemigos revelados en el tracker y un
    // tablero activo, así que sirve de montaje realista sin tener que pintar un
    // mapa a mano (mismo camino que skirmishes.integration.test.js).
    const server = await startTestServer();
    try {
      const dmCookie = await registerUser(server.baseUrl, {
        username: 'dm-hpca',
        displayName: 'DM HP/CA',
      });
      const playerCookie = await registerUser(server.baseUrl, {
        username: 'jugador-hpca',
        displayName: 'Jugador HP/CA',
      });

      const presets = await apiFetch(
        server.baseUrl,
        dmCookie,
        'GET',
        '/api/campaigns/escaramuzas/predefinidas'
      );
      assert.equal(presets.status, 200);
      assert.ok(presets.body.presets.length >= 1, 'debe haber al menos un preset de escaramuza');

      const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', {
        campaignType: 'escaramuza',
        presetId: presets.body.presets[0].id,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const campaignId = created.body.campaign.id;
      const inviteCode = created.body.campaign.inviteCode;

      const joined = await apiFetch(server.baseUrl, playerCookie, 'POST', '/api/campaigns/join', {
        code: inviteCode,
      });
      assert.equal(joined.status, 201, JSON.stringify(joined.body));

      // El estado inicial de combate llega en la respuesta de room:join, ya con
      // la vista que corresponde a cada rol.
      const dmSocket = await connectSocket(server, dmCookie);
      const playerSocket = await connectSocket(server, playerCookie);
      const dmState = await joinRoom(dmSocket, campaignId);
      const playerState = await joinRoom(playerSocket, campaignId);

      const dmEnemies = dmState.combat.combatants.filter((c) => c.kind === 'enemigo');
      assert.ok(dmEnemies.length >= 1, 'el preset debe dejar al menos un enemigo en el tracker');
      const dmEnemy = dmEnemies[0];

      // El DM ve las estadísticas ocultas del enemigo.
      assert.equal(typeof dmEnemy.hpCurrent, 'number', 'el DM debe ver el HP actual del enemigo');
      assert.equal(typeof dmEnemy.hpMax, 'number', 'el DM debe ver el HP máximo del enemigo');
      assert.equal(typeof dmEnemy.ac, 'number', 'el DM debe ver la CA del enemigo');

      // El jugador ve al MISMO enemigo en el orden de iniciativa (público: el
      // orden de turnos y el nombre siempre lo han sido)…
      const playerEnemy = playerState.combat.combatants.find((c) => c.id === dmEnemy.id);
      assert.ok(playerEnemy, 'el jugador debe ver al enemigo en el orden de turnos');
      assert.equal(playerEnemy.name, dmEnemy.name, 'el nombre del enemigo es público');
      assert.equal(playerEnemy.initiative, dmEnemy.initiative, 'el total de iniciativa es público');

      // …pero NUNCA su HP/CA exactos ni el desglose que delata su ficha.
      assert.equal(playerEnemy.hpCurrent, undefined, 'el HP del enemigo no debe llegar al jugador');
      assert.equal(playerEnemy.hpMax, undefined, 'el HP máximo del enemigo no debe llegar al jugador');
      assert.equal(playerEnemy.ac, undefined, 'la CA del enemigo no debe llegar al jugador');
      assert.equal(playerEnemy.hpTemp, undefined, 'los PG temporales del enemigo no deben llegar al jugador');
      assert.equal(
        playerEnemy.initiativeRoll,
        undefined,
        'el desglose de iniciativa (d20 + DES) del enemigo es privado del DM'
      );
    } finally {
      await server.stop();
    }
  }
);

test(
  'una trampa oculta no aparece en el estado del mapa del jugador',
  {
    skip: 'pendiente: coloca una trampa hidden=1 y compara el mapa que recibe cada rol',
  },
  async () => {
    // El jugador solo debería "descubrirla" vía percepcion:buscar; sin eso, el
    // marcador de la trampa no debe llegar a su socket.
  }
);

test(
  'un token en niebla de guerra no llega al socket del jugador sin visión',
  {
    skip: 'pendiente: coloca un token en sala no revelada y fuera de línea de visión',
  },
  async () => {
    // Con la sala sin revelar y sin línea de visión, el token enemigo no debe
    // estar en el mapa que recibe el jugador, aunque sí en el del DM.
  }
);

test(
  'el archivo narrativo privado del DM nunca se sirve a un jugador',
  {
    skip: 'pendiente: intenta leer /api/campaigns/:id/archivo y su media como jugador',
  },
  async () => {
    // Como jugador, GET del archivo narrativo y de su media privada debe dar
    // 403/404; como DM, 200.
  }
);
