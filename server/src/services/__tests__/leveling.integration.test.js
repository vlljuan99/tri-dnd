// Fase D contra el servidor real: el nivel de un PJ no lo escribe nadie a
// mano, lo concede el DM y lo completa el jugador. Aquí se comprueban los
// cinco criterios de la fase de punta a punta, incluida la ficha del DM, que
// sigue con el nivel libre.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startTestServer, registerUser, apiFetch } from './helpers/liveServer.js';

// Compendio mínimo: guerrero (d10, sin magia) y mago (d6, con espacios).
function seedCompendio(dataDir) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    const clase = db.prepare(
      "INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES ('classes', ?, ?, ?, NULL, ?)"
    );
    clase.run('fighter', 'Fighter', 'Guerrero', JSON.stringify({ index: 'fighter', hit_die: 10 }));
    clase.run('wizard', 'Wizard', 'Mago', JSON.stringify({ index: 'wizard', hit_die: 6 }));

    const nivel = db.prepare(
      `INSERT INTO class_levels (class_index, level, prof_bonus, ability_score_bonuses,
         cantrips_known, spells_known, spell_slots, class_specific)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, '{}')`
    );
    nivel.run('fighter', 1, 2, 0, '[]');
    nivel.run('fighter', 2, 2, 0, '[]');
    nivel.run('wizard', 1, 2, 0, JSON.stringify([2, 0, 0, 0, 0, 0, 0, 0, 0]));
    nivel.run('wizard', 2, 2, 0, JSON.stringify([3, 0, 0, 0, 0, 0, 0, 0, 0]));
  } finally {
    db.close();
  }
}

// Personaje completo listo para jugar, saltándose el asistente.
function seedCharacter(dataDir, { userId, campaignId, name, classIndex, hpMax, con }) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    return Number(
      db
        .prepare(
          `INSERT INTO characters (user_id, campaign_id, name, class_index, level, abilities,
             hp_max, hp_current, ac, status, kind)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, 12, 'complete', 'pj')`
        )
        .run(
          userId,
          campaignId,
          name,
          classIndex,
          JSON.stringify({ str: 16, dex: 12, con, int: 15, wis: 10, cha: 8 }),
          hpMax,
          hpMax
        ).lastInsertRowid
    );
  } finally {
    db.close();
  }
}

function userId(dataDir, username) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'), { readonly: true });
  try {
    return db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  } finally {
    db.close();
  }
}

