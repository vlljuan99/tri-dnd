import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '../../..');

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealth(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`El servidor terminó antes de arrancar:\n${logs.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // El puerto todavía no está escuchando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`El servidor no respondió a tiempo:\n${logs.join('')}`);
}

async function stopChild(child) {
  if (child.exitCode != null) return;
  child.kill();
  await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('El servidor de prueba no terminó')), 5000)),
  ]);
}

test('crear un escenario sin DM asigna el PJ y arranca la iniciativa', { timeout: 30000 }, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tridnd-skirmish-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      JWT_SECRET: 'secreto-solo-para-la-prueba-de-integracion',
      TRIDND_DATA_DIR: dataDir,
      APP_VERSION: 'prueba',
      GIT_SHA: 'sha-prueba',
      BUILD_TIME: '2026-08-13T12:00:00Z',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    const health = await waitForHealth(baseUrl, child, logs);
    assert.equal(health.ok, true);
    assert.equal(health.commit, 'sha-prueba');
    assert.equal(health.version, 'prueba');
    assert.equal(health.database.ok, true);
    // Sube con cada migración nueva (la v78 enlaza cada mapa con su escenario).
    assert.equal(health.database.migration, 78);

    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'dm-integracion', displayName: 'DM Integración', password: 'segura123' }),
    });
    assert.equal(register.status, 201, await register.text());
    const cookie = register.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'el registro debe crear la cookie de sesión');

    const setupDatabase = new Database(path.join(dataDir, 'tri-dnd.db'));
    const characterIds = [];
    try {
      const userId = setupDatabase.prepare("SELECT id FROM users WHERE username = 'dm-integracion'").get().id;
      for (const [index, name] of ['Alda', 'Borin', 'Cira'].entries()) {
        const character = setupDatabase
          .prepare(
            `INSERT INTO characters (user_id, name, level, hp_max, hp_current, hp_temp, ac, status, kind)
             VALUES (?, ?, 4, 36, ?, ?, 16, 'complete', 'pj')`
          )
          // La primera ficha reproduce el caso real: quedó inconsciente y con
          // PG temporales en una partida anterior antes de volver al Hub.
          .run(userId, name, index === 0 ? 0 : 36, index === 0 ? 8 : 0);
        characterIds.push(Number(character.lastInsertRowid));
      }
    } finally {
      setupDatabase.close();
    }

    const presetsResponse = await fetch(`${baseUrl}/api/campaigns/escaramuzas/predefinidas`, {
      headers: { Cookie: cookie },
    });
    assert.equal(presetsResponse.status, 200);
    const { presets } = await presetsResponse.json();
    assert.equal(presets.length, 3);
    assert.ok(presets.every((preset) => preset.soloMode === true));

    const missingCharacter = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ campaignType: 'escaramuza', presetId: presets[0].id }),
    });
    assert.equal(missingCharacter.status, 400, 'un escenario sin DM no debe nacer sin aventurero');

    const campaigns = [];
    for (const [index, preset] of presets.entries()) {
      const createResponse = await fetch(`${baseUrl}/api/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          campaignType: 'escaramuza',
          presetId: preset.id,
          characterId: characterIds[index],
        }),
      });
      const createBody = await createResponse.text();
      assert.equal(createResponse.status, 201, createBody);
      const { campaign } = JSON.parse(createBody);
      assert.equal(campaign.role, 'jugador');
      assert.equal(campaign.owner, true);
      assert.equal(campaign.soloMode, true);
      assert.equal(campaign.inviteCode, null);
      const playerMapResponse = await fetch(
        `${baseUrl}/api/campaigns/${campaign.id}/mapa-activo`,
        { headers: { Cookie: cookie } }
      );
      assert.equal(playerMapResponse.status, 200);
      const playerMap = (await playerMapResponse.json()).map;
      assert.ok(playerMap?.floors?.length, 'el aventurero debe recibir el tablero');
      // El aspecto del terreno viaja con el tablero: el desfiladero es natural
      // y la cripta y la fundición son obra de cantería.
      assert.equal(playerMap.terrainStyle, preset.id === 'paso-del-cuervo' ? 'natural' : 'construido');
      assert.ok(
        playerMap.floors.flatMap((floor) => floor.rooms).every((room) => room.notes === ''),
        'ni el propietario técnico debe recibir notas privadas del mapa'
      );
      const forbiddenAdmin = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/mapas`, {
        headers: { Cookie: cookie },
      });
      assert.equal(forbiddenAdmin.status, 403, 'el modo solitario no debe conservar acceso al editor del DM');
      campaigns.push({ ...campaign, characterId: characterIds[index] });
    }

    const database = new Database(path.join(dataDir, 'tri-dnd.db'));
    try {
      let totalPreparedEnemies = 0;
      for (const campaign of campaigns) {
        const table = database
          .prepare('SELECT combat_active, combat_turn_id, active_map_id, enemy_ai_enabled FROM game_tables WHERE campaign_id = ?')
          .get(campaign.id);
        const combatants = database
          .prepare('SELECT id, kind, character_id, initiative_source FROM combatants WHERE campaign_id = ? ORDER BY id')
          .all(campaign.id);
        const visibleEnemies = database
          .prepare(
            `SELECT COUNT(*) AS total FROM map_tokens token
             JOIN map_rooms room ON room.id = token.room_id
             JOIN map_floors floor ON floor.id = room.floor_id
             JOIN maps map ON map.id = floor.map_id
             WHERE map.campaign_id = ? AND room.revealed = 1
               AND token.kind = 'enemigo' AND token.hidden = 0`
          )
          .get(campaign.id).total;

        assert.equal(table.combat_active, 1, 'el modo por turnos sigue preparado por defecto');
        assert.equal(table.enemy_ai_enabled, 1, 'los escenarios de fábrica deben activar la IA enemiga');
        assert.ok(table.combat_turn_id, 'el orden debe tener un turno activo desde el inicio');
        assert.ok(table.active_map_id, 'el escenario debe quedar como tablero activo');
        assert.equal(combatants.length, visibleEnemies + 1, 'el tracker debe contener enemigos y el PJ elegido');
        assert.ok(combatants.every((entry) => entry.initiative_source === 'auto'));
        const playerCombatant = combatants.find(
          (entry) => entry.kind === 'pj' && entry.character_id === campaign.characterId
        );
        assert.ok(playerCombatant, 'el PJ elegido debe entrar en iniciativa');
        assert.equal(table.combat_turn_id, playerCombatant.id, 'el PJ debe tener siempre el primer turno');
        const character = database
          .prepare('SELECT campaign_id, hp_current, hp_max, hp_temp FROM characters WHERE id = ?')
          .get(campaign.characterId);
        assert.equal(character.campaign_id, campaign.id);
        assert.equal(character.hp_current, character.hp_max, 'el escenario debe recuperar al PJ por completo');
        assert.equal(character.hp_temp, 0, 'los PG temporales de otra partida no deben heredarse');
        const persistedCampaign = database
          .prepare('SELECT solo_mode, lore, objectives FROM campaigns WHERE id = ?')
          .get(campaign.id);
        assert.equal(persistedCampaign.solo_mode, 1);
        assert.ok(persistedCampaign.lore, 'el director debe presentar la situación inicial');
        assert.ok(JSON.parse(persistedCampaign.objectives).length >= 2, 'la prueba necesita objetivos públicos');
        const intro = database
          .prepare("SELECT body FROM chat_messages WHERE campaign_id = ? AND type = 'system' ORDER BY id LIMIT 1")
          .get(campaign.id);
        assert.match(intro?.body ?? '', /^Director automático:/);
        const token = database
          .prepare('SELECT id FROM map_character_tokens WHERE map_id = ? AND character_id = ?')
          .get(table.active_map_id, campaign.characterId);
        assert.ok(token, 'el PJ elegido debe aparecer en el tablero');
        totalPreparedEnemies += combatants.filter((entry) => entry.kind === 'enemigo').length;
      }
      assert.ok(totalPreparedEnemies > 0, 'el catálogo debe incluir encuentros preparados');

      // Regresión del hotfix de producción: mover un PJ debe consultar los
      // efectos de fluido del mapa activo, no una variable inexistente.
      const firstCampaign = campaigns[0];
      const player = database
        .prepare(
          `SELECT token.x, token.y, token.room_id, combatant.id AS combatant_id
             FROM map_character_tokens token
             JOIN combatants combatant ON combatant.character_id = token.character_id
            WHERE token.character_id = ? AND combatant.campaign_id = ?`
        )
        .get(firstCampaign.characterId, firstCampaign.id);
      assert.ok(player, 'el escenario de prueba debe tener PJ y combatiente');
      database
        .prepare('UPDATE game_tables SET combat_turn_id = ? WHERE campaign_id = ?')
        .run(player.combatant_id, firstCampaign.id);
      const room = database.prepare('SELECT * FROM map_rooms WHERE id = ?').get(player.room_id);
      const blocked = new Set([
        ...JSON.parse(room.disabled_cells || '[]'),
        ...JSON.parse(room.obstacle_cells || '[]'),
      ].map(([x, y]) => `${x},${y}`));
      const destination = [
        [player.x + 1, player.y],
        [player.x - 1, player.y],
        [player.x, player.y + 1],
        [player.x, player.y - 1],
      ].find(([x, y]) =>
        x >= room.x && x < room.x + room.width &&
        y >= room.y && y < room.y + room.height &&
        !blocked.has(`${x - room.x},${y - room.y}`)
      );
      assert.ok(destination, 'el PJ debe tener una casilla contigua disponible');
      const moveResponse = await fetch(
        `${baseUrl}/api/campaigns/${firstCampaign.id}/mapa-activo/personajes/${firstCampaign.characterId}/mover`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ x: destination[0], y: destination[1] }),
        }
      );
      assert.equal(moveResponse.status, 200, await moveResponse.text());
    } finally {
      database.close();
    }

    // El DM elige el aspecto del terreno de su mapa; se valida en el servidor
    // y se conserva al guardarlo como plantilla y volver a instanciarlo.
    const json = { 'Content-Type': 'application/json', Cookie: cookie };
    const ownCampaignResponse = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ campaignType: 'escaramuza', name: 'Mesa de pruebas' }),
    });
    assert.equal(ownCampaignResponse.status, 201, await ownCampaignResponse.clone().text());
    const ownCampaign = (await ownCampaignResponse.json()).campaign;
    const mapsUrl = `${baseUrl}/api/campaigns/${ownCampaign.id}/mapas`;
    const created = await fetch(mapsUrl, { method: 'POST', headers: json, body: JSON.stringify({ name: 'Sótano' }) });
    assert.equal(created.status, 201);
    const blankMap = (await created.json()).map;
    assert.equal(blankMap.terrainStyle, 'construido', 'un mapa nuevo nace construido');
    const invalid = await fetch(`${mapsUrl}/${blankMap.id}`, {
      method: 'PATCH', headers: json, body: JSON.stringify({ terrainStyle: 'marmol' }),
    });
    assert.equal(invalid.status, 400);
    const patched = await fetch(`${mapsUrl}/${blankMap.id}`, {
      method: 'PATCH', headers: json, body: JSON.stringify({ terrainStyle: 'natural' }),
    });
    assert.equal(patched.status, 200);
    const patchedMap = (await patched.json()).map;
    assert.equal(patchedMap.terrainStyle, 'natural');
    assert.equal(patchedMap.wallColor, blankMap.wallColor, 'cambiar el aspecto no toca el color');
    const saved = await fetch(`${mapsUrl}/${blankMap.id}/guardar-plantilla`, {
      method: 'POST', headers: json, body: JSON.stringify({ name: 'Sótano natural' }),
    });
    assert.equal(saved.status, 201);
    const { template } = await saved.json();
    const copy = await fetch(`${mapsUrl}/desde-plantilla`, {
      method: 'POST', headers: json, body: JSON.stringify({ templateId: template.id }),
    });
    assert.equal(copy.status, 201, await copy.clone().text());
    assert.equal((await copy.json()).map.terrainStyle, 'natural');
  } finally {
    await stopChild(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
