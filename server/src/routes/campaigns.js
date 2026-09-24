import { Router, raw as expressRaw } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  getActiveMapId,
  getMap,
  serializeFullMap,
  serializeMapForPlayer,
  ensureCharacterTokens,
  spawnRoomEnemies,
  touchMap,
} from '../services/mapLibrary.js';
import {
  notifyCampaignMap,
  notifyCombat,
  notifyCombatStarted,
  postSystemMessage,
  evictCampaignMember,
  notifyBestiary,
  notifyCampaignLevel,
  notifyCampaignWorld,
} from '../services/liveMap.js';
import { ensureCombatantForCharacter, trySpendMovement, trySpendAction } from '../services/turnEconomy.js';
import { listCustomRows, serializeCustomEntry } from '../services/customLibrary.js';
import { lootMarkerInto } from '../services/loot.js';
import { grantCampaignLevel } from '../services/leveling.js';
import { restCampaign, setCampaignClock } from '../services/rest.js';
import { buildWalkableGrid, findPath, buildElevationMap } from '../services/pathfinding.js';
import { queueOpportunityAttacks } from '../services/opportunityAttacks.js';
import { buildWallSet } from '../services/walls.js';
import { fireRevealEvents } from '../services/events.js';
import { resolveFluidMovement } from '../services/fluidEffects.js';
import { resolveHazardMovement } from '../services/hazardZones.js';
import { resolveSkirmishSource, seedSkirmishMap } from '../services/skirmishes.js';
import { listSkirmishPresets } from '../services/skirmishPresets.js';
import {
  MAX_FIGURE_IMAGE_BYTES,
  campaignsUsingPreset,
  clearSkirmishFigureImage,
  saveSkirmishFigureImage,
  serializeSkirmishFigures,
} from '../services/skirmishImages.js';
import { isInstallationAdmin } from '../services/admin.js';
import { getTemplateData, saveTemplate, serializeTemplate, snapshotMap } from '../services/templates.js';
import { campaignBestiary } from '../services/bestiary.js';
import { serializeEvent } from './events.js';
import {
  narrativeImagesForCampaign,
  removeNarrativeImage,
  seedDefaultNarrativeSections,
} from '../services/campaignArchive.js';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

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
    .prepare(
      `SELECT CASE WHEN c.solo_mode = 1 THEN 'jugador' ELSE m.role END AS role
         FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.campaign_id = ? AND m.user_id = ?`
    )
    .get(campaignId, userId);
}

export function isSoloCampaign(campaignId) {
  return Boolean(db.prepare('SELECT solo_mode FROM campaigns WHERE id = ?').get(campaignId)?.solo_mode);
}

// Publica una consecuencia únicamente después de resolver la interacción.
// Las de alcance personal usan el mismo filtrado backend que una tirada
// oculta: solo actor y DM. Las de grupo aparecen para toda la mesa.
function publishMarkerConsequence(campaignId, actorUserId, token, consequence) {
  const clean = typeof consequence === 'string' ? consequence.trim() : '';
  const scope = token.consequence_scope === 'party' ? 'party' : 'player';
  if (clean) {
    postSystemMessage(
      campaignId,
      `Consecuencia de «${token.name}»: ${clean}`,
      { hidden: scope === 'player', userId: actorUserId }
    );
  }
  return scope;
}

function serializeCampaign(row, role, userId) {
  const table = db.prepare('SELECT is_live FROM game_tables WHERE campaign_id = ?').get(row.id);
  const effectiveRole = row.solo_mode ? 'jugador' : role;
  const isDm = effectiveRole === 'dm';
  return {
    id: row.id,
    name: row.name,
    // La sinopsis es la brújula privada de preparación del DM. La presentación
    // pública al grupo vive en lore/objectives y sí se entrega a jugadores.
    description: isDm ? row.description : null,
    artStyle: isDm ? row.art_style ?? '' : null,
    scene: row.scene,
    // Ocultarlo en el cliente no basta: un jugador ya unido no necesita volver
    // a recibir el código con el que otras personas pueden entrar.
    inviteCode: isDm ? row.invite_code : null,
    dmUserId: row.dm_user_id,
    role: effectiveRole,
    owner: row.dm_user_id === userId,
    soloMode: Boolean(row.solo_mode),
    isLive: Boolean(table?.is_live),
    maxPlayers: row.max_players,
    lore: row.lore,
    objectives: JSON.parse(row.objectives || '[]'),
    hasWorldMap: Boolean(row.has_world_map),
    worldMapUrl: row.world_map_url ?? null,
    campaignType: row.campaign_type ?? (row.has_world_map ? 'campana' : 'escaramuza'),
    elapsedDays: row.elapsed_days ?? 0,
    // Fase D: nivel con el que se crean los personajes de esta mesa y hasta
    // dónde ha concedido el DM. Públicos: el grupo necesita saber a qué nivel
    // juega y si le toca subir.
    startingLevel: row.starting_level ?? 1,
    // Reloj de campaña (Fase F): capacidad opcional, apagada por defecto. Con
    // ella apagada el cliente no pinta ningún control temporal.
    clockEnabled: Boolean(row.clock_enabled),
    dayMinutes: row.day_minutes ?? 480,
    grantedLevel: row.granted_level ?? 1,
    levelMode: row.level_mode ?? 'milestone',
    status: row.status,
    wizardStep: row.wizard_step,
  };
}

