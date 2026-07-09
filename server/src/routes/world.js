import { Router, raw as expressRaw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getMembership } from './campaigns.js';
import { MAP_UPLOADS_DIR } from '../config.js';
import { generateWorldMapImage } from '../services/mapImageGeneration.js';
import { extensionForMimeType } from '../utils/uploads.js';
import { notifyCampaignMap, notifyCampaignWorld } from '../services/liveMap.js';

// Mapa de campaña (mapa de mundo). El GET lo consulta cualquier miembro (los
// jugadores ven el mapa y las ubicaciones, todas visibles en esta fase); las
// mutaciones y "viajar" son solo del DM, validado por ruta.
export const worldRouter = Router({ mergeParams: true });
worldRouter.use(requireAuth);

worldRouter.use((req, res, next) => {
  const membership = getMembership(req.params.campaignId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  req.membership = membership;
  next();
});

function requireDm(req, res, next) {
  if (req.membership.role !== 'dm') {
    return res.status(403).json({ error: 'Solo el DM puede gestionar el mapa de mundo' });
  }
  next();
}

function getCampaign(campaignId) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
}

// Ubicaciones con las "especificaciones del tablero" (nombre del mapa enlazado
// y su nº de plantas/salas), visibles a todos los roles para la pantalla de
// lore de destino.
function listLocations(campaignId) {
  return db
    .prepare(
      `SELECT l.*, m.name AS map_name,
         (SELECT COUNT(*) FROM map_floors f WHERE f.map_id = l.map_id) AS floor_count,
         (SELECT COUNT(*) FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id WHERE f.map_id = l.map_id) AS room_count
       FROM world_locations l
       LEFT JOIN maps m ON m.id = l.map_id
       WHERE l.campaign_id = ? ORDER BY l.position, l.id`
    )
    .all(campaignId)
    .map((l) => ({
      id: l.id,
      name: l.name,
      x: l.x,
      y: l.y,
      lore: l.lore,
      mapId: l.map_id ?? null,
      mapName: l.map_id ? l.map_name : null,
      floorCount: l.map_id ? l.floor_count : 0,
      roomCount: l.map_id ? l.room_count : 0,
    }));
}

