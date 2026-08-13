// Privacidad de extremo a extremo con DOS navegadores: el del DM y el del
// jugador. Verifica en el DOM real del jugador que una tirada oculta del DM
// nunca se pinta, mientras que una pública sí. Es el reflejo, en el cliente
// real, de lo que sockets.privacy.integration.test.js prueba a nivel de socket.
//
// El DM dispara la tirada por un socket de Node autenticado con su cookie (no
// dependemos del selector del dado en la interfaz, que se cubrirá en el fixme
// de abajo). Lo que importa aquí es el recorrido servidor → socket del jugador
// → React → DOM.
import { test, expect } from '@playwright/test';
import {
  uniqueUser,
  registerInContext,
  createSkirmish,
  joinCampaign,
  sessionCookie,
  openDmSocket,
  emitRoll,
} from './helpers.js';

// Forma mínima de tirada que RollCard sabe pintar (recorre roll.groups).
function fakeRoll(label, total) {
  return { total, label, formula: '1d20', modifier: 0, groups: [], crit: false, fumble: false };
}

// PRECONDICIÓN DESCUBIERTA (bloquea este test hasta resolverla):
// las tiradas ENTRANTES de otros solo se pintan en el panel de chat del
// TABLERO (TacticalMap). El DiceOverlay solo muestra las tiradas PROPIAS del
// usuario local. Una escaramuza recién creada por API no tiene tablero, así
// que la mesa del jugador enseña el estado vacío "Mesa sin tablero" y ninguna
// tirada aparece. Para activar este test hace falta, antes de navegar:
//   1. Que el DM prepare un tablero (crear un mapa por API/editor y dejarlo
//      como active_map_id de la campaña) para que se monte el chat.
//   2. Confirmar en una ejecución `npm run test:e2e:ui` el selector exacto del
//      chat entrante y si la mesa debe abrirse "en vivo".
// El montaje por API, el truco del centinela y la conexión de sockets de abajo
// ya funcionan (el smoke arranca la app y el proxy de sockets responde); solo
// falta el tablero. La garantía a nivel de socket YA está verificada en verde
// en server/…/sockets.privacy.integration.test.js.
test.fixme('una tirada oculta del DM no aparece en el navegador del jugador', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();

  try {
    // Montaje por API: DM crea escaramuza, jugador se une.
    await registerInContext(dmContext, { username: uniqueUser('dm'), displayName: 'DM E2E' });
    const { id: campaignId, inviteCode } = await createSkirmish(dmContext);

    await registerInContext(playerContext, { username: uniqueUser('jugador'), displayName: 'Jugador E2E' });
    await joinCampaign(playerContext, inviteCode);

    // TODO(precondición): preparar aquí un tablero para la campaña y, si hace
    // falta, abrir la sesión en vivo, para que el chat del jugador se monte.

    // El jugador entra a la mesa en su navegador y espera a que cargue.
    const playerPage = await playerContext.newPage();
    await playerPage.goto(`/campanas/${campaignId}`);
    await expect(playerPage.getByText('Cargando campaña...')).toHaveCount(0, { timeout: 15_000 });

    // El DM dispara, por su socket, una tirada OCULTA y otra PÚBLICA (centinela).
    const dmCookie = await sessionCookie(dmContext);
    const dmSocket = await openDmSocket(dmCookie, campaignId);
    try {
      await emitRoll(dmSocket, campaignId, fakeRoll('TIRADA-OCULTA-DM', 17), true);
      await emitRoll(dmSocket, campaignId, fakeRoll('TIRADA-CENTINELA', 9), false);
    } finally {
      dmSocket.close();
    }

    // El jugador ve la centinela pública…
    await expect(playerPage.getByText('TIRADA-CENTINELA')).toBeVisible({ timeout: 10_000 });
    // …y nunca la oculta (si fuera a llegar, ya habría llegado antes que la centinela).
    await expect(playerPage.getByText('TIRADA-OCULTA-DM')).toHaveCount(0);
  } finally {
    await dmContext.close();
    await playerContext.close();
  }
});

// Recorrido 100% por interfaz: el DM abre el tirador de dados, marca "oculta" y
// tira. Requiere confirmar los selectores del DiceOverlay en una primera
// ejecución supervisada (`npx playwright test --ui`), por eso queda como fixme.
test.fixme('el DM tira oculto desde el tirador de dados de la interfaz', async ({ browser }) => {
  // 1. Montar DM + jugador y abrir la mesa en ambos navegadores (como arriba).
  // 2. En el navegador del DM: abrir el FAB del tirador (DiceOverlay), activar
  //    el interruptor de "oculta" y lanzar una tirada identificable.
  // 3. Afirmar que el DM la ve con la insignia "oculta" y el jugador no la ve.
  // Sustituir los getByRole/getByText por los selectores reales del overlay.
});

// Placeholder de la matriz E2E (reconexión): el jugador pierde el socket y al
// reconectar la mesa (iniciativa, tokens, chat) se restablece.
test.fixme('la mesa se restablece tras una reconexión del jugador', async () => {
  // context.setOffline(true) → esperar caída → setOffline(false) → afirmar que
  // el estado de combate y el chat vuelven sin recargar a mano.
});
