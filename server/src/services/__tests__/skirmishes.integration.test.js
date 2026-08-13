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
    assert.equal(health.database.migration, 66);

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
      for (const name of ['Alda', 'Borin', 'Cira']) {
        const character = setupDatabase
          .prepare(
            `INSERT INTO characters (user_id, name, level, hp_max, hp_current, ac, status, kind)
             VALUES (?, ?, 4, 36, 36, 16, 'complete', 'pj')`
          )
          .run(userId, name);
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

    const database = new Database(path.join(dataDir, 'tri-dnd.db'), { readonly: true });
    try {
      let totalPreparedEnemies = 0;
      for (const campaign of campaigns) {
        const table = database
          .prepare('SELECT combat_active, combat_turn_id, active_map_id, enemy_ai_enabled FROM game_tables WHERE campaign_id = ?')
          .get(campaign.id);
        const combatants = database
          .prepare('SELECT kind, character_id, initiative_source FROM combatants WHERE campaign_id = ? ORDER BY id')
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
        assert.ok(
          combatants.some((entry) => entry.kind === 'pj' && entry.character_id === campaign.characterId),
          'el PJ elegido debe entrar en iniciativa'
        );
        const character = database.prepare('SELECT campaign_id FROM characters WHERE id = ?').get(campaign.characterId);
        assert.equal(character.campaign_id, campaign.id);
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
    } finally {
      database.close();
    }
  } finally {
    await stopChild(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
