import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getTemplate, serializeTemplate, TEMPLATE_KINDS } from '../services/templates.js';

// Biblioteca de plantillas del DM (v35): listado y gestión. Las plantillas se
// GUARDAN desde una campaña (rutas en maps.js/world.js, que ven los datos) y
// se INSTANCIAN también allí; aquí solo se listan, renombran y borran.
export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get('/', (req, res) => {
  const { tipo } = req.query;
  const rows =
    tipo && TEMPLATE_KINDS.has(tipo)
      ? db
          .prepare('SELECT * FROM dm_templates WHERE user_id = ? AND kind = ? ORDER BY created_at DESC, id DESC')
          .all(req.user.id, tipo)
      : db
          .prepare('SELECT * FROM dm_templates WHERE user_id = ? ORDER BY created_at DESC, id DESC')
          .all(req.user.id);
  res.json({ templates: rows.map(serializeTemplate) });
});

templatesRouter.patch('/:id', (req, res) => {
  const template = getTemplate(req.user.id, req.params.id);
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });

  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'La plantilla necesita un nombre' });
  }
  db.prepare('UPDATE dm_templates SET name = ? WHERE id = ?').run(name.trim().slice(0, 120), template.id);
  res.json({ template: serializeTemplate(getTemplate(req.user.id, template.id)) });
});

templatesRouter.delete('/:id', (req, res) => {
  const template = getTemplate(req.user.id, req.params.id);
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
  db.prepare('DELETE FROM dm_templates WHERE id = ?').run(template.id);
  res.json({ ok: true });
});
