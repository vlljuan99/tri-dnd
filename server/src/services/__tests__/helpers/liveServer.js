// Andamiaje compartido para pruebas de integración que arrancan el servidor
// REAL (src/index.js) contra una base SQLite temporal, sin tocar nunca la base
// local del desarrollador. Reutiliza el mismo patrón que
// skirmishes.integration.test.js, pero además abre sockets autenticados para
// poder comprobar qué recibe cada rol.
//
// La pieza clave para la matriz de privacidad es `connectSocket`: conecta un
// Socket.io cliente pasando la cookie de sesión del usuario, de modo que el
// servidor lo trate exactamente como el navegador de ese jugador o del DM.
//
// Ejemplo de uso en sockets.privacy.integration.test.js.
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as ioClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// helpers/ -> __tests__/ -> services/ -> src/ -> server/
const serverDir = path.resolve(__dirname, '../../../..');

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

// Arranca el servidor en un proceso aparte contra una carpeta de datos
// temporal. Devuelve la URL base, el health inicial y un `stop()` que mata el
// proceso y borra los datos. Envuelve todo el cuerpo del test en try/finally
// llamando a `stop()`.
export async function startTestServer() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tridnd-it-'));
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

  const health = await waitForHealth(baseUrl, child, logs);
  const sockets = new Set();

  async function stop() {
    for (const socket of sockets) socket.close();
    sockets.clear();
    if (child.exitCode == null) {
      child.kill();
      await Promise.race([
        once(child, 'exit'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('El servidor de prueba no terminó')), 5000)),
      ]);
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  return { baseUrl, port, dataDir, logs, health, sockets, stop };
}

// Registra un usuario y devuelve su cookie de sesión (`tri_dnd_token=...`).
export async function registerUser(baseUrl, { username, displayName, password = 'segura123' }) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, password }),
  });
  if (response.status !== 201) {
    throw new Error(`No se pudo registrar a ${username}: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error(`El registro de ${username} no devolvió cookie de sesión`);
  return cookie;
}

// Petición JSON autenticada con una cookie. Devuelve { status, body }.
export async function apiFetch(baseUrl, cookie, method, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

// Conecta un Socket.io cliente autenticado como el dueño de `cookie` y espera
// a `connect`. El servidor lee la cookie del handshake igual que en producción,
// así que este socket ve exactamente lo que vería ese navegador. El socket
// queda registrado en el servidor de prueba para cerrarse en `stop()`.
export async function connectSocket(server, cookie) {
  const socket = ioClient(server.baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { Cookie: cookie },
  });
  server.sockets.add(socket);
  await once(socket, 'connect');
  return socket;
}

// Une un socket a la sala de la campaña y resuelve con la respuesta inicial
// (rol, mensajes, combate…). Rechaza si el servidor devuelve error.
export function joinRoom(socket, campaignId) {
  return new Promise((resolve, reject) => {
    socket.emit('room:join', { campaignId }, (response) => {
      if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}

// Emite un evento con callback y resuelve con la respuesta (o rechaza su error).
export function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}

// Acumula en un array todos los payloads de `event` que recibe el socket.
// Útil para afirmar, al final del test, qué llegó y qué NO llegó a cada rol.
export function collect(socket, event) {
  const received = [];
  socket.on(event, (payload) => received.push(payload));
  return received;
}

// Resuelve cuando llega un `event` que cumple `predicate` (o rechaza al agotar
// el tiempo). Regístralo ANTES de disparar la acción que debería provocarlo.
export function waitForEvent(socket, event, predicate = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Tiempo agotado esperando "${event}"`));
    }, timeout);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}
