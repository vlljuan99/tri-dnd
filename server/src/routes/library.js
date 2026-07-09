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
import { notifyCampaignMap } from '../services/liveMap.js';

// Biblioteca del DM (Fase 15): CRUD de objetos y hechizos propios, por
// usuario y reutilizables en cualquier campaña. El `data` que llega del
// cliente ya viene con forma de entrada del SRD (equipment/spells); aquí solo
// se valida por encima (es una herramienta del propio DM) y se acota tamaño.
export const libraryRouter = Router();
libraryRouter.use(requireAuth);

// Segmento de ruta en español → categoría del SRD equivalente
const CATEGORY_BY_SEGMENT = { objetos: 'equipment', hechizos: 'spells' };

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

// Acepta el data con forma SRD tal cual, acotando tamaño. Devuelve null si no
// es un objeto serializable razonable.
function cleanData(data) {
  if (data == null) return {};
  if (typeof data !== 'object' || Array.isArray(data)) return null;
  const json = JSON.stringify(data);
  if (json.length > 20000) return null;
  return data;
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
  const data = cleanData(req.body?.data);
  if (data === null) return res.status(400).json({ error: 'Datos no válidos' });
  const row = createCustomRow(req.user.id, category, name, data);
  res.status(201).json(serializeCustomEntry(row, category, { full: true }));
});

libraryRouter.put('/:tipo/:id', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const existing = getCustomRow(req.user.id, category, Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Entrada no encontrada' });
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const data = cleanData(req.body?.data);
  if (data === null) return res.status(400).json({ error: 'Datos no válidos' });
  const row = updateCustomRow(req.user.id, category, existing.id, name, data);
  res.json(serializeCustomEntry(row, category, { full: true }));
});

libraryRouter.delete('/:tipo/:id', (req, res) => {
  const category = resolveCategory(req, res);
  if (!category) return;
  const id = Number(req.params.id);
  // Al borrar, se limpian sus asignaciones a campañas y se avisa a los
  // tableros de esas campañas por si mostraban el contenido
  const contentType = category === 'equipment' ? 'objeto' : 'hechizo';
  const campaigns = db
    .prepare('SELECT campaign_id FROM campaign_library WHERE content_type = ? AND content_id = ?')
    .all(contentType, id);
  const ok = deleteCustomRow(req.user.id, category, id);
  if (!ok) return res.status(404).json({ error: 'Entrada no encontrada' });
  db.prepare('DELETE FROM campaign_library WHERE content_type = ? AND content_id = ?').run(contentType, id);
  for (const { campaign_id } of campaigns) notifyCampaignMap(campaign_id);
  res.json({ ok: true });
});