test('el nivel lo concede el DM y lo completa el jugador', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    seedCompendio(server.dataDir);
    const dm = await registerUser(server.baseUrl, { username: 'dama', displayName: 'DM' });
    const jugadora = await registerUser(server.baseUrl, { username: 'jugadora', displayName: 'Jugadora' });

    const campaña = await apiFetch(server.baseUrl, dm, 'POST', '/api/campaigns', {
      campaignType: 'campana',
      name: 'Mesa de milestone',
    });
    assert.equal(campaña.status, 201, JSON.stringify(campaña.body));
    const campaignId = campaña.body.campaign.id;
    assert.equal(campaña.body.campaign.startingLevel, 1);
    assert.equal(campaña.body.campaign.grantedLevel, 1);
    assert.equal(campaña.body.campaign.levelMode, 'milestone');

    const codigo = campaña.body.campaign.inviteCode;
    const unirse = await apiFetch(server.baseUrl, jugadora, 'POST', '/api/campaigns/join', { code: codigo });
    assert.equal(unirse.status, 201, JSON.stringify(unirse.body));

    const guerreroId = seedCharacter(server.dataDir, {
      userId: userId(server.dataDir, 'jugadora'),
      campaignId,
      name: 'Brunilda',
      classIndex: 'fighter',
      hpMax: 12,
      con: 14,
    });

    // 1. Un jugador no puede cambiar su nivel por ningún camino de la API.
    const aMano = await apiFetch(server.baseUrl, jugadora, 'PUT', `/api/characters/${guerreroId}`, { level: 12 });
    assert.equal(aMano.status, 400, 'el PUT no admite el nivel de un PJ');
    const subirSinPermiso = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/characters/${guerreroId}/subir-nivel`, {});
    assert.equal(subirSinPermiso.status, 400, 'sin nivel concedido no se sube');
    assert.match(subirSinPermiso.body.error, /no ha concedido/);

    const ajena = await apiFetch(server.baseUrl, dm, 'POST', `/api/characters/${guerreroId}/subir-nivel`, {});
    assert.equal(ajena.status, 403, 'ni siquiera el DM sube la ficha de otro');

    // 2. El DM concede el nivel 2.
    const concedeJugadora = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/campaigns/${campaignId}/nivel`, {});
    assert.equal(concedeJugadora.status, 403, 'un jugador no concede niveles');
    const concede = await apiFetch(server.baseUrl, dm, 'POST', `/api/campaigns/${campaignId}/nivel`, {});
    assert.equal(concede.status, 200, JSON.stringify(concede.body));
    assert.equal(concede.body.grantedLevel, 2);

    const fichaAntes = await apiFetch(server.baseUrl, jugadora, 'GET', `/api/characters/${guerreroId}`);
    assert.equal(fichaAntes.body.character.level, 1, 'conceder no sube fichas solo');
    assert.equal(fichaAntes.body.leveling.canLevelUp, true);
    assert.equal(fichaAntes.body.leveling.preview.hpFixed, 8, 'd10 → 6 + 2 de CON');

    // 3. Un guerrero gana PG coherentes con su dado de golpe y su CON.
    const subida = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/characters/${guerreroId}/subir-nivel`, {
      hpMethod: 'fijo',
    });
    assert.equal(subida.status, 200, JSON.stringify(subida.body));
    assert.equal(subida.body.character.level, 2);
    assert.equal(subida.body.character.hp_max, 20, '12 + 8');
    assert.equal(subida.body.gained.hpGained, 8);
    assert.deepEqual(subida.body.history[0].toLevel, 2, 'la subida queda en el histórico');

    const otraVez = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/characters/${guerreroId}/subir-nivel`, {});
    assert.equal(otraVez.status, 400, 'no se encadenan dos subidas con un solo nivel concedido');

    // 4. Un mago que sube a nivel 2 gana el espacio de conjuro que le toca.
    const magoId = seedCharacter(server.dataDir, {
      userId: userId(server.dataDir, 'jugadora'),
      campaignId,
      name: 'Elda',
      classIndex: 'wizard',
      hpMax: 8,
      con: 12,
    });
    const subidaMago = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/characters/${magoId}/subir-nivel`, {
      hpMethod: 'tirada',
      hpRoll: 5,
    });
    assert.equal(subidaMago.status, 200, JSON.stringify(subidaMago.body));
    assert.equal(subidaMago.body.character.hp_max, 14, '8 + (5 de tirada + 1 de CON)');
    assert.deepEqual(subidaMago.body.character.spells.slots, { 1: 3 }, 'mago 2 → 3 espacios de nivel 1');

    const tiradaImposible = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/characters/${magoId}/subir-nivel`, {
      hpMethod: 'tirada',
      hpRoll: 20,
    });
    assert.equal(tiradaImposible.status, 400, 'un d6 no saca 20');

    // La mejora de característica se anota como su propia fuente: la ficha
    // desglosa «base + raza + mejora» y ese desglose tiene que cuadrar.
    const conMejora = await apiFetch(server.baseUrl, jugadora, 'POST', `/api/characters/${guerreroId}/subir-nivel`, {
      abilityIncreases: { str: 1 },
    });
    assert.equal(conMejora.status, 400, 'el nivel 2 del guerrero no concede mejora');

    // 5. La ficha del DM conserva el nivel editable a mano.
    const jefe = await apiFetch(server.baseUrl, dm, 'POST', '/api/characters', { name: 'Archilich', kind: 'boss' });
    assert.equal(jefe.status, 201);
    const nivelJefe = await apiFetch(server.baseUrl, dm, 'PUT', `/api/characters/${jefe.body.character.id}`, {
      level: 17,
    });
    assert.equal(nivelJefe.status, 200, JSON.stringify(nivelJefe.body));
    assert.equal(nivelJefe.body.character.level, 17);
  } finally {
    await server.stop();
  }
});

test('el nivel inicial de la campaña fija el del personaje en creación', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, { username: 'veterana', displayName: 'Veterana' });
    const campaña = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', {
      campaignType: 'campana',
      name: 'Mesa avanzada',
    });
    const campaignId = campaña.body.campaign.id;
    const ajuste = await apiFetch(server.baseUrl, cookie, 'PATCH', `/api/campaigns/${campaignId}`, {
      startingLevel: 5,
    });
    assert.equal(ajuste.status, 200, JSON.stringify(ajuste.body));
    assert.equal(ajuste.body.campaign.startingLevel, 5);
    assert.equal(ajuste.body.campaign.grantedLevel, 5, 'el techo sube con el nivel inicial');

    const nuevo = await apiFetch(server.baseUrl, cookie, 'POST', '/api/characters', { name: 'Aprendiz' });
    const id = nuevo.body.character.id;
    const vinculado = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, {
      campaign_id: campaignId,
    });
    assert.equal(vinculado.status, 200, JSON.stringify(vinculado.body));
    assert.equal(vinculado.body.character.level, 5, 'el borrador toma el nivel inicial de la mesa');

    // Una ficha ya terminada no se recalcula al cambiar de mesa.
    await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, {
      class_index: 'fighter',
      race_index: 'human',
      status: 'complete',
    });
    const otra = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', {
      campaignType: 'campana',
      name: 'Mesa de nivel 1',
    });
    const movido = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${id}`, {
      campaign_id: otra.body.campaign.id,
    });
    assert.equal(movido.body.character.level, 5, 'entra con el suyo, no baja al nivel inicial de la mesa nueva');
  } finally {
    await server.stop();
  }
});
