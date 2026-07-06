import { Router, raw as expressRaw } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { MAP_UPLOADS_DIR } from '../config.js';
import { generateMapImage } from '../services/mapImageGeneration.js';
import { extensionForMimeType } from '../utils/uploads.js';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

function serializeMap(table) {
  return {
    name: table.map_name,
    backgroundUrl: table.map_background_url,
    width: table.map_width,
    height: table.map_height,
    gridSize: table.map_grid_size,
    disabledCells: JSON.parse(table.map_disabled_cells || '[]'),
  };
}

function getMapTable(campaignId) {
  return db
    .prepare(
      `SELECT map_name, map_background_url, map_width, map_height, map_grid_size, map_disabled_cells
       FROM game_tables WHERE campaign_id = ?`
    )
    .get(campaignId);
}

// Validación de la forma de la sala: lista de pares [col, row] enteros no
// negativos, tamaño acotado para evitar payloads absurdos.
function isValidDisabledCells(value) {
  return (
    Array.isArray(value) &&
    value.length <= 4000 &&
    value.every(
      (cell) =>
        Array.isArray(cell) &&
        cell.length === 2 &&
        cell.every((n) => Number.isInteger(n) && n >= 0)
    )
  );
}

// Código de invitación legible, sin caracteres ambiguos (0/O, 1/I/L)
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!db.prepare('SELECT 1 FROM campaigns WHERE invite_code = ?').get(code)) return code;
  }
}

export function getMembership(campaignId, userId) {
  return db
    .prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .get(campaignId, userId);
}

function serializeCampaign(row, role) {
  const table = db.prepare('SELECT is_live FROM game_tables WHERE campaign_id = ?').get(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scene: row.scene,
    inviteCode: row.invite_code,
    dmUserId: row.dm_user_id,
    role,
    isLive: Boolean(table?.is_live),
  };
}

campaignsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, m.role FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id
       WHERE m.user_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.user.id);
  res.json({ campaigns: rows.map((r) => serializeCampaign(r, r.role)) });
});

campaignsRouter.post('/', (req, res) => {
  const { name, description } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'La campaña necesita un nombre' });
  }
  const create = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO campaigns (name, description, dm_user_id, invite_code) VALUES (?, ?, ?, ?)')
      .run(
        name.trim().slice(0, 80),
        typeof description === 'string' ? description.slice(0, 2000) : '',
        req.user.id,
        generateInviteCode()
      );
    const id = info.lastInsertRowid;
    db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'dm')").run(id, req.user.id);
    db.prepare('INSERT INTO game_tables (campaign_id) VALUES (?)').run(id);
    return id;
  });
  const id = create();
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  res.status(201).json({ campaign: serializeCampaign(row, 'dm') });
});

campaignsRouter.post('/join', (req, res) => {
  const { code } = req.body ?? {};
  const row =
    typeof code === 'string'
      ? db.prepare('SELECT * FROM campaigns WHERE invite_code = ?').get(code.trim().toUpperCase())
      : undefined;
  if (!row) return res.status(404).json({ error: 'Código de invitación no válido' });

  const existing = getMembership(row.id, req.user.id);
  if (existing) return res.json({ campaign: serializeCampaign(row, existing.role) });

  db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'jugador')").run(
    row.id,
    req.user.id
  );
  res.status(201).json({ campaign: serializeCampaign(row, 'jugador') });
});

campaignsRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  const membership = getMembership(row.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });

  const members = db
    .prepare(
      `SELECT u.id, u.display_name AS displayName, m.role FROM campaign_members m
       JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ? ORDER BY m.joined_at`
    )
    .all(row.id);
  const characters = db
    .prepare(
      `SELECT id, user_id, name, class_index, race_index, level, hp_current, hp_max, ac, avatar_path AS avatarUrl
       FROM characters WHERE campaign_id = ?`
    )
    .all(row.id);

  res.json({ campaign: serializeCampaign(row, membership.role), members, characters });
});

campaignsRouter.get('/:id/mapa', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  const table = getMapTable(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  res.json({ map: serializeMap(table) });
});

// Subida de una imagen propia como fondo del mapa. Se envía como binario
// crudo (no JSON) para no limitar el body-parser global de la API.
campaignsRouter.patch(
  '/:id/mapa/imagen',
  expressRaw({ type: () => true, limit: '15mb' }),
  (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
    if (membership.role !== 'dm') return res.status(403).json({ error: 'Solo el DM puede cambiar el mapa' });

    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'El archivo debe ser una imagen' });
    }
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }

    const width = Number(req.query.width);
    const height = Number(req.query.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return res.status(400).json({ error: 'Dimensiones de mapa no válidas' });
    }

    const filename = `campaign-${req.params.id}-${Date.now()}${extensionForMimeType(contentType)}`;
    fs.writeFileSync(path.join(MAP_UPLOADS_DIR, filename), buffer);
    const backgroundUrl = `/uploads/maps/${filename}`;

    db.prepare(
      "UPDATE game_tables SET map_background_url = ?, map_width = ?, map_height = ?, updated_at = datetime('now') WHERE campaign_id = ?"
    ).run(backgroundUrl, width, height, req.params.id);

    res.json({ map: serializeMap(getMapTable(req.params.id)) });
  }
);

campaignsRouter.delete('/:id/mapa/imagen', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  if (membership.role !== 'dm') return res.status(403).json({ error: 'Solo el DM puede cambiar el mapa' });

  db.prepare(
    "UPDATE game_tables SET map_background_url = NULL, updated_at = datetime('now') WHERE campaign_id = ?"
  ).run(req.params.id);
  res.json({ map: serializeMap(getMapTable(req.params.id)) });
});

// Forma de la sala: casillas desactivadas para cuadrículas no rectangulares.
// El DM parte de un rectángulo completo y "borra" las casillas que quiere
// dejar fuera de la sala (en L, con huecos, etc.).
campaignsRouter.patch('/:id/mapa/celdas', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  if (membership.role !== 'dm') return res.status(403).json({ error: 'Solo el DM puede editar la forma de la sala' });

  const { disabledCells } = req.body ?? {};
  if (!isValidDisabledCells(disabledCells)) {
    return res.status(400).json({ error: 'Lista de casillas no válida' });
  }

  db.prepare(
    "UPDATE game_tables SET map_disabled_cells = ?, updated_at = datetime('now') WHERE campaign_id = ?"
  ).run(JSON.stringify(disabledCells), req.params.id);

  res.json({ map: serializeMap(getMapTable(req.params.id)) });
});

campaignsRouter.post('/:id/mapa/generar', async (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  if (membership.role !== 'dm') return res.status(403).json({ error: 'Solo el DM puede generar el mapa' });

  const { prompt, provider } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 600) : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Describe el mapa que quieres generar' });

  try {
    const generated = await generateMapImage(provider, cleanPrompt);
    const filename = `campaign-${req.params.id}-${Date.now()}.png`;
    fs.writeFileSync(path.join(MAP_UPLOADS_DIR, filename), generated.buffer);
    const backgroundUrl = `/uploads/maps/${filename}`;

    db.prepare(
      "UPDATE game_tables SET map_background_url = ?, map_width = ?, map_height = ?, updated_at = datetime('now') WHERE campaign_id = ?"
    ).run(backgroundUrl, generated.width, generated.height, req.params.id);

    res.json({ map: serializeMap(getMapTable(req.params.id)) });
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo generar la imagen' });
  }
});
