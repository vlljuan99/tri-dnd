import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

// Biblioteca de eventos del DM (Fase 18): reutilizables en cualquier
// campaña, igual que los objetos/hechizos propios. El evento define QUÉ pasa
// (pasiva/consecuencia en texto) y CUÁNDO (manual, cada N rondas, o al
// revelarse la sala donde esté colgado); dónde aplica se decide al enlazarlo
// a una campaña/sala/marcador (rutas de enlaces en campaigns.js).
export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const TRIGGER_KINDS = new Set(['manual', 'rondas', 'revelar']);

export function serializeEvent(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    effect: row.effect,
    triggerKind: row.trigger_kind,
    triggerEvery: row.trigger_every,
    hidden: Boolean(row.hidden),
  };
}

function cleanFields(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return { error: 'El evento necesita un nombre' };
  const description = typeof body?.description === 'string' ? body.description.slice(0, 2000) : '';
  const effect = typeof body?.effect === 'string' ? body.effect.slice(0, 500) : '';
  const triggerKind = TRIGGER_KINDS.has(body?.triggerKind) ? body.triggerKind : 'manual';
  let triggerEvery = null;
  if (triggerKind === 'rondas') {
    triggerEvery = Number(body?.triggerEvery);
    if (!(Number.isInteger(triggerEvery) && triggerEvery >= 1 && triggerEvery <= 100)) {
      return { error: 'La cadencia de rondas debe ser un número entre 1 y 100' };
    }
  }
  const hidden = Number(Boolean(body?.hidden));
  return { name, description, effect, triggerKind, triggerEvery, hidden };
}

eventsRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM dm_events WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json({ events: rows.map(serializeEvent) });
});

eventsRouter.post('/', (req, res) => {
  const fields = cleanFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const info = db
    .prepare(
      'INSERT INTO dm_events (user_id, name, description, effect, trigger_kind, trigger_every, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(req.user.id, fields.name, fields.description, fields.effect, fields.triggerKind, fields.triggerEvery, fields.hidden);
  const row = db.prepare('SELECT * FROM dm_events WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ event: serializeEvent(row) });
});

function getOwned(req, res) {
  const row = db.prepare('SELECT * FROM dm_events WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) {
    res.status(404).json({ error: 'Evento no encontrado' });
    return null;
  }
  return row;
}

eventsRouter.put('/:id', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  const fields = cleanFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  db.prepare(
    `UPDATE dm_events SET name = ?, description = ?, effect = ?, trigger_kind = ?, trigger_every = ?, hidden = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(fields.name, fields.description, fields.effect, fields.triggerKind, fields.triggerEvery, fields.hidden, row.id);
  res.json({ event: serializeEvent(db.prepare('SELECT * FROM dm_events WHERE id = ?').get(row.id)) });
});

eventsRouter.delete('/:id', (req, res) => {
  const row = getOwned(req, res);
  if (!row) return;
  db.prepare('DELETE FROM dm_events WHERE id = ?').run(row.id); // enlaces caen en cascada
  res.json({ ok: true });
});