// Cuántos jugadores (sin contar al DM) están ya unidos a la campaña — usado
// tanto para el límite de plazas al unirse como para exigir al menos uno
// antes de poder abrir la sesión en vivo.
export function countPlayers(campaignId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM campaign_members member
         JOIN campaigns campaign ON campaign.id = member.campaign_id
        WHERE member.campaign_id = ?
          AND (member.role = 'jugador' OR campaign.solo_mode = 1)`
    )
    .get(campaignId).n;
}

campaignsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, m.role FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id
       WHERE m.user_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.user.id);
  res.json({ campaigns: rows.map((r) => serializeCampaign(r, r.role, req.user.id)) });
});

// Nace como borrador con lo mínimo (nombre genérico según el tipo elegido);
// el asistente guiado (/campanas/:id/asistente) rellena el resto paso a
// paso, igual que un personaje nuevo nace en borrador para el asistente de PJ.
campaignsRouter.post('/', (req, res) => {
  const requestedType = req.body?.campaignType;
  if (requestedType !== undefined && requestedType !== 'campana' && requestedType !== 'escaramuza') {
    return res.status(400).json({ error: 'El tipo debe ser campana o escaramuza' });
  }
  if (req.body?.hasWorldMap !== undefined && typeof req.body.hasWorldMap !== 'boolean') {
    return res.status(400).json({ error: 'La opción de mapa de mundo no es válida' });
  }

  // Compatibilidad con el cliente anterior: hasWorldMap=true era una campaña
  // y false una escaramuza. Los clientes nuevos envían campaignType y el mapa
  // queda como una capacidad independiente.
  const campaignType = requestedType ?? (req.body?.hasWorldMap ? 'campana' : 'escaramuza');
  const hasWorldMap = req.body?.hasWorldMap ?? campaignType === 'campana';
  const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (requestedName.length > 80) return res.status(400).json({ error: 'El nombre admite hasta 80 caracteres' });
  const defaultName = campaignType === 'campana' ? 'Nueva campaña' : 'Nueva escaramuza';

  // Una escaramuza puede nacer de un escenario de fábrica (presetId) o de una
  // plantilla de escaramuza propia (templateId); si no llega ninguno se siembra
  // el tablero mínimo de siempre.
  const presetId = typeof req.body?.presetId === 'string' ? req.body.presetId : null;
  const templateId = req.body?.templateId;
  if ((presetId || templateId !== undefined) && campaignType !== 'escaramuza') {
    return res.status(400).json({ error: 'Solo una escaramuza puede partir de un escenario o plantilla' });
  }
  if (presetId && templateId !== undefined) {
    return res.status(400).json({ error: 'Elige un escenario predefinido o una plantilla, no las dos' });
  }
  let template = null;
  if (templateId !== undefined) {
    if (!Number.isInteger(templateId)) return res.status(400).json({ error: 'Plantilla no válida' });
    template = getTemplateData(req.user.id, templateId, 'escaramuza');
    if (!template) return res.status(404).json({ error: 'Plantilla de escaramuza no encontrada' });
  }
  const source = resolveSkirmishSource({ presetId, template });
  if (source.error) return res.status(404).json({ error: source.error });
  if (source.soloMode && req.body?.hasWorldMap === true) {
    return res.status(400).json({ error: 'Los escenarios sin DM usan únicamente su tablero táctico' });
  }

  const characterId = req.body?.characterId;
  let soloCharacter = null;
  if (source.soloMode) {
    if (!Number.isInteger(characterId)) {
      return res.status(400).json({ error: 'Elige un personaje completo para jugar este escenario sin DM' });
    }
    soloCharacter = db
      .prepare(
        `SELECT id, level FROM characters
          WHERE id = ? AND user_id = ? AND kind = 'pj'
            AND status = 'complete' AND campaign_id IS NULL AND hp_max > 0`
      )
      .get(characterId, req.user.id);
    if (!soloCharacter) {
      return res.status(400).json({ error: 'Ese personaje no está disponible para una partida en solitario' });
    }
  } else if (characterId !== undefined) {
    return res.status(400).json({ error: 'Solo los escenarios con director automático aceptan un personaje inicial' });
  }

  const startingLevel = source.startingLevel ?? 1;
  const soloCharacterLevel = soloCharacter?.level ?? null;

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO campaigns
           (name, dm_user_id, invite_code, has_world_map, campaign_type, status, solo_mode, lore, objectives,
            starting_level, granted_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        requestedName || source.name || defaultName,
        req.user.id,
        generateInviteCode(),
        hasWorldMap ? 1 : 0,
        campaignType,
        campaignType === 'campana' ? 'draft' : 'complete',
        source.soloMode ? 1 : 0,
        source.briefing ?? '',
        JSON.stringify(source.objectives ?? []),
        // Fase D: un escenario de fábrica arranca en su nivel recomendado; el
        // resto de mesas, en el 1 hasta que el DM diga otra cosa. Si el PJ que
        // entra ya es de nivel mayor, el techo concedido sube con él (nunca se
        // le baja de nivel).
        startingLevel,
        Math.max(startingLevel, soloCharacterLevel ?? 1)
      );
    const id = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'dm')").run(id, req.user.id);
    // combat_active nace en 1: el modo por turnos está activo por defecto
    // en toda mesa nueva (Fase 8.5); el DM lo alterna a modo libre cuando quiera.
    db.prepare('INSERT INTO game_tables (campaign_id, combat_active) VALUES (?, 1)').run(id);

    if (campaignType === 'campana') {
      seedDefaultNarrativeSections(id);
    } else if (source.mapData) {
      // Escenario de fábrica o plantilla propia: el tablero entra completo,
      // con sus salas de inicio abiertas y sus enemigos en el tracker.
      const seeded = seedSkirmishMap(id, req.user.id, source.mapData, {
        name: source.mapData.name,
        enemyAi: source.enemyAi,
        soloPartySize: source.soloMode ? 1 : null,
        presetId: source.presetId ?? null,
      });
      if (source.maxPlayers) {
        db.prepare('UPDATE campaigns SET max_players = ? WHERE id = ?').run(source.maxPlayers, id);
      }
      if (soloCharacter) {
        db.prepare('UPDATE characters SET campaign_id = ? WHERE id = ?').run(id, soloCharacter.id);
        // Es una prueba autocontenida, no una continuación de la aventura
        // anterior: el PJ entra recuperado aunque su ficha estuviera a 0 PG.
        db.prepare(
          `UPDATE characters
              SET hp_current = hp_max, hp_temp = 0, updated_at = datetime('now')
            WHERE id = ?`
        ).run(soloCharacter.id);
        const map = getMap(id, seeded.mapId);
        ensureCharacterTokens(map, id);
        ensureCombatantForCharacter(id, soloCharacter.id, { firstTurn: true });
        db.prepare(
          `INSERT INTO chat_messages (campaign_id, user_id, type, body, hidden)
           VALUES (?, NULL, 'system', ?, 0)`
        ).run(id, `Director automático: ${source.briefing} Entras con todos tus PG y tienes el primer turno.`);
      }
    } else {
      // La escaramuza en blanco es deliberadamente inmediata: nace completa y
      // con un tablero mínimo activo, sin asistente ni archivo.
      const mapInfo = db.prepare("INSERT INTO maps (campaign_id, name) VALUES (?, 'Escaramuza')").run(id);
      const mapId = Number(mapInfo.lastInsertRowid);
      const floorInfo = db
        .prepare("INSERT INTO map_floors (map_id, name, position) VALUES (?, 'Campo de batalla', 0)")
        .run(mapId);
      db.prepare(
        `INSERT INTO map_rooms
           (floor_id, name, x, y, width, height, revealed)
         VALUES (?, 'Escena inicial', 0, 0, 12, 8, 1)`
      ).run(floorInfo.lastInsertRowid);
      db.prepare('UPDATE game_tables SET active_map_id = ? WHERE campaign_id = ?').run(mapId, id);
    }
    return id;
  });
  const id = create();
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  res.status(201).json({ campaign: serializeCampaign(row, 'dm', req.user.id) });
});

campaignsRouter.post('/join', (req, res) => {
  const { code } = req.body ?? {};
  const row =
    typeof code === 'string'
      ? db.prepare('SELECT * FROM campaigns WHERE invite_code = ?').get(code.trim().toUpperCase())
      : undefined;
  if (!row) return res.status(404).json({ error: 'Código de invitación no válido' });

  const existing = getMembership(row.id, req.user.id);
  if (existing) return res.json({ campaign: serializeCampaign(row, existing.role, req.user.id) });

  if (row.max_players != null && countPlayers(row.id) >= row.max_players) {
    return res.status(403).json({ error: 'La campaña ya tiene todas las plazas ocupadas' });
  }
  if (row.solo_mode) {
    return res.status(403).json({ error: 'Este escenario está reservado a la partida sin DM de su propietario' });
  }

  db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'jugador')").run(
    row.id,
    req.user.id
  );
  res.status(201).json({ campaign: serializeCampaign(row, 'jugador', req.user.id) });
});

// Catálogo de escenarios de fábrica para el Hub. Va antes que `/:id` para que
// Express no lo confunda con el detalle de una campaña.
campaignsRouter.get('/escaramuzas/predefinidas', (req, res) => {
  res.json({
    presets: listSkirmishPresets(),
    puedeEditarImagenes: isInstallationAdmin(req.user),
  });
});

// Imágenes de las figuras (enemigos, objetos y trampas) de un escenario de
// fábrica.
// Son de la instalación entera, así que solo las toca su administrador; el
// listado también es solo suyo, porque enseña de antemano quién espera en
// cada sala. Se comprueba antes de leer el cuerpo, para no recibir la imagen
// entera de quien no puede subirla.
function requireInstallationAdmin(req, res, next) {
  if (isInstallationAdmin(req.user)) return next();
  res.status(403).json({ error: 'Solo el administrador puede cambiar las imágenes de los escenarios' });
}

// Las partidas en marcha de ese escenario repintan sus marcadores (misma señal
// que cualquier otro cambio de mapa: nunca viajan datos por el socket).
function notifyPresetCampaigns(presetId) {
  for (const campaignId of campaignsUsingPreset(presetId)) notifyCampaignMap(campaignId);
}

// El nombre original solo se guarda para enseñarlo en el panel; uno mal
// codificado no debe tumbar la subida.
function originalFileName(header) {
  if (typeof header !== 'string' || !header) return null;
  try {
    return decodeURIComponent(header).slice(0, 120);
  } catch {
    return null;
  }
}

campaignsRouter.get('/escaramuzas/predefinidas/:presetId/figuras', requireInstallationAdmin, (req, res) => {
  const figuras = serializeSkirmishFigures(req.params.presetId);
  if (!figuras) return res.status(404).json({ error: 'Ese escenario predefinido no existe' });
  res.json({ figuras });
});

campaignsRouter.put(
  '/escaramuzas/predefinidas/:presetId/figuras/:figureKey/imagen',
  requireInstallationAdmin,
  // Binario crudo, como el resto de subidas de la API
  expressRaw({ type: () => true, limit: MAX_FIGURE_IMAGE_BYTES }),
  (req, res) => {
    const { presetId, figureKey } = req.params;
    const result = saveSkirmishFigureImage({
      presetId,
      figureKey,
      buffer: req.body,
      mimeType: req.headers['content-type'],
      originalName: originalFileName(req.headers['x-nombre-original']),
      userId: req.user.id,
    });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    notifyPresetCampaigns(presetId);
    res.json({ figuras: serializeSkirmishFigures(presetId) });
  }
);

campaignsRouter.delete(
  '/escaramuzas/predefinidas/:presetId/figuras/:figureKey/imagen',
  requireInstallationAdmin,
  (req, res) => {
    const { presetId, figureKey } = req.params;
    const result = clearSkirmishFigureImage({ presetId, figureKey });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    notifyPresetCampaigns(presetId);
    res.json({ figuras: serializeSkirmishFigures(presetId) });
  }
);

// Guardar una escaramuza como plantilla propia reutilizable: se fotografía su
// mapa activo entero (plantas, salas con todas sus capas, puertas y
// marcadores) y queda en la biblioteca del DM como tipo 'escaramuza'.
campaignsRouter.post('/:id/guardar-plantilla', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (campaign.dm_user_id !== req.user.id || campaign.solo_mode) {
    return res.status(403).json({ error: 'Solo el DM puede guardar esta escaramuza como plantilla' });
  }
  if (campaign.campaign_type !== 'escaramuza') {
    return res.status(400).json({ error: 'Solo una escaramuza se puede guardar como escenario' });
  }
  const mapId = getActiveMapId(campaign.id);
  const map = mapId ? getMap(campaign.id, mapId) : null;
  if (!map) return res.status(400).json({ error: 'Esta partida no tiene ningún tablero activo que guardar' });

  // El snapshot no recuerda qué salas estaban reveladas (una plantilla del DM
  // se estampa siempre a oscuras), así que la escaramuza marca las suyas para
  // que al instanciarla vuelva a abrir exactamente las mismas.
  const data = snapshotMap(map);
  const revealedByRoom = db
    .prepare(
      `SELECT room.id, room.revealed, floor.position FROM map_rooms room
       JOIN map_floors floor ON floor.id = room.floor_id
       WHERE floor.map_id = ? ORDER BY floor.position, floor.id, room.id`
    )
    .all(map.id);
  let cursor = 0;
  for (const floor of data.floors ?? []) {
    for (const room of floor.rooms ?? []) {
      room.revealed = Boolean(revealedByRoom[cursor]?.revealed);
      cursor += 1;
    }
  }
  const template = saveTemplate(req.user.id, 'escaramuza', req.body?.name ?? campaign.name, data);
  res.status(201).json({ template: serializeTemplate(template) });
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
    .all(row.id)
    .map((member) => (row.solo_mode ? { ...member, role: 'jugador' } : member));
  const characters = db
    .prepare(
      `SELECT id, user_id, name, kind, class_index, race_index, level, hp_current, hp_max, ac, avatar_path AS avatarUrl
       FROM characters WHERE campaign_id = ?`
    )
    .all(row.id)
    // Las fichas completas del DM pueden contener PG/CA exactos de enemigos.
    // El jugador solo recibe PJ; el DM conserva su vista completa.
    .filter((character) => membership.role === 'dm' || character.kind === 'pj');

  res.json({ campaign: serializeCampaign(row, membership.role, req.user.id), members, characters });
});

campaignsRouter.get('/:id/bestiario', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  res.json({ creatures: campaignBestiary(req.params.id) });
});

// Editar campaña (solo el DM): lore de apertura, objetivos, plazas y si forma
// parte de un mapa de mundo. Solo se tocan los campos presentes en el body.
campaignsRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id || row.solo_mode) {
    return res.status(403).json({ error: 'Solo el DM puede editar la campaña' });
  }

  const {
    name, description, artStyle, lore, objectives, maxPlayers, hasWorldMap,
    campaignType, status, wizardStep, startingLevel, clockEnabled,
  } = req.body ?? {};
  const sets = [];
  const values = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) {
      return res.status(400).json({ error: 'La campaña necesita un nombre' });
    }
    sets.push('name = ?');
    values.push(name.trim());
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > 2000) {
      return res.status(400).json({ error: 'La sinopsis admite hasta 2.000 caracteres' });
    }
    sets.push('description = ?');
    values.push(description);
  }
  if (artStyle !== undefined) {
    if (typeof artStyle !== 'string' || artStyle.length > 1000) {
      return res.status(400).json({ error: 'El estilo artístico admite hasta 1.000 caracteres' });
    }
    sets.push('art_style = ?');
    values.push(artStyle.trim());
  }
  if (lore !== undefined) {
    if (typeof lore !== 'string' || lore.length > 5000) {
      return res.status(400).json({ error: 'Lore no válido' });
    }
    sets.push('lore = ?');
    values.push(lore);
  }
  if (objectives !== undefined) {
    if (!(Array.isArray(objectives) && objectives.length <= 30 && objectives.every((o) => typeof o === 'string'))) {
      return res.status(400).json({ error: 'Objetivos no válidos' });
    }
    sets.push('objectives = ?');
    values.push(JSON.stringify(objectives.map((o) => o.trim().slice(0, 200)).filter(Boolean)));
  }
  if (maxPlayers !== undefined) {
    if (maxPlayers !== null && !(Number.isInteger(maxPlayers) && maxPlayers >= 1 && maxPlayers <= 20)) {
      return res.status(400).json({ error: 'Número de plazas no válido' });
    }
    sets.push('max_players = ?');
    values.push(maxPlayers ?? null);
  }
  if (startingLevel !== undefined) {
    if (!(Number.isInteger(startingLevel) && startingLevel >= 1 && startingLevel <= 20)) {
      return res.status(400).json({ error: 'El nivel inicial debe estar entre 1 y 20' });
    }
    sets.push('starting_level = ?');
    values.push(startingLevel);
    // El nivel concedido nunca puede quedar por debajo del inicial: si la
    // mesa arranca en 3, nadie debería tener pendiente «subir» hasta 3.
    if (startingLevel > row.granted_level) {
      sets.push('granted_level = ?');
      values.push(startingLevel);
    }
  }
  // El reloj también se puede ajustar desde el asistente de la campaña, no
  // solo desde la mesa (Fase F): nace apagado y encenderlo no cambia ninguna
  // regla, solo hace visible el tiempo.
  if (clockEnabled !== undefined) {
    if (typeof clockEnabled !== 'boolean') {
      return res.status(400).json({ error: 'La opción de reloj no es válida' });
    }
    sets.push('clock_enabled = ?');
    values.push(clockEnabled ? 1 : 0);
  }
  if (hasWorldMap !== undefined) {
    if (typeof hasWorldMap !== 'boolean') {
      return res.status(400).json({ error: 'La opción de mapa de mundo no es válida' });
    }
    sets.push('has_world_map = ?');
    values.push(hasWorldMap ? 1 : 0);
  }
  if (campaignType !== undefined) {
    if (campaignType !== 'campana' && campaignType !== 'escaramuza') {
      return res.status(400).json({ error: 'El tipo debe ser campana o escaramuza' });
    }
    sets.push('campaign_type = ?');
    values.push(campaignType);
  }
  if (wizardStep !== undefined) {
    if (!(Number.isInteger(wizardStep) && wizardStep >= 0 && wizardStep <= 10)) {
      return res.status(400).json({ error: 'Paso del asistente no válido' });
    }
    sets.push('wizard_step = ?');
    values.push(wizardStep);
  }
  if (status !== undefined) {
    if (status !== 'draft' && status !== 'complete') {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    // Terminar el asistente exige al menos un nombre ya guardado
    if (status === 'complete' && !(name ?? row.name)?.trim()) {
      return res.status(400).json({ error: 'La campaña necesita un nombre para terminar el asistente' });
    }
    sets.push('status = ?');
    values.push(status);
  }

  if (sets.length) {
    db.transaction(() => {
      db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...values, row.id);
      if (campaignType === 'campana') seedDefaultNarrativeSections(row.id);
    })();
  }
  const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.id);
  res.json({ campaign: serializeCampaign(updated, 'dm', req.user.id) });
});

// Invalida el código anterior al instante. No hace falta guardar un historial:
// solo el valor único actual permite que una cuenta nueva se una.
// Conceder un nivel al grupo (Fase D). No toca ninguna ficha: sube el techo
// de la campaña y cada jugador completa su subida cuando quiera. El aviso
// llega por socket a quien esté en la mesa, sin recargar.
campaignsRouter.post('/:id/nivel', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id || row.solo_mode) {
    return res.status(403).json({ error: 'Solo el DM concede niveles' });
  }

  const { level } = req.body ?? {};
  if (level !== undefined && level !== null && !Number.isInteger(level)) {
    return res.status(400).json({ error: 'Nivel no válido' });
  }
  const result = grantCampaignLevel(row.id, level ?? null);
  if (!result.ok) return res.status(400).json({ error: result.error });

  if (result.grantedLevel !== result.previousLevel) {
    notifyCampaignLevel(row.id, result.grantedLevel);
    postSystemMessage(row.id, `El grupo alcanza el nivel ${result.grantedLevel}. Subid vuestras fichas cuando queráis.`);
  }
  res.json({ grantedLevel: result.grantedLevel });
});

// Descanso de mesa (Fase F). Lo declara quien dirige y afecta al grupo
// entero: ocho horas son ocho horas para todos, no ocho por jugador. Los
// dados de golpe los gasta cada jugador desde su ficha, aparte.
//
// Con el reloj apagado el descanso hace exactamente lo mismo sin tocar el
// tiempo: ninguna regla depende de esa capacidad.
campaignsRouter.post('/:id/descanso', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  const membership = getMembership(row.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  // En una escaramuza sin DM la cuenta juega sola: puede declarar su propio
  // descanso. En una mesa con DM, lo declara el DM.
  if (!row.solo_mode && row.dm_user_id !== req.user.id) {
    return res.status(403).json({ error: 'El descanso lo declara el DM' });
  }

  const tipo = req.body?.tipo;
  const result = restCampaign(row.id, tipo);
  if (!result.ok) return res.status(400).json({ error: result.error });

  const recuperados = result.restored.length;
  postSystemMessage(
    row.id,
    tipo === 'largo'
      ? `El grupo hace un descanso largo${recuperados ? `: ${recuperados} ficha${recuperados === 1 ? '' : 's'} al máximo` : ''}.`
      : 'El grupo hace un descanso corto.'
  );
  notifyCampaignMap(row.id);
  notifyCombat(row.id);
  // El contador de jornadas lo pinta el mapa de mundo cuando la campaña lo
  // tiene: si el descanso ha cruzado de día, hay que refrescarlo también.
  if (result.clock?.daysCrossed) notifyCampaignWorld(row.id);
  res.json({ ok: true, tipo, restored: result.restored, clock: result.clock });
});

// Encender o apagar el reloj de campaña (Fase F). Apagarlo conserva la hora,
// así que volver a encenderlo no pierde nada.
campaignsRouter.post('/:id/reloj', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el DM ajusta el reloj de la campaña' });
  }
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Indica si el reloj queda encendido' });

  const result = setCampaignClock(row.id, enabled);
  if (!result.ok) return res.status(400).json({ error: result.error });
  notifyCampaignMap(row.id);
  res.json({ clockEnabled: result.clockEnabled, dayMinutes: result.dayMinutes });
});

campaignsRouter.post('/:id/invitacion/regenerar', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id || row.solo_mode) {
    return res.status(403).json({ error: 'Solo el DM puede regenerar la invitación' });
  }

  const inviteCode = generateInviteCode();
  db.prepare('UPDATE campaigns SET invite_code = ? WHERE id = ?').run(inviteCode, row.id);
  res.json({ inviteCode });
});

// Saca a un jugador de una campaña, venga la orden del DM (expulsar) o de él
// mismo (abandonar): la limpieza es exactamente la misma, solo cambia quién
// tiene derecho a pedirla. Conserva la ficha del jugador, pero la desvincula
// de la campaña y retira sus piezas persistentes del tablero. Después se le
// saca de la sala Socket para que deje de recibir datos inmediatamente.
function removePlayerFromCampaign(row, userId) {
  const membership = db
    .prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .get(row.id, userId);
  if (!membership || membership.role !== 'jugador') {
    return { error: 'Ese jugador no pertenece a la campaña', status: 404 };
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE game_tables SET combat_turn_id = NULL
       WHERE campaign_id = ? AND combat_turn_id IN (
         SELECT id FROM combatants WHERE campaign_id = ? AND character_id IN (
           SELECT id FROM characters WHERE campaign_id = ? AND user_id = ?
         )
       )`
    ).run(row.id, row.id, row.id, userId);
    db.prepare(
      `DELETE FROM map_character_tokens WHERE character_id IN (
         SELECT id FROM characters WHERE campaign_id = ? AND user_id = ?
       )`
    ).run(row.id, userId);
    db.prepare(
      `DELETE FROM combatants WHERE campaign_id = ? AND character_id IN (
         SELECT id FROM characters WHERE campaign_id = ? AND user_id = ?
       )`
    ).run(row.id, row.id, userId);
    db.prepare(
      "UPDATE characters SET campaign_id = NULL, updated_at = datetime('now') WHERE campaign_id = ? AND user_id = ?"
    ).run(row.id, userId);
    db.prepare(
      "DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ? AND role = 'jugador'"
    ).run(row.id, userId);
  })();

  evictCampaignMember(row.id, userId);
  notifyCombat(row.id);
  notifyCampaignMap(row.id);
  return { ok: true, playerCount: countPlayers(row.id) };
}

