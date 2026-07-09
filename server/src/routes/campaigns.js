import { Router } from 'express';
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
import { notifyCampaignMap, notifyCombat } from '../services/liveMap.js';
import { ensureCombatantForCharacter, trySpendMovement, trySpendAction } from '../services/turnEconomy.js';
import { listCustomRows, serializeCustomEntry } from '../services/customLibrary.js';
import { lootMarkerInto } from '../services/loot.js';

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
    maxPlayers: row.max_players,
    lore: row.lore,
    objectives: JSON.parse(row.objectives || '[]'),
    hasWorldMap: Boolean(row.has_world_map),
    worldMapUrl: row.world_map_url ?? null,
    status: row.status,
    wizardStep: row.wizard_step,
  };
}

// Cuántos jugadores (sin contar al DM) están ya unidos a la campaña — usado
// tanto para el límite de plazas al unirse como para exigir al menos uno
// antes de poder abrir la sesión en vivo.
export function countPlayers(campaignId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ? AND role = 'jugador'")
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
  res.json({ campaigns: rows.map((r) => serializeCampaign(r, r.role)) });
});

// Nace como borrador con lo mínimo (nombre genérico según el tipo elegido);
// el asistente guiado (/campanas/:id/asistente) rellena el resto paso a
// paso, igual que un personaje nuevo nace en borrador para el asistente de PJ.
campaignsRouter.post('/', (req, res) => {
  const isAdventure = Boolean(req.body?.hasWorldMap);

  const create = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO campaigns (name, dm_user_id, invite_code, has_world_map, status) VALUES (?, ?, ?, ?, 'draft')"
      )
      .run(isAdventure ? 'Nueva aventura' : 'Nueva escaramuza', req.user.id, generateInviteCode(), isAdventure ? 1 : 0);
    const id = info.lastInsertRowid;
    db.prepare("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'dm')").run(id, req.user.id);
    // combat_active nace en 1: el modo por turnos está activo por defecto
    // en toda mesa nueva (Fase 8.5); el DM lo alterna a modo libre cuando quiera.
    db.prepare('INSERT INTO game_tables (campaign_id, combat_active) VALUES (?, 1)').run(id);
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

  if (row.max_players != null && countPlayers(row.id) >= row.max_players) {
    return res.status(403).json({ error: 'La campaña ya tiene todas las plazas ocupadas' });
  }

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

// Editar campaña (solo el DM): lore de apertura, objetivos, plazas y si forma
// parte de un mapa de mundo. Solo se tocan los campos presentes en el body.
campaignsRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaña no encontrada' });
  if (row.dm_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el DM puede editar la campaña' });
  }

  const { name, lore, objectives, maxPlayers, hasWorldMap, status, wizardStep } = req.body ?? {};
  const sets = [];
  const values = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) {
      return res.status(400).json({ error: 'La campaña necesita un nombre' });
    }
    sets.push('name = ?');
    values.push(name.trim());
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
  if (hasWorldMap !== undefined) {
    sets.push('has_world_map = ?');
    values.push(hasWorldMap ? 1 : 0);
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
    db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...values, row.id);
  }
  const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.id);
  res.json({ campaign: serializeCampaign(updated, 'dm') });
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

  db.transaction(() => {
    // active_map_id no tiene ON DELETE: se limpia antes de que caigan los mapas
    db.prepare('UPDATE game_tables SET active_map_id = NULL WHERE campaign_id = ?').run(row.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(row.id);
  })();
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
  if (row.dm_user_id !== req.user.id) {
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
      `SELECT id, name, level, hp_max, ac, avatar_path AS avatarUrl, campaign_id
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

  // Con el modo por turnos activo, el movimiento se descuenta del
  // presupuesto del turno (velocidad en casillas); el DM mueve sin límite,
  // ya sea su propio control de la escena o el de un enemigo/aliado.
  if (!isDm) {
    const distance = Math.max(Math.abs(x - token.x), Math.abs(y - token.y));
    const spend = trySpendMovement(req.params.id, character.id, distance);
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
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  if (newlyRevealed.length && spawnRoomEnemies(req.params.id, newlyRevealed) > 0) {
    notifyCombat(req.params.id);
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
  if (newlyRevealed.length && spawnRoomEnemies(req.params.id, newlyRevealed) > 0) {
    notifyCombat(req.params.id);
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

  const looted = lootMarkerInto(token, character);
  touchMap(activeMapId);
  notifyCampaignMap(req.params.id);
  res.json({ ok: true, looted });
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

  if (isDm) return res.json({ ok: true, success: true });

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
      return res.json({ ok: true, success: false, dc: token.dc });
    }
    return res.json({ ok: true, success: true, dc: token.dc });
  }
  res.json({ ok: true, success: true });
});

