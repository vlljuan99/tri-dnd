import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getActiveMapId, getMap, serializeFullMap, serializeMapForPlayer } from '../services/mapLibrary.js';

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

// Mapa activo de la mesa, filtrado según el rol: el DM lo ve entero; el
// jugador solo las salas reveladas y las puertas visibles (filtrado en el
// servidor, como las tiradas ocultas).
campaignsRouter.get('/:id/mapa-activo', (req, res) => {
  const membership = getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });

  const activeMapId = getActiveMapId(req.params.id);
  const map = activeMapId ? getMap(req.params.id, activeMapId) : null;
  if (!map) return res.json({ map: null });

  res.json({
    map:
      membership.role === 'dm'
        ? serializeFullMap(map, req.params.id)
        : serializeMapForPlayer(map),
  });
});

