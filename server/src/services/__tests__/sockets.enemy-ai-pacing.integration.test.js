import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BEATS } from '../turnPacing.js';
import {
  apiFetch,
  connectSocket,
  joinRoom,
  registerUser,
  startTestServer,
  waitForEvent,
} from './helpers/liveServer.js';

// El resto de las pruebas corre con el ritmo apagado (`NODE_ENV=test`), para no
// depender de relojes. Esta es la excepción a propósito: enciende los tiempos a
// una fracción de su duración y comprueba que el turno automático llega a la
// mesa POR TRAMOS y en orden, en vez de de golpe. `TRIDND_TURN_PACE` tiene
// prioridad sobre NODE_ENV justo para esto, y el helper hereda `process.env`,
// así que basta con ponerlo antes de arrancar el servidor. `node --test` da un
// proceso por fichero, así que esto no afecta a las demás pruebas.
const FACTOR = 0.35;
process.env.TRIDND_TURN_PACE = String(FACTOR);

// Margen generoso hacia abajo: lo que se valida es que la espera EXISTE, no su
// duración exacta, que depende de la máquina.
const TOLERANCIA = 0.55;
const esperaMinima = (beat) => Math.round(BEATS[beat] * FACTOR * TOLERANCIA);

test('el turno de la IA enemiga llega por tramos y en orden', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, {
      username: 'dm-ritmo',
      displayName: 'DM Ritmo',
    });
    const setup = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let characterId;
    try {
      const user = setup.prepare("SELECT id FROM users WHERE username = 'dm-ritmo'").get();
      const character = setup
        .prepare(
          `INSERT INTO characters (user_id, name, level, hp_max, hp_current, ac, status, kind)
           VALUES (?, 'Brisa', 4, 40, 40, 14, 'complete', 'pj')`
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
    let enemyCombatantId;
    let pjCombatantId;
    try {
      const table = database
        .prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?')
        .get(campaignId);
      const enemy = database
        .prepare(
          `SELECT combatant.id, combatant.map_token_id, token.room_id, token.x, token.y
           FROM combatants combatant JOIN map_tokens token ON token.id = combatant.map_token_id
           WHERE combatant.campaign_id = ? AND combatant.kind = 'enemigo' LIMIT 1`
        )
        .get(campaignId);
      assert.ok(enemy);
      enemyCombatantId = enemy.id;

      // Autómata con multiataque: dos golpes en el mismo turno, para que además
      // se pueda comprobar que los ataques no se publican simultáneamente.
      const monster = {
        name: 'Autómata de ritmo',
        speed: { walk: '30 ft.' },
        actions: [
          {
            // Los datos del SRD llegan en inglés: `buildMultiattackPlans` busca
            // la acción por el nombre literal "multiattack".
            name: 'Multiattack',
            desc: 'El autómata hace dos ataques con su Golpe medido.',
            multiattack_type: 'actions',
            actions: [{ action_name: 'Golpe medido', count: 2, type: 'melee' }],
          },
          {
            name: 'Golpe medido',
            attack_bonus: 100,
            desc: 'Melee Weapon Attack: reach 5 ft., one target.',
            damage: [{ damage_dice: '1d4', damage_type: { index: 'bludgeoning' } }],
          },
        ],
      };
      database
        .prepare(
          `INSERT INTO srd_entries (category, idx, name_en, name_es, data)
           VALUES ('monsters', 'automata-ritmo', 'Rhythm Automaton', 'Autómata de ritmo', ?)`
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
          `UPDATE combatants SET name = 'Autómata de ritmo', monster_index = 'automata-ritmo',
             initiative = 20, hp_current = 20, hp_max = 20, ac = 12
           WHERE id = ?`
        )
        .run(enemy.id);
      database
        .prepare("UPDATE map_tokens SET name = 'Autómata de ritmo', monster_index = 'automata-ritmo' WHERE id = ?")
        .run(enemy.map_token_id);
      // El PJ en la misma casilla que el enemigo: sin recorrido, el turno se
      // reduce a los tramos de ataque y cierre, que son los que se miden aquí.
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
    // Todo se registra ANTES de unirse a la sala: el turno de la IA arranca al
    // entrar y si no, se perderían los primeros eventos.
    const sellos = {};
    const marca = (nombre) => {
      if (sellos[nombre] == null) sellos[nombre] = Date.now();
    };
    socket.on('combat:acting', () => marca('acting'));
    const ataques = [];
    socket.on('chat:new', (message) => {
      if (message.type === 'roll' && message.body?.kind === 'attack') {
        ataques.push(Date.now());
        marca('primerAtaque');
        if (ataques.length >= 2) marca('segundoAtaque');
      }
    });

    const anuncio = waitForEvent(socket, 'combat:acting', (payload) => payload.combatantId === enemyCombatantId, 8000);
    const turnoDelPj = waitForEvent(socket, 'combat:state', (state) => state.turnId === pjCombatantId, 12000);
    await joinRoom(socket, campaignId);
    let anunciado;
    try {
      anunciado = await anuncio;
      await turnoDelPj;
    } catch (error) {
      throw new Error(`${error.message}\n${server.logs.join('')}`);
    }
    marca('turnoDelPj');

    assert.equal(anunciado.combatantId, enemyCombatantId, 'se anuncia qué enemigo actúa');
    assert.ok(
      !('x' in anunciado) && !('y' in anunciado) && !('position' in anunciado),
      'el anuncio no debe llevar posición: revelaría por dónde anda un enemigo que el jugador quizá no ve'
    );

    // Orden de los tramos.
    assert.ok(sellos.acting <= sellos.primerAtaque, 'se anuncia el turno antes de atacar');
    assert.ok(sellos.primerAtaque <= sellos.turnoDelPj, 'el ataque llega antes de que pase el turno');

    // Y que entre tramos hay espera de verdad, no una ráfaga.
    const telegrafia = sellos.primerAtaque - sellos.acting;
    assert.ok(
      telegrafia >= esperaMinima('telegrafia'),
      `entre el anuncio y el ataque pasaron ${telegrafia}ms, se esperaban al menos ${esperaMinima('telegrafia')}ms`
    );
    const cierre = sellos.turnoDelPj - sellos.primerAtaque;
    assert.ok(
      cierre >= esperaMinima('antesDeCerrar'),
      `entre el ataque y el cambio de turno pasaron ${cierre}ms, se esperaban al menos ${esperaMinima('antesDeCerrar')}ms`
    );

    // Multiataque: los dos golpes no caen en el mismo instante.
    assert.ok(ataques.length >= 2, `el multiataque debe publicar dos ataques, llegaron ${ataques.length}`);
    const entreGolpes = sellos.segundoAtaque - sellos.primerAtaque;
    assert.ok(
      entreGolpes >= esperaMinima('entreAtaques'),
      `entre los dos golpes pasaron ${entreGolpes}ms, se esperaban al menos ${esperaMinima('entreAtaques')}ms`
    );
  } finally {
    await server.stop();
  }
});