campaignsRouter.delete('/:id/jugadores/:userId', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id || row.solo_mode) {
    return res.status(403).json({ error: 'Solo el DM puede expulsar jugadores' });
  }

  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Jugador no válido' });
  }

  const result = removePlayerFromCampaign(row, userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// Abandonar por decisión propia. El DM no puede usarlo: la campaña se quedaría
// sin nadie que la lleve, y traspasar el rol es otra conversación (fase
// pendiente de co-DM/transferencia). Para él, la salida sigue siendo borrarla.
campaignsRouter.delete('/:id/abandonar', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id === req.user.id) {
    return res.status(400).json({
      error: 'Eres el DM de esta campaña: no puedes abandonarla, solo borrarla.',
    });
  }

  const result = removePlayerFromCampaign(row, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// Borrar una campaña entera (solo su DM). Las fichas de personaje no se
// pierden: characters.campaign_id pasa a NULL; el resto (mesa, chat,
// combatientes, mapas) cae en cascada.
campaignsRouter.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el DM puede borrar la campaña' });
  }

  const narrativeImages = narrativeImagesForCampaign(row.id);
  db.transaction(() => {
    // active_map_id no tiene ON DELETE: se limpia antes de que caigan los mapas
    db.prepare('UPDATE game_tables SET active_map_id = NULL WHERE campaign_id = ?').run(row.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(row.id);
  })();
  narrativeImages.forEach(removeNarrativeImage);
  res.json({ ok: true });
});

