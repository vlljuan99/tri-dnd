import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';
import { PORT, UPLOADS_ROOT } from './config.js';
import { runMigrations, db } from './db.js';
import { authRouter } from './auth.js';
import { srdRouter } from './routes/srd.js';
import { charactersRouter } from './routes/characters.js';
import { campaignsRouter } from './routes/campaigns.js';
import { mapsRouter } from './routes/maps.js';
import { setupSockets } from './sockets.js';

runMigrations();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_ROOT));

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'TriDnD' }));
app.use('/api/auth', authRouter);
app.use('/api/srd', srdRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/campaigns/:campaignId/mapas', mapsRouter);
app.use('/api/campaigns', campaignsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const server = http.createServer(app);

export const io = new SocketServer(server);
setupSockets(io);

server.listen(PORT, () => {
  const srdCount = db.prepare('SELECT COUNT(*) AS n FROM srd_entries').get().n;
  console.log(`TriDnD servidor en http://localhost:${PORT}`);
  if (srdCount === 0) {
    console.log('[srd] Compendio vacío — ejecuta "npm run sync-srd" para descargar los datos del SRD 5e');
  } else {
    console.log(`[srd] Compendio cargado: ${srdCount} entradas`);
  }
});
