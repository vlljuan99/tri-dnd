import { db } from '../db.js';

function jsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeAction(action, index, type) {
  if (typeof action === 'string') {
    const name = action.trim().slice(0, 80);
    return name ? { id: `${type}-${index}`, name, desc: '', cost: 1 } : null;
  }
  if (!action || typeof action !== 'object') return null;
  const name = String(action.name ?? '').trim().slice(0, 80);
  if (!name) return null;
  const desc = String(action.desc ?? action.description ?? '').trim().slice(0, 2000);
  const text = `${name} ${desc}`;
  const parsedCost = Number(action.cost) || Number(/costs?\s+(\d+)\s+actions?/i.exec(text)?.[1]) ||
    Number(/cuesta\s+(\d+)\s+acciones?/i.exec(text)?.[1]) || 1;
  return {
    id: `${type}-${index}`,
    name,
    desc,
    cost: Math.max(1, Math.min(3, Math.round(parsedCost))),
  };
}

function monsterData(index) {
  if (!index) return {};
  const row = db
    .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
    .get(index);
  return jsonObject(row?.data);
}

export function bossActionsFor(row) {
  const data = monsterData(row?.monster_index);
  const overrides = jsonObject(row?.overrides);
  const legendarySource = Array.isArray(overrides.legendaryActions)
    ? overrides.legendaryActions
    : data.legendary_actions;
  const lairSource = Array.isArray(overrides.lairActions)
    ? overrides.lairActions
    : data.lair_actions;
  const legendary = (Array.isArray(legendarySource) ? legendarySource : [])
    .map((action, index) => normalizeAction(action, index, 'legendary'))
    .filter(Boolean);
  const lair = (Array.isArray(lairSource) ? lairSource : [])
    .map((action, index) => normalizeAction(action, index, 'lair'))
    .filter(Boolean)
    .map((action) => ({ ...action, cost: 0 }));
  const configuredMax = Number(overrides.legendaryPointsMax);
  const maxPoints = legendary.length
    ? Math.max(1, Math.min(5, Number.isInteger(configuredMax) ? configuredMax : 3))
    : 0;
  return { legendary, lair, maxPoints };
}

export function syncBossResources(combatantId) {
  const row = db.prepare('SELECT * FROM combatants WHERE id = ?').get(combatantId);
  if (!row || row.kind !== 'enemigo') return { legendary: [], lair: [], maxPoints: 0 };
  const actions = bossActionsFor(row);
  if (row.legendary_points_max !== actions.maxPoints) {
    db.prepare(
      `UPDATE combatants SET legendary_points_max = ?,
       legendary_points = CASE WHEN legendary_points_max = 0 THEN ? ELSE MIN(legendary_points, ?) END
       WHERE id = ?`
    ).run(actions.maxPoints, actions.maxPoints, actions.maxPoints, row.id);
  }
  return actions;
}

export function useBossAction(campaignId, combatantId, type, actionId) {
  const table = db
    .prepare('SELECT combat_active, combat_round, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: false, error: 'Las acciones de jefe requieren combate por turnos' };
  const row = db
    .prepare("SELECT * FROM combatants WHERE id = ? AND campaign_id = ? AND kind = 'enemigo'")
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Jefe no encontrado' };
  if (Number.isInteger(row.hp_current) && row.hp_current <= 0) {
    return { ok: false, error: 'Un jefe derrotado no puede actuar' };
  }
  const actions = bossActionsFor(row);

  if (type === 'legendary') {
    if (table.combat_turn_id === row.id) {
      return { ok: false, error: 'Las acciones legendarias se usan fuera del turno del jefe' };
    }
    const action = actions.legendary.find((candidate) => candidate.id === actionId);
    if (!action) return { ok: false, error: 'Acción legendaria no válida' };
    const max = actions.maxPoints;
    const current = row.legendary_points_max === max ? row.legendary_points : max;
    if (current < action.cost) return { ok: false, error: 'No quedan suficientes acciones legendarias' };
    db.prepare(
      'UPDATE combatants SET legendary_points_max = ?, legendary_points = ? WHERE id = ?'
    ).run(max, current - action.cost, row.id);
    return { ok: true, action, type, remaining: current - action.cost, max };
  }

  if (type === 'lair') {
    const action = actions.lair.find((candidate) => candidate.id === actionId);
    if (!action) return { ok: false, error: 'Acción de guarida no válida' };
    if (row.lair_action_round === table.combat_round) {
      return { ok: false, error: 'La guarida ya ha actuado esta ronda' };
    }
    const active = db.prepare('SELECT initiative FROM combatants WHERE id = ?').get(table.combat_turn_id);
    if (active && active.initiative > 20) {
      return { ok: false, error: 'La guarida actúa en iniciativa 20' };
    }
    db.prepare('UPDATE combatants SET lair_action_round = ? WHERE id = ?').run(table.combat_round, row.id);
    return { ok: true, action, type, round: table.combat_round };
  }

  return { ok: false, error: 'Tipo de acción de jefe no válido' };
}