// --- Panel de gestión del DM (Fase 16) ------------------------------------
// NPCs/jefes de la campaña y biblioteca (objetos/hechizos) asignada a ella.

function requireDm(req, res) {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Campaña no encontrada' });
    return null;
  }
  if (row.dm_user_id !== req.user.id || row.solo_mode) {
    res.status(403).json({ error: 'Solo el DM gestiona la campaña' });
    return null;
  }
  return row;
}

const LIBRARY_CATEGORY = { objetos: 'equipment', hechizos: 'spells' };
const LIBRARY_CONTENT_TYPE = { objetos: 'objeto', hechizos: 'hechizo' };

campaignsRouter.get('/:id/gestion', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;

  // Personajes del DM (kind='boss'): sirven como jefes hostiles y como PNJ.
  // `assigned` = ya vinculado a esta campaña (characters.campaign_id).
  const characters = db
    .prepare(
      `SELECT id, name, level, hp_max, ac, avatar_path AS avatarUrl, campaign_id, dm_category
       FROM characters WHERE user_id = ? AND kind = 'boss' ORDER BY name`
    )
    .all(req.user.id)
    .map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      hpMax: c.hp_max,
      ac: c.ac,
      avatarUrl: c.avatarUrl,
      dmCategory: c.dm_category ?? 'jefe',
      assigned: c.campaign_id === campaign.id,
      otherCampaign: c.campaign_id != null && c.campaign_id !== campaign.id,
    }));

  const assignedIds = {
    objeto: new Set(
      db.prepare("SELECT content_id FROM campaign_library WHERE campaign_id = ? AND content_type = 'objeto'").all(campaign.id).map((r) => r.content_id)
    ),
    hechizo: new Set(
      db.prepare("SELECT content_id FROM campaign_library WHERE campaign_id = ? AND content_type = 'hechizo'").all(campaign.id).map((r) => r.content_id)
    ),
  };
  const serializeLib = (tipo) =>
    listCustomRows(req.user.id, LIBRARY_CATEGORY[tipo]).map((row) => ({
      ...serializeCustomEntry(row, LIBRARY_CATEGORY[tipo]),
      assigned: assignedIds[LIBRARY_CONTENT_TYPE[tipo]].has(row.id),
    }));

  res.json({
    characters,
    library: { objetos: serializeLib('objetos'), hechizos: serializeLib('hechizos') },
  });
});

