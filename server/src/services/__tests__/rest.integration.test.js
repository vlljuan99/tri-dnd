// Fase F contra el servidor real: descansos y reloj de campaña. Lo que más
// importa comprobar aquí es que el reloj es de verdad OPCIONAL — con él
// apagado el mismo descanso hace exactamente lo mismo— y que encenderlo o
// apagarlo a mitad de campaña no rompe nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startTestServer, registerUser, apiFetch } from './helpers/liveServer.js';

function seedCompendio(dataDir) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    db.prepare(
      "INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES ('classes', 'wizard', 'Wizard', 'Mago', NULL, ?)"
    ).run(JSON.stringify({ index: 'wizard', hit_die: 6 }));
    db.prepare(
      `INSERT INTO class_levels (class_index, level, prof_bonus, ability_score_bonuses,
         cantrips_known, spells_known, spell_slots, class_specific)
       VALUES ('wizard', 4, 2, 1, 4, NULL, ?, '{}')`
    ).run(JSON.stringify([4, 3, 0, 0, 0, 0, 0, 0, 0]));
  } finally {
    db.close();
  }
}

// Ficha magullada: a media vida, con dados de golpe ya gastados y sin
// espacios de conjuro.
function seedCharacter(dataDir, campaignId, username) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    const userId = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
    return Number(
      db
        .prepare(
          `INSERT INTO characters (user_id, campaign_id, name, class_index, level, abilities,
             hp_max, hp_current, hp_temp, hit_dice_spent, spells, ac, status, kind)
           VALUES (?, ?, 'Elda', 'wizard', 4, ?, 24, 9, 3, 3, ?, 12, 'complete', 'pj')`
        )
        .run(
          userId,
          campaignId,
          JSON.stringify({ str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 }),
          JSON.stringify({ known: [], prepared: [], slots: {}, slotsUsed: { 1: 4 } })
        ).lastInsertRowid
    );
  } finally {
    db.close();
  }
}

test('el descanso largo restaura PG, dados de golpe y espacios', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    seedCompendio(server.dataDir);
    const dm = await registerUser(server.baseUrl, { username: 'dm-descanso', displayName: 'DM' });
    const campaña = await apiFetch(server.baseUrl, dm, 'POST', '/api/campaigns', {
      campaignType: 'campana',
      name: 'Mesa con descansos',
    });
    const campaignId = campaña.body.campaign.id;
    // 3. El reloj nace apagado: ninguna campaña lo estrena encendido.
    assert.equal(campaña.body.campaign.clockEnabled, false);

    const characterId = seedCharacter(server.dataDir, campaignId, 'dm-descanso');

    // Descanso corto: no cura solo, para eso están los dados de golpe.
    const corto = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'corto',
    });
    assert.equal(corto.status, 200, JSON.stringify(corto.body));
    assert.equal(corto.body.clock, null, 'con el reloj apagado el descanso no toca el tiempo');
    const trasCorto = await apiFetch(server.baseUrl, dm, 'GET', `/api/characters/${characterId}`);
    assert.equal(trasCorto.body.character.hp_current, 9, 'el descanso corto por sí solo no cura');
    assert.equal(trasCorto.body.rest.available, 1, 'nivel 4 con 3 gastados');

    // Gastar un dado de golpe: cura la tirada + CON (+2).
    const dados = await apiFetch(server.baseUrl, dm, 'POST', `/api/characters/${characterId}/dados-de-golpe`, {
      rolls: [4],
    });
    assert.equal(dados.status, 200, JSON.stringify(dados.body));
    assert.equal(dados.body.character.hp_current, 15, '9 + (4 + 2)');
    assert.equal(dados.body.hitDice.available, 0);

    const sinDados = await apiFetch(server.baseUrl, dm, 'POST', `/api/characters/${characterId}/dados-de-golpe`, {
      rolls: [3],
    });
    assert.equal(sinDados.status, 400, 'no quedan dados que gastar');

    // 1. Descanso largo: PG al máximo, mitad de los dados y espacios enteros.
    const largo = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'largo',
    });
    assert.equal(largo.status, 200, JSON.stringify(largo.body));
    const trasLargo = await apiFetch(server.baseUrl, dm, 'GET', `/api/characters/${characterId}`);
    assert.equal(trasLargo.body.character.hp_current, 24, 'PG al máximo');
    assert.equal(trasLargo.body.character.hp_temp, 0);
    assert.equal(trasLargo.body.rest.available, 2, '4 gastados − 2 recuperados = 2 disponibles');
    assert.deepEqual(trasLargo.body.character.spells.slots, { 1: 4, 2: 3 }, 'espacios de mago 4');
    assert.deepEqual(trasLargo.body.character.spells.slotsUsed, {}, 'y ninguno gastado');

    const tipoInventado = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'siesta',
    });
    assert.equal(tipoInventado.status, 400);
  } finally {
    await server.stop();
  }
});

test('el reloj es opcional y se enciende a mitad de campaña sin romper nada', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    seedCompendio(server.dataDir);
    const dm = await registerUser(server.baseUrl, { username: 'dm-reloj', displayName: 'DM' });
    const jugadora = await registerUser(server.baseUrl, { username: 'jugadora-reloj', displayName: 'Jugadora' });
    const campaña = await apiFetch(server.baseUrl, dm, 'POST', '/api/campaigns', {
      campaignType: 'campana',
      name: 'Mesa con reloj',
    });
    const campaignId = campaña.body.campaign.id;
    const characterId = seedCharacter(server.dataDir, campaignId, 'dm-reloj');

    // 4. Se enciende con la campaña ya en marcha: el estado anterior sigue.
    const ajeno = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/campaigns/${campaignId}/reloj`, {
      enabled: true,
    });
    assert.equal(ajeno.status, 403, 'el reloj lo ajusta el DM');
    const encender = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/reloj`, {
      enabled: true,
    });
    assert.equal(encender.status, 200, JSON.stringify(encender.body));
    assert.equal(encender.body.clockEnabled, true);
    assert.equal(encender.body.dayMinutes, 480, 'arranca a las 08:00');

    // 2. Un descanso largo avanza 8 h y cruza de día cuando toca.
    const primero = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'largo',
    });
    assert.equal(primero.body.clock.dayMinutes, 16 * 60, '08:00 + 8 h → 16:00');
    assert.equal(primero.body.clock.daysCrossed, 0);

    const segundo = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'largo',
    });
    assert.equal(segundo.body.clock.dayMinutes, 0, '16:00 + 8 h → 00:00');
    assert.equal(segundo.body.clock.daysCrossed, 1, 'y cruza de día');
    assert.equal(segundo.body.clock.elapsedDays, 1);

    const corto = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'corto',
    });
    assert.equal(corto.body.clock.dayMinutes, 60, 'el corto avanza una hora');

    // Apagarlo conserva la hora, y el descanso sigue funcionando igual.
    const apagar = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/reloj`, {
      enabled: false,
    });
    assert.equal(apagar.status, 200);
    const conRelojApagado = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/descanso`, {
      tipo: 'largo',
    });
    assert.equal(conRelojApagado.status, 200, 'el descanso no depende del reloj');
    assert.equal(conRelojApagado.body.clock, null);
    const trasApagar = await apiFetch(server.baseUrl, dm, 'GET', `/api/characters/${characterId}`);
    assert.equal(trasApagar.body.character.hp_current, 24, 'y sigue restaurando');

    const volverAEncender = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/reloj`, {
      enabled: true,
    });
    assert.equal(volverAEncender.body.dayMinutes, 60, 'la hora se conservó mientras estuvo apagado');
  } finally {
    await server.stop();
  }
});
