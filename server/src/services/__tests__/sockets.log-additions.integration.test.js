import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  apiFetch,
  collect,
  connectSocket,
  emitAck,
  joinRoom,
  registerUser,
  startTestServer,
  waitForEvent,
} from './helpers/liveServer.js';

// Añadidos del 23-sep-2026 a la Fase 4: susurros, reacciones y resumen de
// combate. Lo que se prueba es la privacidad de cada uno.

async function setupTable(server) {
  const dmCookie = await registerUser(server.baseUrl, { username: 'dm-registro', displayName: 'DM' });
  const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', { campaignType: 'escaramuza' });
  assert.equal(created.status, 201);
  const campaignId = created.body.campaign.id;
  const players = [];
  for (const [username, displayName, pcName] of [['ana-reg', 'Ana', 'Aria'], ['beto-reg', 'Beto', 'Bruno']]) {
    const cookie = await registerUser(server.baseUrl, { username, displayName });
    await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns/join', { code: created.body.campaign.inviteCode });
    players.push({ cookie, username, displayName, pcName });
  }
  const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
  try {
    for (const player of players) {
      player.userId = database.prepare('SELECT id FROM users WHERE username = ?').get(player.username).id;
      player.characterId = Number(
        database
          .prepare(
            `INSERT INTO characters (user_id, campaign_id, name, level, hp_max, hp_current, ac, status, kind)
             VALUES (?, ?, ?, 3, 20, 20, 13, 'complete', 'pj')`
          )
          .run(player.userId, campaignId, player.pcName).lastInsertRowid
      );
    }
  } finally {
    database.close();
  }
  const dm = await connectSocket(server, dmCookie);
  await joinRoom(dm, campaignId);
  for (const player of players) {
    player.socket = await connectSocket(server, player.cookie);
    await joinRoom(player.socket, campaignId);
  }
  return { campaignId, dm, players };
}

test('un susurro solo llega al destinatario (y al DM), también al volver a entrar', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const { campaignId, dm, players } = await setupTable(server);
    const [ana, beto] = players;
    const betoMessages = collect(beto.socket, 'chat:new');
    const toAna = waitForEvent(ana.socket, 'chat:new', (message) => message.recipient?.id === ana.userId);
    const toDm = waitForEvent(dm, 'chat:new', (message) => message.recipient?.id === ana.userId);

    // Por el nombre del personaje
    await emitAck(dm, 'chat:send', { campaignId, text: 'Aria El posadero miente.', whisper: true });
    const whisper = await toAna;
    assert.equal(whisper.body, 'El posadero miente.');
    assert.equal(whisper.hidden, true);
    await toDm;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(betoMessages.some((message) => /posadero/.test(String(message.body))), false, 'un tercero no lo recibe');

    // Por el nombre del jugador, y de jugador a jugador
    const toBeto = waitForEvent(beto.socket, 'chat:new', (message) => message.recipient?.id === beto.userId);
    await emitAck(ana.socket, 'chat:send', { campaignId, text: 'Beto cúbreme', whisper: true });
    assert.equal((await toBeto).body, 'cúbreme');
    await assert.rejects(
      emitAck(ana.socket, 'chat:send', { campaignId, text: 'Nadie aquí', whisper: true }),
      /No encuentro a quién susurrar/
    );

    const rejoinBeto = await joinRoom(beto.socket, campaignId);
    assert.equal(rejoinBeto.messages.some((message) => /posadero/.test(String(message.body))), false);
    const rejoinAna = await joinRoom(ana.socket, campaignId);
    assert.ok(rejoinAna.messages.some((message) => /posadero/.test(String(message.body))), 'el destinatario lo conserva');
  } finally {
    await server.stop();
  }
});

test('las reacciones: sobre una tirada pública las ve la mesa; sobre una oculta, nadie más', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const { campaignId, dm, players } = await setupTable(server);
    const [ana, beto] = players;
    const publicRoll = waitForEvent(ana.socket, 'chat:new', (message) => message.type === 'roll');
    await emitAck(dm, 'roll:send', { campaignId, roll: { label: 'PUBLICA', total: 20, groups: [] } });
    const shown = await publicRoll;
    const hiddenRoll = waitForEvent(dm, 'chat:new', (message) => message.type === 'roll' && message.hidden);
    await emitAck(dm, 'roll:send', { campaignId, roll: { label: 'OCULTA', total: 3, groups: [] }, hidden: true });
    const secret = await hiddenRoll;

    const updateForAna = waitForEvent(ana.socket, 'reaccion:actualizada', (payload) => payload.messageId === shown.id);
    await emitAck(beto.socket, 'reaccion:poner', { campaignId, messageId: shown.id, emoji: '🔥' });
    assert.deepEqual((await updateForAna).reactions, { '🔥': [beto.userId] });
    await assert.rejects(
      emitAck(ana.socket, 'reaccion:poner', { campaignId, messageId: shown.id, emoji: '🍕' }),
      /no válida/
    );

    // La oculta no está a la vista del jugador: ni puede reaccionar ni recibe nada
    await assert.rejects(
      emitAck(ana.socket, 'reaccion:poner', { campaignId, messageId: secret.id, emoji: '😱' }),
      /no está a tu vista/
    );
    const betoUpdates = collect(beto.socket, 'reaccion:actualizada');
    await emitAck(dm, 'reaccion:poner', { campaignId, messageId: secret.id, emoji: '💀' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(betoUpdates.length, 0, 'la reacción sobre una tirada oculta no llega a quien no la ve');

    // Quitar la propia reacción
    const cleared = await emitAck(beto.socket, 'reaccion:poner', { campaignId, messageId: shown.id, emoji: null });
    assert.deepEqual(cleared.reactions, {});
  } finally {
    await server.stop();
  }
});

test('el resumen de combate: la mesa ve lo del grupo; los números del enemigo, solo el DM', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const { campaignId, dm, players } = await setupTable(server);
    const [ana] = players;
    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    try {
      database.prepare('UPDATE game_tables SET combat_active = 1, combat_round = 4 WHERE campaign_id = ?').run(campaignId);
    } finally {
      database.close();
    }
    await emitAck(ana.socket, 'roll:send', { campaignId, roll: { kind: 'damage', actorName: 'Aria', label: 'Daño', total: 9, groups: [] } });
    await emitAck(dm, 'roll:send', { campaignId, roll: { kind: 'damage', actorName: 'Goblin', label: 'Daño', total: 4, groups: [] } });
    // Una tirada oculta del DM no cuenta: la mesa no la vio
    await emitAck(dm, 'roll:send', { campaignId, roll: { kind: 'damage', actorName: 'Aria', label: 'Daño', total: 50, groups: [] }, hidden: true });

    const forAna = waitForEvent(ana.socket, 'combate:resumen');
    const forDm = waitForEvent(dm, 'combate:resumen');
    await emitAck(dm, 'combat:end', { campaignId });
    const [playerSummary, dmSummary] = await Promise.all([forAna, forDm]);
    assert.equal(playerSummary.rounds, 4);
    assert.deepEqual(playerSummary.party.map((entry) => [entry.name, entry.damage]), [['Aria', 9]]);
    assert.equal(playerSummary.enemies, undefined, 'los números del enemigo no llegan al jugador');
    assert.deepEqual(dmSummary.enemies.map((entry) => [entry.name, entry.damage]), [['Goblin', 4]]);
  } finally {
    await server.stop();
  }
});