campaignsRouter.put('/:id/biblioteca/:tipo/:contentId', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;
  const contentType = LIBRARY_CONTENT_TYPE[req.params.tipo];
  if (!contentType) return res.status(404).json({ error: 'Tipo desconocido' });
  const category = LIBRARY_CATEGORY[req.params.tipo];
  const contentId = Number(req.params.contentId);
  // Solo contenido propio del DM
  const owned = listCustomRows(req.user.id, category).some((r) => r.id === contentId);
  if (!owned) return res.status(404).json({ error: 'Entrada no encontrada' });
  db.prepare(
    'INSERT OR IGNORE INTO campaign_library (campaign_id, content_type, content_id) VALUES (?, ?, ?)'
  ).run(campaign.id, contentType, contentId);
  res.json({ ok: true, assigned: true });
});

campaignsRouter.delete('/:id/biblioteca/:tipo/:contentId', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;
  const contentType = LIBRARY_CONTENT_TYPE[req.params.tipo];
  if (!contentType) return res.status(404).json({ error: 'Tipo desconocido' });
  db.prepare(
    'DELETE FROM campaign_library WHERE campaign_id = ? AND content_type = ? AND content_id = ?'
  ).run(campaign.id, contentType, Number(req.params.contentId));
  res.json({ ok: true, assigned: false });
});

// --- Eventos colgados de la campaña (Fase 18) ------------------------------
// Los enlaces son cosa del DM: dónde ha colgado cada evento de su biblioteca
// (la campaña, una sala, un marcador, una ubicación o una ruta) y su estado.

const EVENT_TARGET_TYPES = new Set(['campana', 'sala', 'marcador', 'ubicacion', 'ruta']);

function routeTargetLabel(route) {
  const path = `${route.from_name} ${route.one_way ? '→' : '↔'} ${route.to_name}`;
  const name = route.route_label ? `${route.route_label}: ${path}` : path;
  const cost = `${route.cost} jornada${route.cost === 1 ? '' : 's'}`;
  return `${name} · ${cost}${route.world_map_name ? ` (${route.world_map_name})` : ''}`;
}

campaignsRouter.get('/:id/eventos', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;
  const links = db
    .prepare(
      `SELECT l.*, e.name, e.description, e.effect, e.trigger_kind, e.trigger_every, e.hidden,
              r.name AS room_name, t.name AS token_name, wl.name AS location_name,
              wr.label AS route_label, wr.cost, wr.one_way,
              wr_from.name AS from_name, wr_to.name AS to_name, wr_map.name AS world_map_name
       FROM event_links l
       JOIN dm_events e ON e.id = l.event_id
       LEFT JOIN map_rooms r ON l.target_type = 'sala' AND r.id = l.target_id
       LEFT JOIN map_tokens t ON l.target_type = 'marcador' AND t.id = l.target_id
       LEFT JOIN world_locations wl ON l.target_type = 'ubicacion' AND wl.id = l.target_id
       LEFT JOIN world_routes wr ON l.target_type = 'ruta' AND wr.id = l.target_id
       LEFT JOIN world_locations wr_from ON wr_from.id = wr.from_location_id
       LEFT JOIN world_locations wr_to ON wr_to.id = wr.to_location_id
       LEFT JOIN world_maps wr_map ON wr_map.id = wr.world_map_id
       WHERE l.campaign_id = ? ORDER BY l.id`
    )
    .all(campaign.id);
  // Destinos disponibles para colgar eventos: salas y marcadores de los
  // mapas de esta campaña (para los selectores del panel de gestión)
  const rooms = db
    .prepare(
      `SELECT r.id, r.name, m.name AS map_name FROM map_rooms r
       JOIN map_floors f ON f.id = r.floor_id JOIN maps m ON m.id = f.map_id
       WHERE m.campaign_id = ? ORDER BY m.name, r.name`
    )
    .all(campaign.id);
  const tokens = db
    .prepare(
      `SELECT t.id, t.name, t.kind, m.name AS map_name FROM map_tokens t
       JOIN map_rooms r ON r.id = t.room_id JOIN map_floors f ON f.id = r.floor_id
       JOIN maps m ON m.id = f.map_id WHERE m.campaign_id = ? ORDER BY m.name, t.name`
    )
    .all(campaign.id);
  const worldLocations = db
    .prepare(
      `SELECT l.id, l.name, wm.name AS world_map_name FROM world_locations l
       LEFT JOIN world_maps wm ON wm.id = l.world_map_id
       WHERE l.campaign_id = ? ORDER BY wm.name, l.name`
    )
    .all(campaign.id);
  const worldRoutes = db
    .prepare(
      `SELECT wr.id, wr.label AS route_label, wr.cost, wr.one_way,
              origin.name AS from_name, destination.name AS to_name, wm.name AS world_map_name
       FROM world_routes wr
       JOIN world_locations origin ON origin.id = wr.from_location_id
       JOIN world_locations destination ON destination.id = wr.to_location_id
       JOIN world_maps wm ON wm.id = wr.world_map_id
       WHERE wr.campaign_id = ? ORDER BY wm.name, origin.name, destination.name`
    )
    .all(campaign.id);

  res.json({
    links: links.map((l) => ({
      id: l.id,
      event: serializeEvent({ ...l, id: l.event_id }),
      targetType: l.target_type,
      targetId: l.target_id,
      targetName:
        l.target_type === 'sala'
          ? l.room_name ?? 'Sala borrada'
          : l.target_type === 'marcador'
            ? l.token_name ?? 'Marcador borrado'
            : l.target_type === 'ubicacion'
              ? l.location_name ?? 'Ubicación borrada'
              : l.target_type === 'ruta'
                ? l.from_name && l.to_name
                  ? routeTargetLabel(l)
                  : 'Ruta borrada'
              : 'Toda la campaña',
      fired: Boolean(l.fired),
      lastFiredRound: l.last_fired_round,
    })),
    targets: {
      rooms: rooms.map((r) => ({ id: r.id, label: `${r.name} (${r.map_name})` })),
      tokens: tokens.map((t) => ({ id: t.id, label: `${t.name} · ${t.kind} (${t.map_name})` })),
      locations: worldLocations.map((l) => ({
        id: l.id,
        label: l.world_map_name ? `${l.name} (${l.world_map_name})` : l.name,
      })),
      routes: worldRoutes.map((route) => ({ id: route.id, label: routeTargetLabel(route) })),
    },
  });
});

