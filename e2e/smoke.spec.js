// Humo: la app arranca, sirve el cliente y la pantalla de acceso se renderiza.
// Es el test que confirma que todo el andamiaje E2E (webServer, proxy, navegador)
// está bien montado antes de escribir flujos más ricos.
import { test, expect } from '@playwright/test';

test('la pantalla de acceso se muestra', async ({ page }) => {
  await page.goto('/acceso');
  await expect(page.getByRole('heading', { name: 'TriDnD' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar al campamento' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cuenta' })).toBeVisible();
});

test('sin sesión, cualquier ruta protegida redirige a /acceso', async ({ page }) => {
  await page.goto('/campanas');
  await expect(page).toHaveURL(/\/acceso$/);
});
