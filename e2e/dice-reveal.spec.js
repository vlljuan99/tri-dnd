// Fase 4b — la tirada como momento. En el navegador real:
//  1. Una tirada de otro (aquí, el DM por su socket) rueda en la pantalla del
//     jugador y se revela por pasos: primero «Rodando…», después el total y el
//     veredicto con su margen.
//  2. Una tirada propia desde el tirador no enseña el resultado en el panel
//     hasta que el dado ha caído.
//  3. El ritmo elegido se recuerda.
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

function d20Roll(label, natural, modifier, outcome) {
  return {
    uid: `e2e-${label}`,
    kind: 'attack',
    label,
    actorName: 'Goblin de prueba',
    formula: `1d20 + ${modifier}`,
    groups: [{ die: 'd20', sides: 20, results: [{ rolls: [natural], kept: natural }] }],
    modifier,
    advantage: 'none',
    total: natural + modifier,
    crit: natural === 20,
    fumble: natural === 1,
    outcome,
  };
}

test('una tirada ajena rueda y se revela por pasos en la pantalla del jugador', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  try {
    await registerInContext(dmContext, { username: uniqueUser('dm'), displayName: 'DM E2E' });
    const { id: campaignId, inviteCode } = await createSkirmish(dmContext);
    await registerInContext(playerContext, { username: uniqueUser('jugador'), displayName: 'Jugador E2E' });
    await joinCampaign(playerContext, inviteCode);

    const playerPage = await playerContext.newPage();
    await playerPage.goto(`/campanas/${campaignId}`);
    await expect(playerPage.getByText('Cargando campaña...')).toHaveCount(0, { timeout: 15_000 });

    // No sabemos cuándo termina el socket del jugador de entrar en la sala (en
    // CI empieza por long-polling y la confirmación no viaja como frame de
    // WebSocket): el DM tira, con una etiqueta distinta cada vez, hasta que una
    // aparece en la pantalla del jugador.
    const dmSocket = await openDmSocket(await sessionCookie(dmContext), campaignId);
    let rotulo = null;
    try {
      for (let intento = 0; intento < 12 && !rotulo; intento += 1) {
        const label = `TIRADA-AJENA-${intento}`;
        // El veredicto que traiga el cliente lo descarta el servidor: aquí se
        // comprueba que la tirada rueda y enseña su total por pasos.
        await emitRoll(dmSocket, campaignId, d20Roll(label, 14, 5), false);
        const candidato = playerPage.getByRole('status').filter({ hasText: label });
        try {
          await expect(candidato).toBeVisible({ timeout: 1_000 });
          rotulo = candidato;
        } catch {
          // Todavía no estaba en la sala: otra tirada
        }
      }
    } finally {
      dmSocket.close();
    }
    expect(rotulo, 'la tirada del DM debe rodar en la pantalla del jugador').not.toBeNull();
    // Mientras el dado vuela no hay número todavía
    await expect(rotulo.getByText('Rodando…')).toBeVisible();
    // Cuando cae: el total y su desglose
    await expect(rotulo.getByText('19', { exact: true })).toBeVisible({ timeout: 6_000 });
    await expect(rotulo.getByText('14 + 5')).toBeVisible();
    // Y tras el reposo, la bandeja se retira sola
    await expect(rotulo).toHaveCount(0, { timeout: 8_000 });
  } finally {
    await dmContext.close();
    await playerContext.close();
  }
});

test('una tirada propia del tirador no enseña el resultado hasta que cae el dado', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await registerInContext(context, { username: uniqueUser('dm'), displayName: 'DM Tirador' });
    const { id: campaignId } = await createSkirmish(context);
    const page = await context.newPage();
    await page.goto(`/campanas/${campaignId}`);
    await expect(page.getByText('Cargando campaña...')).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: /Tirador de dados/ }).click();
    await page.getByRole('button', { name: 'Añadir d20' }).click();

    // El ritmo es una preferencia del visor y se recuerda
    await page.getByRole('radio', { name: 'Cinemático' }).click();
    await expect(page.getByRole('radio', { name: 'Cinemático' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Normal' }).click();

    await page.getByRole('button', { name: 'Tirar', exact: true }).click();
    // El panel dice que la tirada está en el aire…
    await expect(page.getByText('Rodando…').first()).toBeVisible();
    await expect(page.getByText('Compartida con la mesa')).toHaveCount(0);
    // …y el resultado aparece cuando el dado se ha revelado
    await expect(page.getByText('Compartida con la mesa')).toBeVisible({ timeout: 8_000 });

    await page.reload();
    await expect(page.getByText('Cargando campaña...')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('button', { name: /Tirador de dados/ }).click();
    await expect(page.getByRole('radio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await context.close();
  }
});