campaignsRouter.post('/:id/eventos', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;
  const { eventId, targetType = 'campana', targetId } = req.body ?? {};
  const event = db.prepare('SELECT id, trigger_kind FROM dm_events WHERE id = ? AND user_id = ?').get(eventId, req.user.id);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
  if (!EVENT_TARGET_TYPES.has(targetType)) return res.status(400).json({ error: 'Destino no válido' });

  let cleanTargetId = null;
  if (targetType === 'sala') {
    const room = db
      .prepare(
        `SELECT r.id FROM map_rooms r JOIN map_floors f ON f.id = r.floor_id
         JOIN maps m ON m.id = f.map_id WHERE r.id = ? AND m.campaign_id = ?`
      )
      .get(targetId, campaign.id);
    if (!room) return res.status(400).json({ error: 'Sala no válida' });
    cleanTargetId = room.id;
  } else if (targetType === 'marcador') {
    const token = db
      .prepare(
        `SELECT t.id FROM map_tokens t JOIN map_rooms r ON r.id = t.room_id
         JOIN map_floors f ON f.id = r.floor_id JOIN maps m ON m.id = f.map_id
         WHERE t.id = ? AND m.campaign_id = ?`
      )
      .get(targetId, campaign.id);
    if (!token) return res.status(400).json({ error: 'Marcador no válido' });
    cleanTargetId = token.id;
  } else if (targetType === 'ubicacion') {
    const location = db
      .prepare('SELECT id FROM world_locations WHERE id = ? AND campaign_id = ?')
      .get(targetId, campaign.id);
    if (!location) return res.status(400).json({ error: 'Ubicación no válida' });
    cleanTargetId = location.id;
  } else if (targetType === 'ruta') {
    if (event.trigger_kind !== 'revelar') {
      return res.status(400).json({ error: 'Los eventos automáticos de ruta deben usar el disparador de viaje' });
    }
    const route = db
      .prepare('SELECT id FROM world_routes WHERE id = ? AND campaign_id = ?')
      .get(targetId, campaign.id);
    if (!route) return res.status(400).json({ error: 'Ruta no válida' });
    cleanTargetId = route.id;
  }

  const info = db
    .prepare('INSERT INTO event_links (event_id, campaign_id, target_type, target_id) VALUES (?, ?, ?, ?)')
    .run(eventId, campaign.id, targetType, cleanTargetId);
  res.status(201).json({ ok: true, linkId: info.lastInsertRowid });
});

// Rearmar un enlace ya disparado (revelar es de un solo uso): vuelve a quedar
// pendiente, útil para reutilizar la trampa narrativa en otra sesión
campaignsRouter.post('/:id/eventos/:linkId/rearmar', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;
  db.prepare('UPDATE event_links SET fired = 0, last_fired_round = NULL WHERE id = ? AND campaign_id = ?').run(
    req.params.linkId,
    campaign.id
  );
  res.json({ ok: true });
});

campaignsRouter.delete('/:id/eventos/:linkId', (req, res) => {
  const campaign = requireDm(req, res);
  if (!campaign) return;
  db.prepare('DELETE FROM event_links WHERE id = ? AND campaign_id = ?').run(req.params.linkId, campaign.id);
  res.json({ ok: true });
});

// Mapa activo de la mesa, filtrado según el rol: el DM lo ve entero; el
// jugador solo las salas reveladas y las puertas visibles (filtrado en el
// servidor, como las tiradas ocultas).
campaignsRouter.get('/:id/mapa-activo', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });

  const activeMapId = getActiveMapId(req.params.id);
  const map = activeMapId ? getMap(req.params.id, activeMapId) : null;
  if (!map) return res.json({ map: null });

  // Los personajes sin token aparecen en la primera sala revelada libre
  ensureCharacterTokens(map, req.params.id);

  // Todo personaje con token en el mapa entra solo al tracker de iniciativa
  // (mismo patrón que los enemigos al revelarse su sala): con el modo por
  // turnos activo, en cuanto estás en el tablero tienes tu sitio en el orden.
  const presentCharacterIds = db
    .prepare('SELECT character_id FROM map_character_tokens WHERE map_id = ?')
    .all(activeMapId)
    .map((r) => r.character_id);
  let anyJoined = false;
  for (const characterId of presentCharacterIds) {
    if (ensureCombatantForCharacter(req.params.id, characterId)) anyJoined = true;
  }
  if (anyJoined) notifyCombat(req.params.id);

  // El DM puede pedir la vista de los jugadores (?vista=jugador) para
  // comprobar qué está viendo el grupo realmente
  const asPlayer = membership.role === 'dm' && req.query.vista === 'jugador';
  res.json({
    map:
      membership.role === 'dm' && !asPlayer
        ? serializeFullMap(map, req.params.id)
        : serializeMapForPlayer(map, asPlayer ? null : req.user.id),
  });
});

