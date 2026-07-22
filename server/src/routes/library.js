import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import {
  listCustomRows,
  getCustomRow,
  createCustomRow,
  updateCustomRow,
  deleteCustomRow,
  serializeCustomEntry,
} from '../services/customLibrary.js';
import { validateContentData } from '../services/classRaceShape.js';
import { notifyCampaignMap } from '../services/liveMap.js';

// Biblioteca del DM: CRUD de contenido propio por usuario, reutilizable en
// cualquier campaña. Objetos y hechizos (Fase 15) llegan con `data` con forma
// del SRD y se validan por encima. Clases y razas (Fase 26) llevan validación
// estructurada por servidor, porque su `data` alimentará el cálculo de la
// ficha y un valor basura ahí saldría como un número mal en la hoja de alguien.
export const libraryRouter = Router();
libraryRouter.use(requireAuth);

// Segmento de ruta en español → categoría del SRD equivalente
const CATEGORY_BY_SEGMENT = {
  objetos: 'equipment',
  hechizos: 'spells',
  clases: 'classes',
  razas: 'races',
};

// content_type de campaign_library por categoría (solo el contenido que se
// asigna a campañas). Clases y razas no se asignan: son del personaje, no de
// la campaña, así que no tienen entrada aquí.
const CAMPAIGN_CONTENT_TYPE = { equipment: 'objeto', spells: 'hechizo' };

function resolveCategory(req, res) {
  const category = CATEGORY_BY_SEGMENT[req.params.tipo];
  if (!category) {
    res.status(404).json({ error: 'Tipo de biblioteca desconocido' });
    return null;
  }
  return category;
}

function cleanName(name) {
  return typeof name === 'string' ? name.trim().slice(0, 80) : '';
}

// Normaliza el `data` según la categoría. Clases y razas pasan por la
// validación estructurada (que además recorta y descarta lo que sobra);
// objetos y hechizos aceptan su forma SRD tal cual, acotando tamaño. Devuelve
// { data } con la forma a guardar, o { error } con el motivo del rechazo.
function normalizeData(category, raw) {
  const structured = validateContentData(category, raw);
  if (structured) {
    return structured.ok ? { data: structured.data } : { error: structured.error };
  }
  if (raw == null) return { data: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Datos no válidos' };
  if (JSON.stringify(raw).length > 20000) return { error: 'Datos demasiado grandes' };
  return { data: raw };
}

libraryRouter.get('/:tipo', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const rows = listCustomRows(req.user.id, category, { q });
  res.json({ results: rows.map((r) => serializeCustomEntry(r, category, { full: true })) });
});

libraryRouter.get('/:tipo/:id', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const row = getCustomRow(req.user.id, category, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
  res.json(serializeCustomEntry(row, category, { full: true }));
});

libraryRouter.post('/:tipo', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const result = normalizeData(category, req.body?.data);
  if (result.error) return res.status(400).json({ error: result.error });
  const row = createCustomRow(req.user.id, category, name, result.data);
  res.status(201).json(serializeCustomEntry(row, category, { full: true }));
});

libraryRouter.put('/:tipo/:id', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const existing = getCustomRow(req.user.id, category, Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Entrada no encontrada' });
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const result = normalizeData(category, req.body?.data);
  if (result.error) return res.status(400).json({ error: result.error });
  const row = updateCustomRow(req.user.id, category, existing.id, name, result.data);
  res.json(serializeCustomEntry(row, category, { full: true }));
});

libraryRouter.delete('/:tipo/:id', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const id = Number(req.params.id);
  // Objetos y hechizos se asignan a campañas: al borrarlos hay que limpiar esas
  // asignaciones y avisar a sus tableros. Clases y razas no se asignan (son del
  // personaje, no de la campaña), así que ese paso se salta.
  const contentType = CAMPAIGN_CONTENT_TYPE[category] ?? null;
  const campaigns = contentType
    ? db
        .prepare('SELECT campaign_id FROM campaign_library WHERE content_type = ? AND content_id = ?')
        .all(contentType, id)
    : [];
  const ok = deleteCustomRow(req.user.id, category, id);
  if (!ok) return res.status(404).json({ error: 'Entrada no encontrada' });
  if (contentType) {
    db.prepare('DELETE FROM campaign_library WHERE content_type = ? AND content_id = ?').run(contentType, id);
    for (const { campaign_id } of campaigns) notifyCampaignMap(campaign_id);
  }
  res.json({ ok: true });
});
