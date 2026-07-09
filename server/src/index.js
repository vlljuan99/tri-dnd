import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';
import { PORT, UPLOADS_ROOT } from './config.js';
import { runMigrations, db } from './db.js';
import { authRouter } from './auth.js';
import { srdRouter } from './routes/srd.js';
import { libraryRouter } from './routes/library.js';
import { charactersRouter } from './routes/characters.js';
import { campaignsRouter } from './routes/campaigns.js';
import { mapsRouter } from './routes/maps.js';
import { worldRouter } from './routes/world.js';
import { setupSockets } from './sockets.js';
import { bindIo } from './services/liveMap.js';

runMigrations();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_ROOT));

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'TriDnD' }));
app.use('/api/auth', authRouter);
app.use('/api/srd', srdRouter);
app.use('/api/biblioteca', libraryRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/campaigns/:campaignId/mapas', mapsRouter);
app.use('/api/campaigns/:campaignId/mundo', worldRouter);
app.use('/api/campaigns', campaignsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// En producción, la imagen sirve el build del cliente (client/dist) desde el
// propio servidor Express — un solo contenedor, un solo puerto detrás de Caddy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/uploads).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const server = http.createServer(app);

export const io = new SocketServer(server);
setupSockets(io);
bindIo(io);

server.listen(PORT, () => {
  const srdCount = db.prepare('SELECT COUNT(*) AS n FROM srd_entries').get().n;
  console.log(`TriDnD servidor en http://localhost:${PORT}`);
  if (srdCount === 0) {
    console.log('[srd] Compendio vacío — ejecuta "npm run sync-srd" para descargar los datos del SRD 5e');
  } else {
    console.log(`[srd] Compendio cargado: ${srdCount} entradas`);
  }
});