// Mover el token de un personaje en el mapa activo: el dueño del personaje
// o el DM. La casilla de destino debe ser una casilla activa de una sala de
// la misma planta; el jugador además solo puede pisar salas reveladas.
campaignsRouter.post('/:id/mapa-activo/personajes/:characterId/mover', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  const isDm = membership.role === 'dm';

  const character = db
    .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ?')
    .get(req.params.characterId, req.params.id);
  if (!character) return res.status(404).json({ error: 'Personaje no encontrado en esta campaña' });
  if (!isDm && character.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo puedes mover tu propio personaje' });
  }

  const activeMapId = getActiveMapId(req.params.id);
  const activeMap = activeMapId ? getMap(req.params.id, activeMapId) : null;
  const token = activeMapId
    ? db
        .prepare('SELECT * FROM map_character_tokens WHERE map_id = ? AND character_id = ?')
        .get(activeMapId, character.id)
    : undefined;
  if (!token) return res.status(404).json({ error: 'El personaje aún no está en el tablero' });

  const { x, y } = req.body ?? {};
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: 'Casilla de destino no válida' });
  }

  const currentRoom = db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(token.room_id);
  const targetRoom = db
    .prepare(
      `SELECT r.* FROM map_rooms r WHERE r.floor_id = ?
         AND ? >= r.x AND ? < r.x + r.width AND ? >= r.y AND ? < r.y + r.height`
    )
    .all(currentRoom.floor_id, x, x, y, y)
    .find(
      (r) =>
        ![
          ...JSON.parse(r.disabled_cells || '[]'),
          ...JSON.parse(r.obstacle_cells || '[]'),
        ].some(([c, w]) => c === x - r.x && w === y - r.y)
    );
  if (!targetRoom) {
    return res.status(400).json({ error: 'Ahí no hay suelo que pisar' });
  }
  // El jugador solo pisa salas reveladas, salvo la que ya ocupa su token
  // (p. ej. si el DM lo colocó en una sala aún sin revelar)
  if (!isDm && !targetRoom.revealed && targetRoom.id !== token.room_id) {
    return res.status(400).json({ error: 'No puedes entrar en una zona sin descubrir' });
  }

  // Movimiento por camino real (no línea recta): el coste es el del camino
  // más barato entre casillas pisables, contando terreno difícil, sobre las
  // salas que el jugador puede atravesar (reveladas + la suya). Sin camino
  // no hay movimiento: las paredes y huecos ya no se saltan; entre salas
  // separadas se cruza pisando el umbral de una puerta, como siempre. Con el
  // modo por turnos activo, ese coste se descuenta del presupuesto del
  // turno; el DM mueve sin restricción (reposiciona la escena a placer).
  let movementPath = [{ x: token.x, y: token.y }, { x, y }];
  if (!isDm) {
    const traversable = db
      .prepare('SELECT * FROM map_rooms WHERE floor_id = ? AND (revealed = 1 OR id = ?)')
      .all(currentRoom.floor_id, token.room_id);
    const traversableIds = traversable.map((r) => r.id);
    const traversableDoors = traversableIds.length
      ? db
          .prepare(
            `SELECT * FROM map_doors WHERE map_id = ? AND (from_room_id IN (${traversableIds
              .map(() => '?')
              .join(',')}) OR to_room_id IN (${traversableIds.map(() => '?').join(',')}))`
          )
          .all(activeMapId, ...traversableIds, ...traversableIds)
      : [];
    const pathResult = findPath(
      buildWalkableGrid(traversable, activeMap?.fluid_effects),
      { x: token.x, y: token.y },
      { x, y },
      150,
      buildWallSet(traversable, traversableDoors),
      buildElevationMap(traversable)
    );
    if (!pathResult) {
      return res.status(400).json({ error: 'No hay camino hasta esa casilla' });
    }
    movementPath = [{ x: token.x, y: token.y }, ...pathResult.path];
    const spend = trySpendMovement(req.params.id, character.id, pathResult.cost);
    if (!spend.ok) return res.status(400).json({ error: spend.error });
  }

  // ¿La casilla de destino es el umbral de una puerta? Pisarla la cruza:
  // si está cerrada y puede abrirse (control jugador, o cualquier puerta si
  // eres DM), se abre revelando ambos lados, y el token aparece en el otro
  // extremo — también entre plantas con escaleras y portales.
  const door = db
    .prepare(
      `SELECT * FROM map_doors WHERE map_id = ? AND (
         (from_room_id = ? AND from_x = ? AND from_y = ?) OR
         (to_room_id = ? AND to_x = ? AND to_y = ?))`
    )
    .get(activeMapId, targetRoom.id, x, y, targetRoom.id, x, y);

  let finalRoomId = targetRoom.id;
  let finalX = x;
  let finalY = y;
  let newlyRevealed = [];
  if (door && (door.is_open || isDm || door.control === 'jugador')) {
    if (!door.is_open) {
      newlyRevealed = db
        .prepare('SELECT id FROM map_rooms WHERE id IN (?, ?) AND revealed = 0')
        .all(door.from_room_id, door.to_room_id)
        .map((r) => r.id);
      db.prepare('UPDATE map_doors SET is_open = 1 WHERE id = ?').run(door.id);
      db.prepare('UPDATE map_rooms SET revealed = 1 WHERE id IN (?, ?)').run(
        door.from_room_id,
        door.to_room_id
      );
    }
    const isFromSide =
      door.from_room_id === targetRoom.id && door.from_x === x && door.from_y === y;
    finalRoomId = isFromSide ? door.to_room_id : door.from_room_id;
    finalX = isFromSide ? door.to_x : door.from_x;
    finalY = isFromSide ? door.to_y : door.from_y;
  }

  db.prepare('UPDATE map_character_tokens SET room_id = ?, x = ?, y = ? WHERE id = ?').run(
    finalRoomId,
    finalX,
    finalY,
    token.id
  );
  const finalRoom = finalRoomId === targetRoom.id
    ? targetRoom
    : db.prepare('SELECT * FROM map_rooms WHERE id = ?').get(finalRoomId);
  const fluidPositions = movementPath.slice(1).map((position) => ({
    floorId: currentRoom.floor_id,
    x: position.x,
    y: position.y,
  }));
  if (
    finalRoom &&
    !fluidPositions.some(
      (position) => position.floorId === finalRoom.floor_id && position.x === finalX && position.y === finalY
    )
  ) {
    fluidPositions.push({ floorId: finalRoom.floor_id, x: finalX, y: finalY });
  }
  const fluidResult = resolveFluidMovement({
    campaignId: req.params.id,
    mapId: activeMapId,
    targetKind: 'personaje',
    targetId: character.id,
    positions: fluidPositions,
  });
  const hazardResult = resolveHazardMovement({
    campaignId: req.params.id,
    mapId: activeMapId,
    targetKind: 'personaje',
    targetId: character.id,
    positions: fluidPositions,
  });
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  if (!isDm) {
    const moverCombatant = db
      .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
      .get(req.params.id, character.id);
    queueOpportunityAttacks({
      campaignId: req.params.id,
      moverKind: 'personaje',
      moverCharacterId: character.id,
      moverName: character.name,
      moverCombatant,
      floorId: currentRoom.floor_id,
      path: movementPath,
    });
    // Moverse SIEMPRE cambia el tracker: `trySpendMovement` acaba de descontar
    // las casillas del turno. Avisar solo cuando había ataques de oportunidad o
    // fluidos dejaba a la mesa con el movimiento intacto en el HUD y el área de
    // alcance entera, hasta que otro evento refrescaba el combate.
    notifyCombat(req.params.id);
  } else if (fluidResult.changed || hazardResult.changed) {
    notifyCombat(req.params.id);
  }
  if (newlyRevealed.length) {
    const spawned = spawnRoomEnemies(req.params.id, newlyRevealed);
    if (spawned.added > 0) {
      notifyCombat(req.params.id);
      notifyBestiary(req.params.id);
    }
    if (spawned.encounterStarted) notifyCombatStarted(req.params.id);
    fireRevealEvents(req.params.id, newlyRevealed);
  }
  res.json({ ok: true });
});

// Abrir (o cerrar, solo el DM) una puerta del mapa activo desde la mesa.
// Abrirla revela las salas de ambos lados: así se descubre el tablero de
// detrás al entrar por una puerta. El jugador solo puede abrir puertas de
// control 'jugador' que tocan una sala ya revelada; las del DM (llave,
// secretas) ni siquiera le llegan al socket mientras estén cerradas.
campaignsRouter.post('/:id/puertas/:doorId/abrir', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  const isDm = membership.role === 'dm';
  const open = req.body?.open !== false;

  const activeMapId = getActiveMapId(req.params.id);
  const door = activeMapId
    ? db.prepare('SELECT * FROM map_doors WHERE id = ? AND map_id = ?').get(req.params.doorId, activeMapId)
    : undefined;
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada en el mapa activo' });

  if (!isDm) {
    if (!open) return res.status(403).json({ error: 'Solo el DM puede cerrar puertas' });
    if (door.control !== 'jugador') {
      return res.status(403).json({ error: 'La puerta no cede: está cerrada con llave o atrancada' });
    }
    const revealedSides = db
      .prepare('SELECT COUNT(*) AS n FROM map_rooms WHERE id IN (?, ?) AND revealed = 1')
      .get(door.from_room_id, door.to_room_id).n;
    if (revealedSides === 0) return res.status(403).json({ error: 'No ves ninguna puerta ahí' });

    // Abrir una puerta cuesta la acción del turno y solo funciona al lado:
    // se busca el personaje del jugador y se mide la distancia (Chebyshev,
    // misma regla que el resto del tablero) a cualquiera de los dos lados.
    const character = db
      .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ? AND user_id = ?')
      .get(req.body?.characterId, req.params.id, req.user.id);
    if (!character) return res.status(400).json({ error: 'Personaje no válido' });

    const charToken = db
      .prepare(
        `SELECT t.*, r.floor_id FROM map_character_tokens t JOIN map_rooms r ON r.id = t.room_id
         WHERE t.map_id = ? AND t.character_id = ?`
      )
      .get(activeMapId, character.id);
    if (!charToken) return res.status(400).json({ error: 'Tu personaje no está en el tablero' });

    const fromFloor = db.prepare('SELECT floor_id FROM map_rooms WHERE id = ?').get(door.from_room_id);
    const toFloor = db.prepare('SELECT floor_id FROM map_rooms WHERE id = ?').get(door.to_room_id);
    const nearFrom =
      charToken.floor_id === fromFloor.floor_id &&
      Math.max(Math.abs(door.from_x - charToken.x), Math.abs(door.from_y - charToken.y)) <= 1;
    const nearTo =
      charToken.floor_id === toFloor.floor_id &&
      Math.max(Math.abs(door.to_x - charToken.x), Math.abs(door.to_y - charToken.y)) <= 1;
    if (!nearFrom && !nearTo) {
      return res.status(400).json({ error: 'Tienes que estar al lado de la puerta' });
    }

    const actionSpend = trySpendAction(req.params.id, character.id);
    if (!actionSpend.ok) return res.status(400).json({ error: actionSpend.error });

    if (door.skill) {
      const roll = req.body?.roll;
      if (!roll || typeof roll.total !== 'number') {
        return res.status(400).json({ error: 'Falta la tirada de habilidad' });
      }
      if (roll.total < door.dc) {
        return res.json({ ok: true, opened: false, success: false, dc: door.dc });
      }
    }
  }

  // Salas que se van a revelar ahora: sus enemigos entrarán al tracker
  const newlyRevealed = open
    ? db
        .prepare('SELECT id FROM map_rooms WHERE id IN (?, ?) AND revealed = 0')
        .all(door.from_room_id, door.to_room_id)
        .map((r) => r.id)
    : [];

  db.transaction(() => {
    db.prepare('UPDATE map_doors SET is_open = ? WHERE id = ?').run(open ? 1 : 0, door.id);
    if (open) {
      db.prepare('UPDATE map_rooms SET revealed = 1 WHERE id IN (?, ?)').run(
        door.from_room_id,
        door.to_room_id
      );
    }
  })();
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  if (newlyRevealed.length) {
    const spawned = spawnRoomEnemies(req.params.id, newlyRevealed);
    if (spawned.added > 0) {
      notifyCombat(req.params.id);
      notifyBestiary(req.params.id);
    }
    if (spawned.encounterStarted) notifyCombatStarted(req.params.id);
    fireRevealEvents(req.params.id, newlyRevealed);
  }

  const map = getMap(req.params.id, activeMapId);
  res.json({
    ok: true,
    opened: open,
    success: true,
    dc: !isDm && door.skill ? door.dc : undefined,
    map: isDm ? serializeFullMap(map, req.params.id) : serializeMapForPlayer(map, req.user.id),
  });
});

