// Utilidades compartidas para las pruebas E2E.
//
// El estado (usuarios, campaña, membresías) se monta por API a través del proxy
// de Vite, usando el `request` del CONTEXTO del navegador: así la cookie de
// sesión httpOnly queda pegada a ese contexto y las páginas que abra ya están
// autenticadas, sin pasar por la pantalla de acceso en cada test.
import { io as ioClient } from 'socket.io-client';

// Nombre único por ejecución para no chocar entre reintentos ni tests.
export function uniqueUser(prefix) {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return `${prefix}-${suffix}`;
}

// Registra un usuario dentro de `context` (su cookie queda en el contexto).
export async function registerInContext(context, { username, displayName, password = 'segura123' }) {
  const response = await context.request.post('/api/auth/register', {
    data: { username, displayName: displayName ?? username, password },
  });
  if (!response.ok()) {
    throw new Error(`No se pudo registrar a ${username}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

// El DM crea una escaramuza vacía y devuelve { id, inviteCode }.
export async function createSkirmish(context) {
  const response = await context.request.post('/api/campaigns', {
    data: { campaignType: 'escaramuza' },
  });
  if (response.status() !== 201) {
    throw new Error(`No se pudo crear la escaramuza: ${response.status()} ${await response.text()}`);
  }
  const { campaign } = await response.json();
  return { id: campaign.id, inviteCode: campaign.inviteCode };
}

// Un jugador se une por código de invitación.
export async function joinCampaign(context, inviteCode) {
  const response = await context.request.post('/api/campaigns/join', { data: { code: inviteCode } });
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(`No se pudo unir a la campaña: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

// Extrae la cookie de sesión (`tri_dnd_token`) de un contexto de navegador,
// para reutilizarla en un socket de Node que emule al DM.
export async function sessionCookie(context) {
  const cookies = await context.cookies('http://localhost:5173');
  const token = cookies.find((c) => c.name === 'tri_dnd_token');
  if (!token) throw new Error('El contexto no tiene cookie de sesión');
  return `${token.name}=${token.value}`;
}

// Abre un socket.io de Node autenticado con `cookie`, unido a la sala de la
// campaña. Se usa para que el DM dispare tiradas sin depender del selector del
// dado en la interfaz. Recuerda cerrarlo con socket.close().
export async function openDmSocket(cookie, campaignId) {
  const socket = ioClient('http://localhost:5173', {
    path: '/socket.io',
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { Cookie: cookie },
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  await new Promise((resolve, reject) => {
    socket.emit('room:join', { campaignId }, (res) => (res?.error ? reject(new Error(res.error)) : resolve(res)));
  });
  return socket;
}

export function emitRoll(socket, campaignId, roll, hidden) {
  return new Promise((resolve, reject) => {
    socket.emit('roll:send', { campaignId, roll, hidden }, (res) =>
      res?.error ? reject(new Error(res.error)) : resolve(res)
    );
  });
}
