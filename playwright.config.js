import path from 'node:path';
import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// Pruebas E2E de TriDnD. Arrancan la app entera (`npm run dev`: servidor 4000 +
// cliente 5173) y la conducen con un navegador real. A diferencia de las
// pruebas de integración de sockets (server/…/sockets.privacy.integration),
// aquí se verifica el recorrido completo hasta el DOM del jugador.
//
// El servidor de E2E usa una base SQLite temporal (TRIDND_DATA_DIR) para no
// tocar la base local del desarrollador. Está vacía de SRD: sirve para acceso,
// campañas y la mesa en vivo; los flujos que necesiten compendio (asistente de
// personaje) requieren `npm run sync-srd` en esa carpeta antes.
const E2E_DATA_DIR = path.join(os.tmpdir(), 'tridnd-e2e-data');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Descomenta para la matriz móvil (Fase 10, vista presencial):
    // { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      TRIDND_DATA_DIR: E2E_DATA_DIR,
      JWT_SECRET: 'secreto-solo-para-e2e',
      APP_VERSION: 'e2e',
      GIT_SHA: 'sha-e2e',
    },
  },
});
