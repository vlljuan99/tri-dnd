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

// Fase 4c: los dados en manos del jugador. El servidor sigue tirando, pero en
// los momentos que importan espera a que el dueño del PJ pulse «Tirar» (o a
// que venza el plazo). Plazo corto en la prueba para no esperar ocho segundos.
process.env.TRIDND_PLAZO_TIRADA_MS = '1200';

// DM + dos jugadores con un PJ cada uno, todos en la sala.
async function setupTable(server) {
  const dmCookie = await registerUser(server.baseUrl, { username: 'dm-pendientes', displayName: 'DM' });
  const created = await apiFetch(server.baseUrl, dmCookie, 'POST', '/api/campaigns', { campaignType: 'escaramuza' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const campaignId = created.body.campaign.id;
  const inviteCode = created.body.campaign.inviteCode;

  const players = [];
  for (const [username, name, dex] of [['aria-p', 'Aria', 16], ['bruno-p', 'Bruno', 10]]) {
    const cookie = await registerUser(server.baseUrl, { username, displayName: name });
    const joined = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns/join', { code: inviteCode });
    assert.ok([200, 201].includes(joined.status), JSON.stringify(joined.body));
    players.push({ cookie, username, name, dex });
  }

  const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
  try {
    for (const player of players) {
      const user = database.prepare('SELECT id FROM users WHERE username = ?').get(player.username);
      player.userId = user.id;
      player.characterId = Number(
        database
          .prepare(
            `INSERT INTO characters (user_id, campaign_id, name, level, hp_max, hp_current, ac, status, kind, abilities, skill_proficiencies)
             VALUES (?, ?, ?, 3, 20, 20, 13, 'complete', 'pj', ?, '["stealth"]')`
          )
          .run(user.id, campaignId, player.name, JSON.stringify({ str: 10, dex: player.dex, con: 12, int: 10, wis: 10, cha: 10 }))
          .lastInsertRowid
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
  return { campaignId, dm, dmCookie, players };
}

test('tirada de grupo pedida por el DM: cada cual tira la suya, nadie la ajena y sale el resultado colectivo', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const { campaignId, dm, players } = await setupTable(server);
    const [aria, bruno] = players;
    const pendingForDm = collect(dm, 'tirada:pendiente');
    const pendingForAria = collect(aria.socket, 'tirada:pendiente');
    const pendingForBruno = collect(bruno.socket, 'tirada:pendiente');
    const rolls = collect(aria.socket, 'chat:new');

    const groupResult = waitForEvent(
      aria.socket,
      'chat:new',
      (message) => message.type === 'system' && /Tirada de grupo de Sigilo/.test(message.body),
      8000
    );
    const asked = await emitAck(dm, 'tirada:pedir', {
      campaignId,
      tipo: 'prueba',
      habilidad: 'stealth',
      cd: 12,
      revelarCd: true,
      grupal: true,
    });
    assert.equal(asked.count, 2);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // El aviso llega solo al dueño y al DM
    assert.equal(pendingForAria.length, 1);
    assert.equal(pendingForAria[0].characterId, aria.characterId);
    assert.equal(pendingForAria[0].cd, 12, 'la CD revelada viaja con el aviso');
    assert.equal(pendingForBruno.length, 1);
    assert.equal(pendingForDm.length, 2);

    // Bruno no puede tirar la de Aria
    await assert.rejects(
      emitAck(bruno.socket, 'tirada:resolver', { campaignId, id: pendingForAria[0].id }),
      /no es tuya/
    );
    // Aria pulsa; Bruno no hace nada y se le tira sola al vencer el plazo
    await emitAck(aria.socket, 'tirada:resolver', { campaignId, id: pendingForAria[0].id });

    const summary = await groupResult;
    const checkRolls = rolls.filter((message) => message.type === 'roll' && message.body?.label === 'Sigilo');
    assert.equal(checkRolls.length, 2, 'cada PJ tira una vez y la ve toda la mesa');
    for (const message of checkRolls) {
      assert.deepEqual(message.body.outcome.contra, { etiqueta: 'CD', valor: 12 });
      assert.equal(message.body.outcome.resultado, message.body.total >= 12 ? 'supera' : 'no-supera');
    }
    const successes = checkRolls.filter((message) => message.body.total >= 12).length;
    assert.match(summary.body, new RegExp(`${successes} de 2`));
    assert.match(summary.body, successes >= 1 ? /la supera/ : /no la supera/);
    // Aria (DES 16 + competencia 2) tira con +5 a Sigilo
    const ariaRoll = checkRolls.find((message) => message.body.actorName === 'Aria');
    assert.equal(ariaRoll.body.modifier, 5);
    assert.equal(ariaRoll.author.id, aria.userId, 'la firma el jugador que ha pulsado');
  } finally {
    await server.stop();
  }
});

test('con «tirar automáticamente» no hay espera, y la CD oculta no sale del DM', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const { campaignId, dm, players } = await setupTable(server);
    const [aria, bruno] = players;
    const pref = await apiFetch(server.baseUrl, aria.cookie, 'PUT', '/api/auth/preferencias', { autoRolls: true });
    assert.equal(pref.status, 200);
    assert.equal(pref.body.user.autoRolls, true);

    const pendingForAria = collect(aria.socket, 'tirada:pendiente');
    const pendingForBruno = collect(bruno.socket, 'tirada:pendiente');
    const brunoMessages = collect(bruno.socket, 'chat:new');
    const ariaRolled = waitForEvent(
      bruno.socket,
      'chat:new',
      (message) => message.type === 'roll' && message.body?.actorName === 'Aria'
    );
    await emitAck(dm, 'tirada:pedir', { campaignId, tipo: 'salvacion', caracteristica: 'con', cd: 15 });
    const roll = await ariaRolled;
    assert.equal(pendingForAria.length, 0, 'Aria no recibe aviso: se tira al instante');
    assert.equal(roll.body.outcome, undefined, 'sin CD revelada la tirada viaja sin veredicto');
    assert.equal(pendingForBruno.length, 1);
    assert.equal(pendingForBruno[0].cd, null, 'la CD oculta no viaja al jugador');

    // El DM adelanta la de Bruno con «Tirar ya»
    const dmResolved = waitForEvent(dm, 'tirada:resuelta', (payload) => payload.id === pendingForBruno[0].id);
    await emitAck(dm, 'tirada:forzar', { campaignId });
    const resolved = await dmResolved;
    assert.equal(typeof resolved.total, 'number');
    assert.equal(resolved.exito, resolved.total >= 15, 'el DM ve si superó la CD oculta');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const leak = brunoMessages.find(
      (message) => message.type === 'system' && /CD 15/.test(String(message.body))
    );
    assert.equal(leak, undefined, 'el reparto con la CD oculta es una nota privada del DM');
  } finally {
    await server.stop();
  }
});

test('ritual de iniciativa y Ayudar: el turno espera a los jugadores y la ayuda da ventaja una vez', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const { campaignId, dm, players } = await setupTable(server);
    const [aria, bruno] = players;
    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let ariaCombatant;
    let brunoCombatant;
    try {
      for (const player of players) {
        database
          .prepare(
            `INSERT INTO combatants (campaign_id, character_id, kind, name, initiative, death_state)
             VALUES (?, ?, 'pj', ?, 0, 'normal')`
          )
          .run(campaignId, player.characterId, player.name);
      }
      ariaCombatant = database.prepare('SELECT id FROM combatants WHERE character_id = ?').get(aria.characterId).id;
      brunoCombatant = database.prepare('SELECT id FROM combatants WHERE character_id = ?').get(bruno.characterId).id;
    } finally {
      database.close();
    }

    const ariaPending = waitForEvent(aria.socket, 'tirada:pendiente', (payload) => payload.tipo === 'iniciativa');
    const started = waitForEvent(dm, 'combat:state', (state) => state.active && state.turnId != null, 8000);
    const waiting = waitForEvent(
      dm,
      'combat:state',
      (state) => state.active && state.turnId == null && state.combatants.every((c) => c.initiativePending)
    );
    await emitAck(dm, 'combat:start', { campaignId, rerollAll: true });
    await waiting;
    const pending = await ariaPending;
    await emitAck(aria.socket, 'tirada:resolver', { campaignId, id: pending.id });
    const state = await started;
    assert.ok(state.combatants.every((c) => !c.initiativePending), 'todos han tirado');
    assert.ok(state.combatants.every((c) => c.initiativeSource === 'auto'));

    // Que empiece Aria, para que ayude a Bruno
    const helper = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    try {
      helper.prepare('UPDATE combatants SET initiative = 20 WHERE id = ?').run(ariaCombatant);
      helper.prepare('UPDATE combatants SET initiative = 5 WHERE id = ?').run(brunoCombatant);
      helper.prepare('UPDATE game_tables SET combat_turn_id = ? WHERE campaign_id = ?').run(ariaCombatant, campaignId);
      helper.prepare('UPDATE combatants SET action_used = 0 WHERE id = ?').run(ariaCombatant);
    } finally {
      helper.close();
    }
    await assert.rejects(
      emitAck(aria.socket, 'combat:special-action', { campaignId, combatantId: ariaCombatant, kind: 'ayudar', targetId: ariaCombatant }),
      /aliado/
    );
    const helpedState = waitForEvent(dm, 'combat:state', (s) =>
      s.combatants.some((c) => c.id === brunoCombatant && c.helpFrom?.id === ariaCombatant)
    );
    await emitAck(aria.socket, 'combat:special-action', {
      campaignId,
      combatantId: ariaCombatant,
      kind: 'ayudar',
      targetId: brunoCombatant,
    });
    const afterHelp = await helpedState;
    assert.equal(afterHelp.combatants.find((c) => c.id === brunoCombatant).helpFrom.name, 'Aria');

    // La siguiente prueba de Bruno sale con ventaja y gasta la ayuda
    const brunoCheck = waitForEvent(
      dm,
      'chat:new',
      (message) => message.type === 'roll' && message.body?.actorName === 'Bruno'
    );
    await emitAck(dm, 'tirada:pedir', { campaignId, tipo: 'prueba', habilidad: 'athletics', characterIds: [bruno.characterId] });
    await emitAck(dm, 'tirada:forzar', { campaignId });
    const check = await brunoCheck;
    assert.equal(check.body.advantage, 'adv');
    const verify = new Database(path.join(server.dataDir, 'tri-dnd.db'), { readonly: true });
    try {
      assert.equal(verify.prepare('SELECT help_from_id FROM combatants WHERE id = ?').get(brunoCombatant).help_from_id, null);
    } finally {
      verify.close();
    }

    // Una ayuda sin usar vence al empezar el siguiente turno de quien ayudó
    const again = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    try {
      again.prepare('UPDATE combatants SET help_from_id = ? WHERE id = ?').run(ariaCombatant, brunoCombatant);
      again.prepare('UPDATE game_tables SET combat_turn_id = ? WHERE campaign_id = ?').run(brunoCombatant, campaignId);
    } finally {
      again.close();
    }
    await emitAck(dm, 'combat:next', { campaignId }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    const final = new Database(path.join(server.dataDir, 'tri-dnd.db'), { readonly: true });
    try {
      const table = final.prepare('SELECT combat_turn_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      assert.equal(table.combat_turn_id, ariaCombatant);
      assert.equal(final.prepare('SELECT help_from_id FROM combatants WHERE id = ?').get(brunoCombatant).help_from_id, null);
    } finally {
      final.close();
    }
  } finally {
    await server.stop();
  }
});

test('un conjuro de área espera las salvaciones de los PJ y se resuelve una sola vez', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, { username: 'maga-area', displayName: 'Maga' });
    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let casterId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'maga-area'").get();
      casterId = Number(
        setup
          .prepare(
            `INSERT INTO characters (user_id, name, level, hp_max, hp_current, ac, status, kind, class_index, abilities, spells)
             VALUES (?, 'Elara', 5, 28, 28, 12, 'complete', 'pj', 'wizard', ?, ?)`
          )
          .run(
            user.id,
            JSON.stringify({ str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10 }),
            JSON.stringify({ known: [{ index: 'bola-prueba', name: 'Bola de prueba' }], prepared: ['bola-prueba'] })
          ).lastInsertRowid
      );
      setup
        .prepare("INSERT INTO srd_entries (category, idx, name_en, name_es, data) VALUES ('spells', 'bola-prueba', 'Test Ball', 'Bola de prueba', ?)")
        .run(
          JSON.stringify({
            name: 'Bola de prueba',
            level: 3,
            range: '150 feet',
            casting_time: '1 action',
            area_of_effect: { type: 'sphere', size: 10 },
            dc: { dc_type: { index: 'dex' }, dc_success: 'half' },
            damage: { damage_type: { index: 'fire' }, damage_at_slot_level: { 3: '8d6' } },
          })
        );
    } finally {
      setup.close();
    }
    const created = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', {
      campaignType: 'escaramuza',
      presetId: 'paso-del-cuervo',
      characterId: casterId,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaignId = created.body.campaign.id;

    // Un solo bandido a la vista, dos PJ pegados a él y la maga a 20 pies
    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let aim;
    const pjIds = [];
    try {
      const table = database.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      const tokens = database
        .prepare(
          `SELECT t.* FROM map_tokens t JOIN map_rooms r ON r.id = t.room_id
           JOIN map_floors f ON f.id = r.floor_id WHERE f.map_id = ? AND t.kind = 'enemigo' ORDER BY t.id`
        )
        .all(table.active_map_id);
      const [kept, ...rest] = tokens;
      for (const token of rest) {
        database.prepare('DELETE FROM combatants WHERE map_token_id = ?').run(token.id);
        database.prepare('DELETE FROM map_tokens WHERE id = ?').run(token.id);
      }
      const room = database.prepare('SELECT * FROM map_rooms WHERE id = ?').get(kept.room_id);
      // Centro de la explosión con holgura dentro de la sala
      aim = {
        x: Math.min(Math.max(kept.x, room.x + 2), room.x + room.width - 7),
        y: Math.min(Math.max(kept.y, room.y + 2), room.y + room.height - 3),
      };
      database.prepare('UPDATE map_tokens SET x = ?, y = ?, hidden = 0 WHERE id = ?').run(aim.x, aim.y, kept.id);
      database
        .prepare('UPDATE map_character_tokens SET x = ?, y = ?, room_id = ? WHERE map_id = ? AND character_id = ?')
        .run(aim.x + 5, aim.y, room.id, table.active_map_id, casterId);
      const owner = database.prepare("SELECT id FROM users WHERE username = 'maga-area'").get();
      for (const [name, dx, dy] of [['Bruno', 1, 0], ['Cira', 0, 1]]) {
        const id = Number(
          database
            .prepare(
              `INSERT INTO characters (user_id, campaign_id, name, level, hp_max, hp_current, ac, status, kind, abilities)
               VALUES (?, ?, ?, 3, 40, 40, 13, 'complete', 'pj', ?)`
            )
            .run(owner.id, campaignId, name, JSON.stringify({ dex: 12 })).lastInsertRowid
        );
        pjIds.push(id);
        database
          .prepare('INSERT INTO map_character_tokens (map_id, character_id, room_id, x, y) VALUES (?, ?, ?, ?, ?)')
          .run(table.active_map_id, id, room.id, aim.x + dx, aim.y + dy);
      }
      database.prepare('UPDATE game_tables SET combat_active = 0, combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
    } finally {
      database.close();
    }

    const socket = await connectSocket(server, cookie);
    await joinRoom(socket, campaignId);
    const pendings = collect(socket, 'tirada:pendiente');
    const messages = collect(socket, 'chat:new');
    const firstPending = waitForEvent(socket, 'tirada:pendiente', () => true, 5000);

    const cast = emitAck(socket, 'combate:lanzar-conjuro', {
      campaignId,
      characterId: casterId,
      spellIndex: 'bola-prueba',
      aim,
      slotLevel: 3,
    });
    await firstPending;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(pendings.length, 2, 'una salvación pendiente por cada PJ y ninguna para el bandido');
    assert.deepEqual(pendings.map((pending) => pending.characterId).sort(), [...pjIds].sort());
    // Bruno tira; Cira no hace nada y se le tira sola al vencer el plazo
    const bruno = pendings.find((pending) => pending.nombre === 'Bruno');
    await emitAck(socket, 'tirada:resolver', { campaignId, id: bruno.id });

    const result = await cast;
    assert.equal(result.outcomes.length, 3, 'el conjuro se resuelve con las tres salvaciones');
    const rolls = messages.filter((message) => message.type === 'roll');
    const saves = rolls.filter((message) => /Salvación de DEX contra Bola de prueba/.test(message.body.label));
    const names = saves.map((message) => message.body.actorName);
    assert.ok(names.includes('Bruno') && names.includes('Cira'));
    assert.equal(names.filter((name) => !['Bruno', 'Cira'].includes(name)).length, 1, 'y la del bandido');
    assert.equal(saves.length, 3, 'cada salvación sale una sola vez');
    for (const save of saves) assert.equal(save.body.outcome.contra.etiqueta, 'CD');
    const damage = rolls.filter((message) => message.body.kind === 'damage');
    assert.equal(damage.length, 1, 'un único daño para todos');
    const lastSave = Math.max(...saves.map((message) => rolls.indexOf(message)));
    assert.ok(rolls.indexOf(damage[0]) > lastSave, 'el daño se tira cuando han llegado todas las salvaciones');
  } finally {
    await server.stop();
  }
});