// Saquear un marcador de botín (Fase 20): un personaje adyacente pasa su
// contenido a su inventario y el marcador desaparece. No cuesta acción (es
// saqueo, no combate); solo exige estar al lado, como abrir una puerta.
campaignsRouter.post('/:id/marcadores/:tokenId/saquear', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });

  const activeMapId = getActiveMapId(req.params.id);
  const token = activeMapId
    ? db
        .prepare(
          `SELECT t.*, r.floor_id, r.revealed FROM map_tokens t
           JOIN map_rooms r ON r.id = t.room_id
           JOIN map_floors f ON f.id = r.floor_id
           WHERE t.id = ? AND f.map_id = ?`
        )
        .get(req.params.tokenId, activeMapId)
    : undefined;
  if (!token || token.hidden) return res.status(404).json({ error: 'Botín no encontrado' });
  const loot = JSON.parse(token.loot || '[]');
  if (!Array.isArray(loot) || !loot.length) {
    return res.status(400).json({ error: 'Ahí no hay nada que saquear' });
  }

  const character = db
    .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ? AND user_id = ?')
    .get(req.body?.characterId, req.params.id, req.user.id);
  if (!character) return res.status(400).json({ error: 'Personaje no válido' });

  const charToken = db
    .prepare(
      `SELECT t.*, r.floor_id FROM map_character_tokens t JOIN map_rooms r ON r.id = t.room_id
       WHERE t.map_id = ? AND t.character_id = ?`
    )
    .get(activeMapId, character.id);
  if (!charToken) return res.status(400).json({ error: 'Tu personaje no está en el tablero' });
  const adjacent =
    charToken.floor_id === token.floor_id &&
    Math.max(Math.abs(token.x - charToken.x), Math.abs(token.y - charToken.y)) <= 1;
  if (!adjacent) return res.status(400).json({ error: 'Tienes que estar al lado del botín' });

  // La transferencia entera (leer el cofre, escribir la ficha, vaciar el
  // marcador) ocurre en una única transacción del servidor: el cliente nunca
  // manda inventarios completos y dos saqueos a la vez no pueden duplicar.
  const transfer = lootMarkerInto(token.id, character.id);
  if (!transfer.ok) return res.status(400).json({ error: transfer.error });
  const looted = transfer.looted;
  const consequence = token.success_consequence || '';
  const consequenceScope = publishMarkerConsequence(
    req.params.id,
    req.user.id,
    token,
    consequence
  );
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  res.json({ ok: true, looted, consequence, consequenceScope });
});

// Interactuar con un marcador de trampa/objeto del mapa activo: cuesta la
// acción del turno y solo funciona al lado, igual que abrir una puerta. Los
// enemigos/aliados no pasan por aquí (van por el panel de combate). El DM
// puede probarlo sin coste, pero no es el flujo principal: ya controla
// estos marcadores desde el editor y el tracker.
campaignsRouter.post('/:id/marcadores/:tokenId/interactuar', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  const isDm = membership.role === 'dm';

  const activeMapId = getActiveMapId(req.params.id);
  const token = activeMapId
    ? db
        .prepare(
          `SELECT t.*, r.floor_id FROM map_tokens t
           JOIN map_rooms r ON r.id = t.room_id
           JOIN map_floors f ON f.id = r.floor_id
           WHERE t.id = ? AND f.map_id = ?`
        )
        .get(req.params.tokenId, activeMapId)
    : undefined;
  if (!token || (token.hidden && !isDm)) {
    return res.status(404).json({ error: 'Marcador no encontrado en el mapa activo' });
  }
  if (token.kind !== 'trampa' && token.kind !== 'objeto') {
    return res.status(400).json({ error: 'Ese marcador no se interactúa así' });
  }

  if (isDm) {
    return res.json({
      ok: true,
      success: true,
      consequence: token.success_consequence || '',
      consequenceScope: token.consequence_scope ?? 'player',
    });
  }

  const character = db
    .prepare('SELECT * FROM characters WHERE id = ? AND campaign_id = ? AND user_id = ?')
    .get(req.body?.characterId, req.params.id, req.user.id);
  if (!character) return res.status(400).json({ error: 'Personaje no válido' });

  const charToken = db
    .prepare(
      `SELECT t.*, r.floor_id FROM map_character_tokens t JOIN map_rooms r ON r.id = t.room_id
       WHERE t.map_id = ? AND t.character_id = ?`
    )
    .get(activeMapId, character.id);
  if (!charToken) return res.status(400).json({ error: 'Tu personaje no está en el tablero' });

  const adjacent =
    charToken.floor_id === token.floor_id &&
    Math.max(Math.abs(token.x - charToken.x), Math.abs(token.y - charToken.y)) <= 1;
  if (!adjacent) return res.status(400).json({ error: 'Tienes que estar al lado' });

  const actionSpend = trySpendAction(req.params.id, character.id);
  if (!actionSpend.ok) return res.status(400).json({ error: actionSpend.error });

  if (token.skill) {
    const roll = req.body?.roll;
    if (!roll || typeof roll.total !== 'number') {
      return res.status(400).json({ error: 'Falta la tirada de habilidad' });
    }
    if (roll.total < token.dc) {
      const consequence = token.failure_consequence || '';
      return res.json({
        ok: true,
        success: false,
        dc: token.dc,
        consequence,
        consequenceScope: publishMarkerConsequence(req.params.id, req.user.id, token, consequence),
      });
    }
    const consequence = token.success_consequence || '';
    return res.json({
      ok: true,
      success: true,
      dc: token.dc,
      consequence,
      consequenceScope: publishMarkerConsequence(req.params.id, req.user.id, token, consequence),
    });
  }
  const consequence = token.success_consequence || '';
  res.json({
    ok: true,
    success: true,
    consequence,
    consequenceScope: publishMarkerConsequence(req.params.id, req.user.id, token, consequence),
  });
});

