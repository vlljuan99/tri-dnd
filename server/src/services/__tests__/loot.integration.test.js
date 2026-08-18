// Fase E de la rebanada vertical: saquear un cofre es una transferencia
// transaccional del servidor. Se comprueba contra el servidor REAL porque lo
// que importa es justo lo que no se ve desde una prueba unitaria: que el
// objeto no se duplique al saquear dos veces y que llegue a la ficha con sus
// datos de arma, listo para equiparse.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startTestServer, registerUser, apiFetch } from './helpers/liveServer.js';

const ESPADA_LARGA = {
  index: 'longsword',
  name: 'Longsword',
  equipment_category: { index: 'weapon' },
  weapon_category: 'Martial',
  weapon_range: 'Melee',
  damage: { damage_dice: '1d8', damage_type: { index: 'slashing' } },
  two_handed_damage: { damage_dice: '1d10', damage_type: { index: 'slashing' } },
  properties: [{ index: 'versatile' }],
  range: { normal: 5 },
};

// Deja el tablero listo: compendio con la espada, personaje del jugador en el
// mapa activo y un cofre con la espada dentro, en la casilla de al lado.
function seedTablero(dataDir, campaignId, userId) {
  const db = new Database(path.join(dataDir, 'tri-dnd.db'));
  try {
    db.prepare(
      "INSERT INTO srd_entries (category, idx, name_en, name_es, desc_es, data) VALUES ('equipment', 'longsword', 'Longsword', 'Espada larga', NULL, ?)"
    ).run(JSON.stringify(ESPADA_LARGA));

    const mapId = db.prepare('SELECT active_map_id FROM game_tables WHERE campaign_id = ?').get(campaignId).active_map_id;
    const roomId = db
      .prepare(
        `SELECT r.id FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id WHERE f.map_id = ? ORDER BY r.id LIMIT 1`
      )
      .get(mapId).id;

    const characterId = Number(
      db
        .prepare(
          `INSERT INTO characters (user_id, campaign_id, name, level, hp_max, hp_current, ac, status, kind)
           VALUES (?, ?, 'Saqueadora', 1, 10, 10, 12, 'complete', 'pj')`
        )
        .run(userId, campaignId).lastInsertRowid
    );
    db.prepare('INSERT INTO map_character_tokens (map_id, character_id, room_id, x, y) VALUES (?, ?, ?, 2, 2)').run(
      mapId,
      characterId,
      roomId
    );
    const tokenId = Number(
      db
        .prepare(
          `INSERT INTO map_tokens (room_id, kind, name, x, y, hidden, loot)
           VALUES (?, 'objeto', 'Cofre del vestíbulo', 3, 2, 0, ?)`
        )
        .run(roomId, JSON.stringify([{ name: 'Longsword', source: 'srd', index: 'longsword', qty: 1 }]))
        .lastInsertRowid
    );
    return { characterId, tokenId };
  } finally {
    db.close();
  }
}

test('saquear un cofre transfiere el arma una sola vez y con sus datos', { timeout: 30000 }, async () => {
  const server = await startTestServer();
  try {
    const cookie = await registerUser(server.baseUrl, { username: 'saqueadora', displayName: 'Saqueadora' });
    const campaign = await apiFetch(server.baseUrl, cookie, 'POST', '/api/campaigns', {
      campaignType: 'escaramuza',
      name: 'Mesa de prueba',
    });
    assert.equal(campaign.status, 201, JSON.stringify(campaign.body));
    const campaignId = campaign.body.campaign.id;

    const { characterId, tokenId } = seedTablero(server.dataDir, campaignId, campaign.body.campaign.dm_user_id ?? 1);

    const primero = await apiFetch(server.baseUrl, cookie, 'POST', `/api/campaigns/${campaignId}/marcadores/${tokenId}/saquear`, {
      characterId,
    });
    assert.equal(primero.status, 200, JSON.stringify(primero.body));
    assert.deepEqual(primero.body.looted, [{ name: 'Espada larga', qty: 1, equipable: true }]);

    // Segundo saqueo del mismo cofre: ya no queda nada, y no duplica.
    const segundo = await apiFetch(server.baseUrl, cookie, 'POST', `/api/campaigns/${campaignId}/marcadores/${tokenId}/saquear`, {
      characterId,
    });
    assert.equal(segundo.status, 404, 'el cofre vacío deja de ofrecer saqueo');

    const ficha = await apiFetch(server.baseUrl, cookie, 'GET', `/api/characters/${characterId}`);
    const espadas = ficha.body.character.inventory.filter((item) => item.srdIndex === 'longsword');
    assert.equal(espadas.length, 1, 'el objeto no se duplica');
    assert.equal(espadas[0].name, 'Espada larga', 'llega con el nombre traducido del compendio');
    assert.equal(espadas[0].slot, null, 'entra en la mochila, no equipada sola');
    assert.equal(espadas[0].weapon.damageDice, '1d8');
    assert.equal(espadas[0].weapon.versatileDice, '1d10', 'y con el dado de dos manos, para poder empuñarla');
    assert.deepEqual(espadas[0].weapon.properties, ['versatile']);

    // Y se puede equipar sin volver a buscarla en el compendio.
    const equipada = await apiFetch(server.baseUrl, cookie, 'PUT', `/api/characters/${characterId}`, {
      inventory: ficha.body.character.inventory.map((item) =>
        item.srdIndex === 'longsword' ? { ...item, slot: 'mano-principal' } : item
      ),
    });
    assert.equal(equipada.status, 200, JSON.stringify(equipada.body));
    assert.equal(
      equipada.body.character.inventory.find((item) => item.srdIndex === 'longsword').slot,
      'mano-principal'
    );
  } finally {
    await server.stop();
  }
});
