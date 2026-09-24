// Imágenes de las figuras de los escenarios de fábrica, contra el servidor
// real: solo el administrador de la instalación las cambia, y se ven en el
// tablero de las partidas de ese escenario, también en las ya montadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  apiFetch,
  connectSocket,
  joinRoom,
  registerUser,
  startTestServer,
  waitForEvent,
} from './helpers/liveServer.js';

// PNG de 1×1: basta con que sea una imagen de verdad
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const FIGURAS = '/api/campaigns/escaramuzas/predefinidas/paso-del-cuervo/figuras';

async function upload(baseUrl, cookie, figureKey, { body = PNG, type = 'image/png' } = {}) {
  const response = await fetch(`${baseUrl}${FIGURAS}/${figureKey}/imagen`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': type, 'X-Nombre-Original': encodeURIComponent('carro.png') },
    body,
  });
  return { status: response.status, body: await response.json() };
}

function tokenNamed(map, name) {
  return map.tokens.find((token) => token.name === name);
}

test('el administrador pone imagen a las figuras de un escenario de fábrica', { timeout: 30000 }, async () => {
  // Sin TRIDND_ADMIN_USERS manda el fundador: la primera cuenta registrada
  delete process.env.TRIDND_ADMIN_USERS;
  const server = await startTestServer();
  try {
    const { baseUrl } = server;
    assert.equal(server.health.database.migration, 78);
    const admin = await registerUser(baseUrl, { username: 'fundadora', displayName: 'Fundadora' });
    const amigo = await registerUser(baseUrl, { username: 'amigo', displayName: 'Amigo' });

    const adminList = await apiFetch(baseUrl, admin, 'GET', '/api/campaigns/escaramuzas/predefinidas');
    assert.equal(adminList.body.puedeEditarImagenes, true);
    const friendList = await apiFetch(baseUrl, amigo, 'GET', '/api/campaigns/escaramuzas/predefinidas');
    assert.equal(friendList.body.puedeEditarImagenes, false);

    // Quien no administra no ve ni toca las figuras (el listado destripa el escenario)
    assert.equal((await apiFetch(baseUrl, amigo, 'GET', FIGURAS)).status, 403);
    assert.equal((await upload(baseUrl, amigo, 'objeto-carro-volcado')).status, 403);
    assert.equal(
      (await apiFetch(baseUrl, amigo, 'DELETE', `${FIGURAS}/objeto-carro-volcado/imagen`)).status,
      403
    );

    // Una partida montada ANTES de subir la imagen también debe recibirla
    const database = new Database(path.join(server.dataDir, 'tri-dnd.db'));
    let characterId;
    try {
      const userId = database.prepare("SELECT id FROM users WHERE username = 'fundadora'").get().id;
      characterId = Number(
        database
          .prepare(
            `INSERT INTO characters (user_id, name, level, hp_max, hp_current, hp_temp, ac, status, kind)
             VALUES (?, 'Alda', 3, 28, 28, 0, 16, 'complete', 'pj')`
          )
          .run(userId).lastInsertRowid
      );
    } finally {
      database.close();
    }
    const created = await apiFetch(baseUrl, admin, 'POST', '/api/campaigns', {
      campaignType: 'escaramuza',
      presetId: 'paso-del-cuervo',
      characterId,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaignId = created.body.campaign.id;
    const mapaActivo = `/api/campaigns/${campaignId}/mapa-activo`;

    const before = (await apiFetch(baseUrl, admin, 'GET', mapaActivo)).body.map;
    assert.equal(tokenNamed(before, 'Carro volcado')?.avatarUrl, null, 'sin imagen, el disco de color de siempre');

    const figures = await apiFetch(baseUrl, admin, 'GET', FIGURAS);
    assert.equal(figures.status, 200);
    assert.ok(figures.body.figuras.some((figure) => figure.key === 'objeto-carro-volcado' && figure.imageUrl === null));

    // Validaciones: formato, figura y escenario
    assert.equal((await upload(baseUrl, admin, 'objeto-carro-volcado', { type: 'image/svg+xml' })).status, 400);
    assert.equal((await upload(baseUrl, admin, 'objeto-carro-volcado', { body: Buffer.alloc(0) })).status, 400);
    assert.equal((await upload(baseUrl, admin, 'objeto-no-existe')).status, 404);
    assert.equal(
      (await apiFetch(baseUrl, admin, 'GET', '/api/campaigns/escaramuzas/predefinidas/no-existe/figuras')).status,
      404
    );

    // La mesa en marcha recibe la señal de repintar (sin datos por el socket)
    const socket = await connectSocket(server, admin);
    await joinRoom(socket, campaignId);
    const repaint = waitForEvent(socket, 'mapa:actualizado');
    const uploaded = await upload(baseUrl, admin, 'objeto-carro-volcado');
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    await repaint;
    const carro = uploaded.body.figuras.find((figure) => figure.key === 'objeto-carro-volcado');
    assert.match(carro.imageUrl, /^\/uploads\/skirmishes\/paso-del-cuervo-objeto-carro-volcado-\d+\.png$/);
    assert.equal(carro.originalName, 'carro.png');
    const served = await fetch(`${baseUrl}${carro.imageUrl}`);
    assert.equal(served.status, 200);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);

    // Una imagen por figura: los arqueros comparten la suya
    const archers = await upload(baseUrl, admin, 'enemigo-bandido-arquero', { type: 'image/webp' });
    assert.equal(archers.status, 200);
    const archerUrl = archers.body.figuras.find((figure) => figure.key === 'enemigo-bandido-arquero').imageUrl;
    assert.match(archerUrl, /\.webp$/);

    const after = (await apiFetch(baseUrl, admin, 'GET', mapaActivo)).body.map;
    assert.equal(tokenNamed(after, 'Carro volcado').avatarUrl, carro.imageUrl);
    const archerTokens = after.tokens.filter((token) => token.name === 'Bandido arquero');
    assert.ok(archerTokens.length > 0, 'la partida en solitario conserva algún arquero');
    assert.ok(archerTokens.every((token) => token.avatarUrl === archerUrl));
    assert.ok(
      after.tokens.filter((token) => token.name === 'Lobo').every((token) => token.avatarUrl === null),
      'una figura sin imagen no hereda la de otra'
    );

    // Cambiar la imagen borra el fichero anterior; quitarla vuelve al disco
    const replaced = await upload(baseUrl, admin, 'objeto-carro-volcado', { type: 'image/jpeg' });
    const replacedUrl = replaced.body.figuras.find((figure) => figure.key === 'objeto-carro-volcado').imageUrl;
    assert.notEqual(replacedUrl, carro.imageUrl);
    const uploadsDir = path.join(server.dataDir, 'uploads', 'skirmishes');
    assert.equal(fs.existsSync(path.join(uploadsDir, path.basename(carro.imageUrl))), false);
    assert.equal(fs.existsSync(path.join(uploadsDir, path.basename(replacedUrl))), true);

    const removed = await apiFetch(baseUrl, admin, 'DELETE', `${FIGURAS}/objeto-carro-volcado/imagen`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.figuras.find((figure) => figure.key === 'objeto-carro-volcado').imageUrl, null);
    assert.equal(fs.existsSync(path.join(uploadsDir, path.basename(replacedUrl))), false);
    const cleared = (await apiFetch(baseUrl, admin, 'GET', mapaActivo)).body.map;
    assert.equal(tokenNamed(cleared, 'Carro volcado').avatarUrl, null);
    assert.ok(cleared.tokens.filter((token) => token.name === 'Bandido arquero').every((token) => token.avatarUrl === archerUrl));
  } finally {
    await server.stop();
  }
});
