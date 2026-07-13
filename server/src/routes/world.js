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
import { fireTravelEvents } from '../services/events.js';

// Mapa de campaña por capas (v34): cada campaña tiene un mapa de mundo raíz
// (world_maps) y, opcionalmente, submapas (ciudades) a los que se salta desde
// un pin tipo 'ciudad'. El GET lo consulta cualquier miembro (los pins ocultos
// se filtran EN SERVIDOR para el jugador); las mutaciones y "viajar" son solo
// del DM, validado por ruta.
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

const LOCATION_KINDS = new Set(['dungeon', 'ciudad', 'campamento', 'evento']);
const IMAGE_STYLES = new Set(['region', 'ciudad']);

function getCampaign(campaignId) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
}

// Campañas creadas antes de la v34 (o justo después, con el asistente) pueden
// tener mundo sin fila raíz todavía: se crea al vuelo.
function ensureRootWorldMap(campaign) {
  if (campaign.root_world_map_id) {
    const existing = db
      .prepare('SELECT id FROM world_maps WHERE id = ? AND campaign_id = ?')
      .get(campaign.root_world_map_id, campaign.id);
    if (existing) return campaign.root_world_map_id;
  }
  const info = db
    .prepare('INSERT INTO world_maps (campaign_id, name, image_url) VALUES (?, ?, ?)')
    .run(campaign.id, 'Mapa de mundo', campaign.world_map_url ?? null);
  db.prepare('UPDATE campaigns SET root_world_map_id = ? WHERE id = ?').run(info.lastInsertRowid, campaign.id);
  return info.lastInsertRowid;
}

function getWorldMap(campaignId, worldMapId) {
  return db.prepare('SELECT * FROM world_maps WHERE id = ? AND campaign_id = ?').get(worldMapId, campaignId);
}

function getLocation(campaignId, locationId) {
  return db
    .prepare('SELECT * FROM world_locations WHERE id = ? AND campaign_id = ?')
    .get(locationId, campaignId);
}

// El padre de un submapa es el pin que salta a él (no hay parent_id en la tabla)
function getParentLocation(campaignId, worldMapId) {
  return db
    .prepare('SELECT * FROM world_locations WHERE campaign_id = ? AND target_world_map_id = ? ORDER BY id LIMIT 1')
    .get(campaignId, worldMapId);
}

// Ubicaciones de la campaña con las "especificaciones del tablero" (nombre del
// mapa enlazado y su nº de plantas/salas) y el nombre del submapa destino.
function listLocations(campaignId) {
  return db
    .prepare(
      `SELECT l.*, m.name AS map_name, wt.name AS target_map_name,
         (SELECT COUNT(*) FROM map_floors f WHERE f.map_id = l.map_id) AS floor_count,
         (SELECT COUNT(*) FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id WHERE f.map_id = l.map_id) AS room_count
       FROM world_locations l
       LEFT JOIN maps m ON m.id = l.map_id
       LEFT JOIN world_maps wt ON wt.id = l.target_world_map_id
       WHERE l.campaign_id = ? ORDER BY l.position, l.id`
    )
    .all(campaignId);
}

function serializeLocation(l) {
  return {
    id: l.id,
    worldMapId: l.world_map_id,
    name: l.name,
    x: l.x,
    y: l.y,
    lore: l.lore,
    kind: LOCATION_KINDS.has(l.kind) ? l.kind : 'dungeon',
    hidden: Boolean(l.hidden),
    mapId: l.map_id ?? null,
    mapName: l.map_id ? l.map_name : null,
    floorCount: l.map_id ? l.floor_count : 0,
    roomCount: l.map_id ? l.room_count : 0,
    targetMapId: l.target_world_map_id ?? null,
    targetMapName: l.target_world_map_id ? l.target_map_name : null,
  };
}