function currentLocationId(campaignId) {
  const row = db.prepare('SELECT current_location_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
  return row?.current_location_id ?? null;
}

function serializeWorld(campaign) {
  return {
    hasWorldMap: Boolean(campaign.has_world_map),
    worldMapUrl: campaign.world_map_url ?? null,
    lore: campaign.lore ?? '',
    currentLocationId: currentLocationId(campaign.id),
    locations: listLocations(campaign.id),
  };
}

function getLocation(campaignId, locationId) {
  return db
    .prepare('SELECT * FROM world_locations WHERE id = ? AND campaign_id = ?')
    .get(locationId, campaignId);
}

// ---- Lectura (cualquier miembro) ----

worldRouter.get('/', (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  res.json({ world: serializeWorld(campaign) });
});

// ---- Imagen del mundo (solo DM) ----

function saveWorldImage(campaign, buffer, extension, res) {
  const filename = `world-${campaign.id}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(MAP_UPLOADS_DIR, filename), buffer);
  const url = `/uploads/maps/${filename}`;
  db.prepare('UPDATE campaigns SET world_map_url = ? WHERE id = ?').run(url, campaign.id);
  notifyCampaignWorld(campaign.id);
  const updated = getCampaign(campaign.id);
  res.json({ world: serializeWorld(updated) });
}

// Subida de una imagen propia del mapa de mundo (binario crudo, como el suelo
// de sala en maps.js)
worldRouter.patch('/imagen', requireDm, expressRaw({ type: () => true, limit: '15mb' }), (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ error: 'El archivo debe ser una imagen' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  }
  saveWorldImage(campaign, req.body, extensionForMimeType(contentType), res);
});

worldRouter.post('/imagen/generar', requireDm, async (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  const { prompt, provider } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 600) : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Describe el mundo que quieres generar' });

  try {
    const generated = await generateWorldMapImage(provider, cleanPrompt);
    saveWorldImage(campaign, generated.buffer, '.png', res);
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo generar la imagen' });
  }
});

worldRouter.delete('/imagen', requireDm, (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  db.prepare('UPDATE campaigns SET world_map_url = NULL WHERE id = ?').run(campaign.id);
  notifyCampaignWorld(campaign.id);
  res.json({ world: serializeWorld(getCampaign(campaign.id)) });
});

// ---- Ubicaciones (solo DM) ----

// Coordenada de pin en % (0-100) sobre la imagen del mundo
function clampPercent(n, fallback) {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

worldRouter.post('/ubicaciones', requireDm, (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  const { name, x, y } = req.body ?? {};
  const position =
    (db.prepare('SELECT MAX(position) AS p FROM world_locations WHERE campaign_id = ?').get(campaign.id).p ?? -1) + 1;
  db.prepare('INSERT INTO world_locations (campaign_id, name, x, y, position) VALUES (?, ?, ?, ?, ?)').run(
    campaign.id,
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'Ubicación sin nombre',
    clampPercent(x, 50),
    clampPercent(y, 50),
    position
  );
  notifyCampaignWorld(campaign.id);
  res.status(201).json({ world: serializeWorld(campaign) });
});

worldRouter.patch('/ubicaciones/:locId', requireDm, (req, res) => {
  const location = getLocation(req.params.campaignId, req.params.locId);
  if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

  const { name, x, y, lore, mapId } = req.body ?? {};
  const sets = [];
  const values = [];

  if (name !== undefined) {
    if (typeof name !== 'string') return res.status(400).json({ error: 'Nombre no válido' });
    sets.push('name = ?');
    values.push(name.trim().slice(0, 120) || 'Ubicación sin nombre');
  }
  if (x !== undefined) {
    sets.push('x = ?');
    values.push(clampPercent(x, location.x));
  }
  if (y !== undefined) {
    sets.push('y = ?');
    values.push(clampPercent(y, location.y));
  }
  if (lore !== undefined) {
    if (typeof lore !== 'string' || lore.length > 5000) return res.status(400).json({ error: 'Lore no válido' });
    sets.push('lore = ?');
    values.push(lore);
  }
  if (mapId !== undefined) {
    if (mapId !== null) {
      const map = db
        .prepare('SELECT id FROM maps WHERE id = ? AND campaign_id = ?')
        .get(mapId, req.params.campaignId);
      if (!map) return res.status(400).json({ error: 'Ese mapa no pertenece a la campaña' });
    }
    sets.push('map_id = ?');
    values.push(mapId ?? null);
  }

  if (sets.length) {
    db.prepare(`UPDATE world_locations SET ${sets.join(', ')} WHERE id = ?`).run(...values, location.id);
  }
  notifyCampaignWorld(req.params.campaignId);
  res.json({ world: serializeWorld(getCampaign(req.params.campaignId)) });
});

worldRouter.delete('/ubicaciones/:locId', requireDm, (req, res) => {
  const location = getLocation(req.params.campaignId, req.params.locId);
  if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

  db.transaction(() => {
    // current_location_id no tiene ON DELETE: se limpia a mano si era esta
    db.prepare(
      'UPDATE game_tables SET current_location_id = NULL WHERE campaign_id = ? AND current_location_id = ?'
    ).run(req.params.campaignId, location.id);
    db.prepare('DELETE FROM world_locations WHERE id = ?').run(location.id);
  })();
  notifyCampaignWorld(req.params.campaignId);
  res.json({ world: serializeWorld(getCampaign(req.params.campaignId)) });
});

// ---- Viajar (solo DM) ----
// Fija la ubicación actual del grupo y activa el mapa enlazado (puede ser NULL
// si la ubicación no tiene tablero: el tablero queda vacío, estado ya soportado).
worldRouter.post('/viajar', requireDm, (req, res) => {
  const { locationId } = req.body ?? {};
  const location = getLocation(req.params.campaignId, locationId);
  if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

  db.prepare(
    "UPDATE game_tables SET current_location_id = ?, active_map_id = ?, updated_at = datetime('now') WHERE campaign_id = ?"
  ).run(location.id, location.map_id ?? null, req.params.campaignId);

  // El tablero se refresca (nuevo mapa activo) y la mesa muestra el lore de destino
  notifyCampaignMap(req.params.campaignId);
  notifyCampaignWorld(req.params.campaignId);
  res.json({ world: serializeWorld(getCampaign(req.params.campaignId)) });
});