function gameTable(campaignId) {
  return db
    .prepare('SELECT current_location_id, current_world_map_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
}

function serializeWorld(campaign, role) {
  const isDm = role === 'dm';
  const rootId = campaign.has_world_map ? ensureRootWorldMap(campaign) : (campaign.root_world_map_id ?? null);
  const mapRows = db.prepare('SELECT * FROM world_maps WHERE campaign_id = ? ORDER BY id').all(campaign.id);
  const allLocations = listLocations(campaign.id);

  const table = gameTable(campaign.id);
  const currentLocationId = table?.current_location_id ?? null;
  // Si el mapa actual ya no existe (submapa borrado), se cae al raíz
  const currentMapId = mapRows.some((m) => m.id === table?.current_world_map_id)
    ? table.current_world_map_id
    : rootId;

  // El jugador no recibe pins ocultos (filtrado en servidor, como las tiradas
  // ocultas), salvo que sea la ubicación actual (viajar allí la revela igualmente)
  const visible = allLocations.filter((l) => isDm || !l.hidden || l.id === currentLocationId);

  return {
    hasWorldMap: Boolean(campaign.has_world_map),
    lore: campaign.lore ?? '',
    rootMapId: rootId,
    currentMapId,
    currentLocationId,
    maps: mapRows.map((m) => {
      const parent = m.id === rootId ? null : getParentLocation(campaign.id, m.id);
      return {
        id: m.id,
        name: m.name,
        imageUrl: m.image_url ?? null,
        isRoot: m.id === rootId,
        parent: parent
          ? { locationId: parent.id, locationName: parent.name, mapId: parent.world_map_id }
          : null,
        locations: visible.filter((l) => l.world_map_id === m.id).map(serializeLocation),
      };
    }),
  };
}

function respondWorld(req, res, status = 200) {
  res.status(status).json({ world: serializeWorld(getCampaign(req.params.campaignId), req.membership.role) });
}

// ---- Lectura (cualquier miembro) ----

worldRouter.get('/', (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  res.json({ world: serializeWorld(campaign, req.membership.role) });
});

// ---- Submapas (solo DM) ----

worldRouter.post('/mapas', requireDm, (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  ensureRootWorldMap(campaign);

  const { name } = req.body ?? {};
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'Submapa sin nombre';
  const info = db
    .prepare('INSERT INTO world_maps (campaign_id, name) VALUES (?, ?)')
    .run(campaign.id, cleanName);
  notifyCampaignWorld(campaign.id);
  res.status(201).json({
    worldMapId: info.lastInsertRowid,
    world: serializeWorld(getCampaign(campaign.id), req.membership.role),
  });
});

worldRouter.patch('/mapas/:mapId', requireDm, (req, res) => {
  const worldMap = getWorldMap(req.params.campaignId, req.params.mapId);
  if (!worldMap) return res.status(404).json({ error: 'Mapa no encontrado' });

  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Nombre no válido' });
  db.prepare('UPDATE world_maps SET name = ? WHERE id = ?').run(name.trim().slice(0, 120), worldMap.id);
  notifyCampaignWorld(req.params.campaignId);
  respondWorld(req, res);
});

worldRouter.delete('/mapas/:mapId', requireDm, (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  const worldMap = getWorldMap(campaign.id, req.params.mapId);
  if (!worldMap) return res.status(404).json({ error: 'Mapa no encontrado' });
  if (worldMap.id === campaign.root_world_map_id) {
    return res.status(400).json({ error: 'El mapa raíz de la campaña no se puede borrar' });
  }

  db.transaction(() => {
    // Los pins del submapa caen por CASCADE y los event_links de esos pins no
    // tienen FK: se limpian a mano antes
    db.prepare(
      `DELETE FROM event_links WHERE campaign_id = ? AND target_type = 'ubicacion'
         AND target_id IN (SELECT id FROM world_locations WHERE world_map_id = ?)`
    ).run(campaign.id, worldMap.id);
    db.prepare('DELETE FROM world_maps WHERE id = ?').run(worldMap.id);

    // Si el grupo estaba mirando este mapa (o su ubicación vivía en él), se
    // le devuelve al raíz; current_location_id sin ON DELETE, mismo criterio
    // que active_map_id
    const table = gameTable(campaign.id);
    if (table?.current_world_map_id && !getWorldMap(campaign.id, table.current_world_map_id)) {
      db.prepare('UPDATE game_tables SET current_world_map_id = ? WHERE campaign_id = ?').run(
        campaign.root_world_map_id,
        campaign.id
      );
    }
    if (table?.current_location_id && !getLocation(campaign.id, table.current_location_id)) {
      db.prepare(
        'UPDATE game_tables SET current_location_id = NULL, active_map_id = NULL WHERE campaign_id = ?'
      ).run(campaign.id);
    }
  })();
  notifyCampaignMap(campaign.id);
  notifyCampaignWorld(campaign.id);
  respondWorld(req, res);
});

// ---- Imagen de un mapa de mundo (solo DM) ----

function saveWorldImage(req, res, worldMap, buffer, extension) {
  const filename = `world-${req.params.campaignId}-${worldMap.id}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(MAP_UPLOADS_DIR, filename), buffer);
  const url = `/uploads/maps/${filename}`;
  db.prepare('UPDATE world_maps SET image_url = ? WHERE id = ?').run(url, worldMap.id);
  notifyCampaignWorld(req.params.campaignId);
  respondWorld(req, res);
}

// Subida de una imagen propia (binario crudo, como el suelo de sala en maps.js)
worldRouter.patch('/mapas/:mapId/imagen', requireDm, expressRaw({ type: () => true, limit: '15mb' }), (req, res) => {
  const worldMap = getWorldMap(req.params.campaignId, req.params.mapId);
  if (!worldMap) return res.status(404).json({ error: 'Mapa no encontrado' });

  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ error: 'El archivo debe ser una imagen' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  }
  saveWorldImage(req, res, worldMap, req.body, extensionForMimeType(contentType));
});

worldRouter.post('/mapas/:mapId/imagen/generar', requireDm, async (req, res) => {
  const worldMap = getWorldMap(req.params.campaignId, req.params.mapId);
  if (!worldMap) return res.status(404).json({ error: 'Mapa no encontrado' });

  const { prompt, provider, estilo } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 600) : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Describe el mapa que quieres generar' });
  const cleanStyle = IMAGE_STYLES.has(estilo) ? estilo : 'region';

  try {
    const generated = await generateWorldMapImage(provider, cleanPrompt, cleanStyle);
    saveWorldImage(req, res, worldMap, generated.buffer, '.png');
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo generar la imagen' });
  }
});

worldRouter.delete('/mapas/:mapId/imagen', requireDm, (req, res) => {
  const worldMap = getWorldMap(req.params.campaignId, req.params.mapId);
  if (!worldMap) return res.status(404).json({ error: 'Mapa no encontrado' });
  db.prepare('UPDATE world_maps SET image_url = NULL WHERE id = ?').run(worldMap.id);
  notifyCampaignWorld(req.params.campaignId);
  respondWorld(req, res);
});

// ---- Ubicaciones (solo DM) ----

// Coordenada de pin en % (0-100) sobre la imagen del mundo
function clampPercent(n, fallback) {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

// Un pin no puede saltar a su propio mapa ni a un ancestro (crearía un ciclo
// al subir con "volver"): se pasea la cadena de padres desde el mapa del pin.
function wouldCreateCycle(campaignId, locationMapId, targetMapId) {
  let cursor = locationMapId;
  const seen = new Set();
  while (cursor != null && !seen.has(cursor)) {
    if (cursor === targetMapId) return true;
    seen.add(cursor);
    cursor = getParentLocation(campaignId, cursor)?.world_map_id ?? null;
  }
  return false;
}

worldRouter.post('/ubicaciones', requireDm, (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  const rootId = ensureRootWorldMap(campaign);

  const { name, x, y, mapId } = req.body ?? {};
  const worldMapId = mapId ?? rootId;
  if (!getWorldMap(campaign.id, worldMapId)) {
    return res.status(400).json({ error: 'Ese mapa de mundo no pertenece a la campaña' });
  }
  const position =
    (db.prepare('SELECT MAX(position) AS p FROM world_locations WHERE campaign_id = ?').get(campaign.id).p ?? -1) + 1;
  db.prepare(
    'INSERT INTO world_locations (campaign_id, world_map_id, name, x, y, position) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    campaign.id,
    worldMapId,
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'Ubicación sin nombre',
    clampPercent(x, 50),
    clampPercent(y, 50),
    position
  );
  notifyCampaignWorld(campaign.id);
  respondWorld(req, res, 201);
});

worldRouter.patch('/ubicaciones/:locId', requireDm, (req, res) => {
  const location = getLocation(req.params.campaignId, req.params.locId);
  if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

  const { name, x, y, lore, mapId, kind, targetWorldMapId, hidden } = req.body ?? {};
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
  if (kind !== undefined) {
    if (!LOCATION_KINDS.has(kind)) return res.status(400).json({ error: 'Tipo de ubicación no válido' });
    sets.push('kind = ?');
    values.push(kind);
    // Al dejar de ser ciudad, el pin pierde su salto (el submapa no se borra)
    if (kind !== 'ciudad' && targetWorldMapId === undefined && location.target_world_map_id) {
      sets.push('target_world_map_id = NULL');
    }
  }
  if (hidden !== undefined) {
    sets.push('hidden = ?');
    values.push(hidden ? 1 : 0);
  }
  // Tablero táctico y salto a submapa son excluyentes: fijar uno limpia el otro
  if (mapId !== undefined) {
    if (mapId !== null) {
      const map = db
        .prepare('SELECT id FROM maps WHERE id = ? AND campaign_id = ?')
        .get(mapId, req.params.campaignId);
      if (!map) return res.status(400).json({ error: 'Ese mapa no pertenece a la campaña' });
      sets.push('target_world_map_id = NULL');
    }
    sets.push('map_id = ?');
    values.push(mapId ?? null);
  }
  if (targetWorldMapId !== undefined) {
    if (targetWorldMapId !== null) {
      const effectiveKind = kind !== undefined ? kind : location.kind;
      if (effectiveKind !== 'ciudad') {
        return res.status(400).json({ error: 'Solo una ubicación tipo ciudad puede saltar a otro mapa' });
      }
      if (!getWorldMap(req.params.campaignId, targetWorldMapId)) {
        return res.status(400).json({ error: 'Ese mapa de mundo no pertenece a la campaña' });
      }
      if (wouldCreateCycle(req.params.campaignId, location.world_map_id, Number(targetWorldMapId))) {
        return res.status(400).json({ error: 'Ese salto crearía un ciclo entre mapas' });
      }
      const occupied = getParentLocation(req.params.campaignId, targetWorldMapId);
      if (occupied && occupied.id !== location.id) {
        return res.status(400).json({ error: `Ese submapa ya cuelga de "${occupied.name}"` });
      }
      sets.push('map_id = NULL');
    }
    sets.push('target_world_map_id = ?');
    values.push(targetWorldMapId ?? null);
  }

  if (sets.length) {
    db.prepare(`UPDATE world_locations SET ${sets.join(', ')} WHERE id = ?`).run(...values, location.id);
  }
  notifyCampaignWorld(req.params.campaignId);
  respondWorld(req, res);
});

worldRouter.delete('/ubicaciones/:locId', requireDm, (req, res) => {
  const location = getLocation(req.params.campaignId, req.params.locId);
  if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

  db.transaction(() => {
    // current_location_id no tiene ON DELETE: se limpia a mano si era esta
    db.prepare(
      'UPDATE game_tables SET current_location_id = NULL WHERE campaign_id = ? AND current_location_id = ?'
    ).run(req.params.campaignId, location.id);
    // Los eventos colgados del pin tampoco tienen FK
    db.prepare("DELETE FROM event_links WHERE campaign_id = ? AND target_type = 'ubicacion' AND target_id = ?").run(
      req.params.campaignId,
      location.id
    );
    db.prepare('DELETE FROM world_locations WHERE id = ?').run(location.id);
  })();
  notifyCampaignWorld(req.params.campaignId);
  respondWorld(req, res);
});

// ---- Viajar y volver (solo DM) ----

// Fija la ubicación actual del grupo. Un pin con tablero lo activa (puede ser
// NULL: tablero vacío, estado ya soportado); un pin tipo ciudad con submapa
// mete al grupo en esa capa. Viajar a un pin oculto lo revela, y dispara los
// eventos de camino colgados de la ubicación.
worldRouter.post('/viajar', requireDm, (req, res) => {
  const { locationId } = req.body ?? {};
  const location = getLocation(req.params.campaignId, locationId);
  if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

  db.transaction(() => {
    if (location.hidden) {
      db.prepare('UPDATE world_locations SET hidden = 0 WHERE id = ?').run(location.id);
    }
    db.prepare(
      "UPDATE game_tables SET current_location_id = ?, current_world_map_id = ?, active_map_id = ?, updated_at = datetime('now') WHERE campaign_id = ?"
    ).run(
      location.id,
      location.target_world_map_id ?? location.world_map_id,
      location.map_id ?? null,
      req.params.campaignId
    );
  })();
  fireTravelEvents(req.params.campaignId, location.id);

  // El tablero se refresca (nuevo mapa activo) y la mesa muestra el lore de destino
  notifyCampaignMap(req.params.campaignId);
  notifyCampaignWorld(req.params.campaignId);
  respondWorld(req, res);
});

// Sube del submapa actual al mapa donde vive el pin que lo enlaza
worldRouter.post('/volver', requireDm, (req, res) => {
  const campaign = getCampaign(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  const table = gameTable(campaign.id);
  const parent = table?.current_world_map_id
    ? getParentLocation(campaign.id, table.current_world_map_id)
    : null;
  if (!parent) return res.status(400).json({ error: 'Ya estáis en el mapa raíz' });

  db.prepare(
    "UPDATE game_tables SET current_location_id = NULL, current_world_map_id = ?, active_map_id = NULL, updated_at = datetime('now') WHERE campaign_id = ?"
  ).run(parent.world_map_id, campaign.id);
  notifyCampaignMap(campaign.id);
  notifyCampaignWorld(campaign.id);
  respondWorld(req, res);
});
