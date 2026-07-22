import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router, raw as expressRaw } from 'express';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import {
  NARRATIVE_BLOCK_TYPES,
  NARRATIVE_NODE_KINDS,
  NARRATIVE_VISIBILITIES,
  NARRATIVE_ICONS,
  narrativeImagePath,
  normalizeExternalUrl,
  removeNarrativeImage,
  serializeNarrativeBlock,
  serializeNarrativeNode,
  validateRasterImage,
  wouldCreateNarrativeCycle,
  writeNarrativeBackup,
} from '../services/campaignArchive.js';

// Archivo narrativo de campaña. El DM administra el árbol completo; los
// jugadores solo reciben artículos publicados y sus secciones ancestras. El
// filtrado ocurre siempre aquí, incluido búsqueda e imágenes privadas.
export const campaignArchiveRouter = Router({ mergeParams: true });
campaignArchiveRouter.use(requireAuth);

campaignArchiveRouter.use((req, res, next) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  const membership = db
    .prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .get(campaign.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta campaña' });
  if (campaign.campaign_type !== 'campana') {
    return res.status(404).json({ error: 'Las escaramuzas no tienen archivo narrativo' });
  }
  req.campaign = campaign;
  req.membership = membership;
  next();
});

function requireArchiveDm(req, res, next) {
  if (req.membership.role !== 'dm') {
    return res.status(403).json({ error: 'Solo el DM puede modificar el archivo de campaña' });
  }
  next();
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

function cleanId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanShortText(value, max) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function getNode(campaignId, nodeId) {
  return db
    .prepare('SELECT * FROM campaign_narrative_nodes WHERE id = ? AND campaign_id = ?')
    .get(nodeId, campaignId);
}

function getBlock(campaignId, blockId) {
  return db
    .prepare(
      `SELECT b.*, n.visibility AS node_visibility, n.kind AS node_kind
       FROM campaign_narrative_blocks b
       JOIN campaign_narrative_nodes n ON n.id = b.node_id
       WHERE b.id = ? AND n.campaign_id = ?`
    )
    .get(blockId, campaignId);
}

function blocksForCampaign(campaignId) {
  return db
    .prepare(
      `SELECT b.* FROM campaign_narrative_blocks b
       JOIN campaign_narrative_nodes n ON n.id = b.node_id
       WHERE n.campaign_id = ? ORDER BY b.node_id, b.position, b.id`
    )
    .all(campaignId);
}

function playerVisibleNodes(campaignId) {
  return db
    .prepare(
      `WITH RECURSIVE visible(id) AS (
         SELECT id FROM campaign_narrative_nodes
          WHERE campaign_id = ? AND kind = 'entrada' AND visibility = 'players'
         UNION
         SELECT parent.parent_id
           FROM campaign_narrative_nodes parent
           JOIN visible child ON child.id = parent.id
          WHERE parent.parent_id IS NOT NULL
       )
       SELECT * FROM campaign_narrative_nodes
        WHERE campaign_id = ? AND id IN (SELECT id FROM visible)
        ORDER BY parent_id, position, id`
    )
    .all(campaignId, campaignId);
}

function serializeArchive(campaignId, rows = null, { forPlayer = false } = {}) {
  let nodes = rows ?? (forPlayer
    ? playerVisibleNodes(campaignId)
    : db
        .prepare(
          `SELECT * FROM campaign_narrative_nodes
           WHERE campaign_id = ? ORDER BY parent_id, position, id`
        )
        .all(campaignId));
  if (forPlayer && rows) {
    nodes = nodes.filter((node) => node.kind === 'entrada' && node.visibility === 'players');
  }
  const grouped = new Map();
  for (const block of blocksForCampaign(campaignId)) {
    if (!grouped.has(block.node_id)) grouped.set(block.node_id, []);
    grouped.get(block.node_id).push(serializeNarrativeBlock(block, campaignId));
  }
  return nodes.map((node) => serializeNarrativeNode(node, grouped.get(node.id) ?? []));
}

function serializeOneNode(campaignId, nodeId) {
  const node = getNode(campaignId, nodeId);
  if (!node) return null;
  const blocks = db
    .prepare('SELECT * FROM campaign_narrative_blocks WHERE node_id = ? ORDER BY position, id')
    .all(node.id)
    .map((block) => serializeNarrativeBlock(block, campaignId));
  return serializeNarrativeNode(node, blocks);
}

function validateParent(campaignId, parentId) {
  if (parentId == null) return { ok: true, parent: null };
  const id = cleanId(parentId);
  if (!id) return { ok: false, error: 'Sección superior no válida' };
  const parent = getNode(campaignId, id);
  if (!parent) return { ok: false, error: 'La sección superior no pertenece a esta campaña' };
  if (parent.kind !== 'seccion') return { ok: false, error: 'Una entrada no puede contener otras entradas' };
  return { ok: true, parent };
}

function nextNodePosition(campaignId, parentId) {
  return (
    db
      .prepare(
        `SELECT MAX(position) AS p FROM campaign_narrative_nodes
         WHERE campaign_id = ? AND parent_id IS ?`
      )
      .get(campaignId, parentId).p ?? -1
  ) + 1;
}

function nextBlockPosition(nodeId) {
  return (
    db.prepare('SELECT MAX(position) AS p FROM campaign_narrative_blocks WHERE node_id = ?').get(nodeId).p ?? -1
  ) + 1;
}

function normalizeNodePositions(campaignId, parentId) {
  const ids = db
    .prepare(
      `SELECT id FROM campaign_narrative_nodes
       WHERE campaign_id = ? AND parent_id IS ? ORDER BY position, id`
    )
    .all(campaignId, parentId)
    .map((row) => row.id);
  const update = db.prepare('UPDATE campaign_narrative_nodes SET position = ? WHERE id = ?');
  ids.forEach((id, position) => update.run(position, id));
}

function moveInOrderedList(ids, currentId, direction) {
  const from = ids.indexOf(currentId);
  if (from < 0) return ids;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return ids;
  const copy = [...ids];
  [copy[from], copy[to]] = [copy[to], copy[from]];
  return copy;
}

function validateBlockBody(body, { partial = false } = {}) {
  const result = {};
  const requestedType = body?.type ?? body?.kind;
  if (!partial || requestedType !== undefined) {
    const type = requestedType ?? 'texto';
    if (!NARRATIVE_BLOCK_TYPES.has(type)) return { error: 'Tipo de bloque no válido' };
    result.type = type;
  }

  const requestedContent = body?.content ?? body?.body;
  if (!partial || requestedContent !== undefined) {
    const content = requestedContent ?? '';
    if (typeof content !== 'string' || content.length > 50000) {
      return { error: 'El contenido del bloque no es válido (máximo 50.000 caracteres)' };
    }
    result.content = content;
  }

  if (!partial || hasOwn(body, 'url')) {
    const url = normalizeExternalUrl(body?.url);
    if (url === undefined) return { error: 'La URL debe empezar por http:// o https://' };
    result.url = url;
  }

  if (!partial || hasOwn(body, 'caption') || hasOwn(body, 'label')) {
    const caption = body?.caption ?? body?.label ?? '';
    if (cleanShortText(caption, 500) === null) return { error: 'El pie del bloque es demasiado largo' };
    result.caption = caption;
  }

  if (!partial || hasOwn(body, 'altText')) {
    const altText = body?.altText ?? '';
    if (cleanShortText(altText, 500) === null) return { error: 'El texto alternativo es demasiado largo' };
    result.altText = altText;
  }
  return result;
}

campaignArchiveRouter.get('/', (req, res) => {
  const forPlayer = req.membership.role !== 'dm';
  res.json({ nodes: serializeArchive(req.campaign.id, null, { forPlayer }), canEdit: !forPlayer });
});

campaignArchiveRouter.post('/nodos', requireArchiveDm, (req, res) => {
  const { parentId = null, kind = 'entrada', title, summary = '', visibility = 'private', icon = null } = req.body ?? {};
  if (!NARRATIVE_NODE_KINDS.has(kind)) return res.status(400).json({ error: 'Tipo de nodo no válido' });
  if (typeof title !== 'string' || !title.trim() || title.length > 120) {
    return res.status(400).json({ error: 'El título es obligatorio y admite hasta 120 caracteres' });
  }
  if (typeof summary !== 'string' || summary.length > 2000) {
    return res.status(400).json({ error: 'El resumen admite hasta 2.000 caracteres' });
  }
  if (!NARRATIVE_VISIBILITIES.has(visibility)) {
    return res.status(400).json({ error: 'Visibilidad de artículo no válida' });
  }
  const cleanIcon = icon == null || icon === '' ? null : icon;
  if (cleanIcon !== null && (typeof cleanIcon !== 'string' || !NARRATIVE_ICONS.has(cleanIcon))) {
    return res.status(400).json({ error: 'Icono de archivo no válido' });
  }
  const checkedParent = validateParent(req.campaign.id, parentId);
  if (!checkedParent.ok) return res.status(400).json({ error: checkedParent.error });
  const cleanParentId = checkedParent.parent?.id ?? null;
  const info = db
    .prepare(
      `INSERT INTO campaign_narrative_nodes
         (campaign_id, parent_id, kind, title, summary, visibility, icon, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.campaign.id,
      cleanParentId,
      kind,
      title.trim(),
      summary,
      kind === 'entrada' ? visibility : 'private',
      cleanIcon,
      nextNodePosition(req.campaign.id, cleanParentId)
    );
  writeNarrativeBackup(req.campaign.id, 'crear-articulo');
  res.status(201).json({ node: serializeOneNode(req.campaign.id, Number(info.lastInsertRowid)) });
});

campaignArchiveRouter.patch('/nodos/:nodeId', requireArchiveDm, (req, res) => {
  const nodeId = cleanId(req.params.nodeId);
  const node = nodeId && getNode(req.campaign.id, nodeId);
  if (!node) return res.status(404).json({ error: 'Entrada no encontrada' });

  const sets = [];
  const values = [];
  let nextParentId = node.parent_id;
  let parentChanged = false;
  let nextKind = node.kind;

  if (hasOwn(req.body, 'title')) {
    if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.length > 120) {
      return res.status(400).json({ error: 'El título es obligatorio y admite hasta 120 caracteres' });
    }
    sets.push('title = ?');
    values.push(req.body.title.trim());
  }
  if (hasOwn(req.body, 'summary')) {
    if (typeof req.body.summary !== 'string' || req.body.summary.length > 2000) {
      return res.status(400).json({ error: 'El resumen admite hasta 2.000 caracteres' });
    }
    sets.push('summary = ?');
    values.push(req.body.summary);
  }
  if (hasOwn(req.body, 'visibility')) {
    if (node.kind !== 'entrada' || !NARRATIVE_VISIBILITIES.has(req.body.visibility)) {
      return res.status(400).json({ error: 'Visibilidad de artículo no válida' });
    }
    sets.push('visibility = ?');
    values.push(req.body.visibility);
  }
  if (hasOwn(req.body, 'icon')) {
    const icon = req.body.icon == null || req.body.icon === '' ? null : req.body.icon;
    if (icon !== null && (typeof icon !== 'string' || !NARRATIVE_ICONS.has(icon))) {
      return res.status(400).json({ error: 'Icono de archivo no válido' });
    }
    sets.push('icon = ?');
    values.push(icon);
  }
  if (hasOwn(req.body, 'kind')) {
    if (!NARRATIVE_NODE_KINDS.has(req.body.kind)) {
      return res.status(400).json({ error: 'Tipo de nodo no válido' });
    }
    nextKind = req.body.kind;
    if (nextKind === 'entrada' && db.prepare('SELECT 1 FROM campaign_narrative_nodes WHERE parent_id = ?').get(node.id)) {
      return res.status(409).json({ error: 'Una sección con contenido anidado no puede convertirse en entrada' });
    }
    if (nextKind === 'seccion' && db.prepare('SELECT 1 FROM campaign_narrative_blocks WHERE node_id = ?').get(node.id)) {
      return res.status(409).json({ error: 'Una entrada con bloques no puede convertirse en sección' });
    }
    sets.push('kind = ?');
    values.push(nextKind);
  }
  if (hasOwn(req.body, 'parentId')) {
    const checkedParent = validateParent(req.campaign.id, req.body.parentId);
    if (!checkedParent.ok) return res.status(400).json({ error: checkedParent.error });
    nextParentId = checkedParent.parent?.id ?? null;
    const parentById = (id) => getNode(req.campaign.id, id)?.parent_id ?? null;
    if (wouldCreateNarrativeCycle(node.id, nextParentId, parentById)) {
      return res.status(400).json({ error: 'No puedes mover una sección dentro de sí misma' });
    }
    parentChanged = nextParentId !== node.parent_id;
    sets.push('parent_id = ?');
    values.push(nextParentId);
    if (parentChanged) {
      sets.push('position = ?');
      values.push(nextNodePosition(req.campaign.id, nextParentId));
    }
  }

  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.transaction(() => {
      db.prepare(`UPDATE campaign_narrative_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values, node.id);
      if (parentChanged) normalizeNodePositions(req.campaign.id, node.parent_id);
    })();
    writeNarrativeBackup(req.campaign.id, 'actualizar-articulo');
  }
  res.json({ node: serializeOneNode(req.campaign.id, node.id) });
});

campaignArchiveRouter.post('/nodos/:nodeId/mover', requireArchiveDm, (req, res) => {
  const nodeId = cleanId(req.params.nodeId);
  const node = nodeId && getNode(req.campaign.id, nodeId);
  if (!node) return res.status(404).json({ error: 'Entrada no encontrada' });
  const { direction } = req.body ?? {};
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'La dirección debe ser up o down' });
  }
  const ids = db
    .prepare(
      `SELECT id FROM campaign_narrative_nodes
       WHERE campaign_id = ? AND parent_id IS ? ORDER BY position, id`
    )
    .all(req.campaign.id, node.parent_id)
    .map((row) => row.id);
  const ordered = moveInOrderedList(ids, node.id, direction);
  const update = db.prepare(
    "UPDATE campaign_narrative_nodes SET position = ?, updated_at = datetime('now') WHERE id = ?"
  );
  db.transaction(() => ordered.forEach((id, position) => update.run(position, id)))();
  writeNarrativeBackup(req.campaign.id, 'reordenar-articulo');
  res.json({ node: serializeOneNode(req.campaign.id, node.id) });
});

campaignArchiveRouter.delete('/nodos/:nodeId', requireArchiveDm, (req, res) => {
  const nodeId = cleanId(req.params.nodeId);
  const node = nodeId && getNode(req.campaign.id, nodeId);
  if (!node) return res.status(404).json({ error: 'Entrada no encontrada' });
  const images = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM campaign_narrative_nodes WHERE id = ? AND campaign_id = ?
         UNION ALL
         SELECT child.id FROM campaign_narrative_nodes child JOIN subtree parent ON child.parent_id = parent.id
       )
       SELECT b.image_path FROM campaign_narrative_blocks b JOIN subtree s ON s.id = b.node_id
       WHERE b.image_path IS NOT NULL`
    )
    .all(node.id, req.campaign.id)
    .map((row) => row.image_path);
  writeNarrativeBackup(req.campaign.id, 'antes-de-borrar-articulo');
  db.transaction(() => {
    db.prepare('DELETE FROM campaign_narrative_nodes WHERE id = ? AND campaign_id = ?').run(node.id, req.campaign.id);
    normalizeNodePositions(req.campaign.id, node.parent_id);
  })();
  images.forEach(removeNarrativeImage);
  res.json({ ok: true });
});

campaignArchiveRouter.post('/nodos/:nodeId/bloques', requireArchiveDm, (req, res) => {
  const nodeId = cleanId(req.params.nodeId);
  const node = nodeId && getNode(req.campaign.id, nodeId);
  if (!node) return res.status(404).json({ error: 'Entrada no encontrada' });
  if (node.kind !== 'entrada') return res.status(400).json({ error: 'Solo las entradas pueden contener bloques' });
  const checked = validateBlockBody(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const info = db
    .prepare(
      `INSERT INTO campaign_narrative_blocks
         (node_id, type, content, url, caption, alt_text, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      node.id,
      checked.type,
      checked.content,
      checked.type === 'texto' ? null : checked.url,
      checked.caption,
      checked.altText,
      nextBlockPosition(node.id)
    );
  const block = getBlock(req.campaign.id, Number(info.lastInsertRowid));
  writeNarrativeBackup(req.campaign.id, 'crear-bloque');
  res.status(201).json({ block: serializeNarrativeBlock(block, req.campaign.id) });
});

campaignArchiveRouter.patch('/bloques/:blockId', requireArchiveDm, (req, res) => {
  const blockId = cleanId(req.params.blockId);
  const block = blockId && getBlock(req.campaign.id, blockId);
  if (!block) return res.status(404).json({ error: 'Bloque no encontrado' });
  const checked = validateBlockBody(req.body, { partial: true });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const nextType = checked.type ?? block.type;
  const sets = [];
  const values = [];
  let removeOldImage = false;

  if (checked.type !== undefined) {
    sets.push('type = ?');
    values.push(checked.type);
  }
  if (checked.content !== undefined) {
    sets.push('content = ?');
    values.push(checked.content);
  }
  if (checked.caption !== undefined) {
    sets.push('caption = ?');
    values.push(checked.caption);
  }
  if (checked.altText !== undefined) {
    sets.push('alt_text = ?');
    values.push(checked.altText);
  }
  if (checked.url !== undefined || hasOwn(req.body, 'url')) {
    const nextUrl = nextType === 'texto' ? null : checked.url;
    sets.push('url = ?');
    values.push(nextUrl);
    if (nextType === 'imagen' && nextUrl && block.image_path) removeOldImage = true;
  }
  if (nextType === 'texto' && !hasOwn(req.body, 'url')) {
    sets.push('url = NULL');
  }
  if (nextType !== 'imagen' && block.image_path) removeOldImage = true;
  if (removeOldImage) {
    writeNarrativeBackup(req.campaign.id, 'antes-de-sustituir-imagen');
    sets.push('image_path = NULL', 'image_mime = NULL');
  }

  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE campaign_narrative_blocks SET ${sets.join(', ')} WHERE id = ?`).run(...values, block.id);
  }
  if (removeOldImage) removeNarrativeImage(block.image_path);
  if (sets.length) writeNarrativeBackup(req.campaign.id, 'actualizar-bloque');
  res.json({ block: serializeNarrativeBlock(getBlock(req.campaign.id, block.id), req.campaign.id) });
});

campaignArchiveRouter.post('/bloques/:blockId/mover', requireArchiveDm, (req, res) => {
  const blockId = cleanId(req.params.blockId);
  const block = blockId && getBlock(req.campaign.id, blockId);
  if (!block) return res.status(404).json({ error: 'Bloque no encontrado' });
  const { direction } = req.body ?? {};
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'La dirección debe ser up o down' });
  }
  const ids = db
    .prepare('SELECT id FROM campaign_narrative_blocks WHERE node_id = ? ORDER BY position, id')
    .all(block.node_id)
    .map((row) => row.id);
  const ordered = moveInOrderedList(ids, block.id, direction);
  const update = db.prepare(
    "UPDATE campaign_narrative_blocks SET position = ?, updated_at = datetime('now') WHERE id = ?"
  );
  db.transaction(() => ordered.forEach((id, position) => update.run(position, id)))();
  writeNarrativeBackup(req.campaign.id, 'reordenar-bloque');
  res.json({ block: serializeNarrativeBlock(getBlock(req.campaign.id, block.id), req.campaign.id) });
});

campaignArchiveRouter.delete('/bloques/:blockId', requireArchiveDm, (req, res) => {
  const blockId = cleanId(req.params.blockId);
  const block = blockId && getBlock(req.campaign.id, blockId);
  if (!block) return res.status(404).json({ error: 'Bloque no encontrado' });
  writeNarrativeBackup(req.campaign.id, 'antes-de-borrar-bloque');
  db.transaction(() => {
    db.prepare('DELETE FROM campaign_narrative_blocks WHERE id = ?').run(block.id);
    const rows = db
      .prepare('SELECT id FROM campaign_narrative_blocks WHERE node_id = ? ORDER BY position, id')
      .all(block.node_id);
    const update = db.prepare('UPDATE campaign_narrative_blocks SET position = ? WHERE id = ?');
    rows.forEach((row, position) => update.run(position, row.id));
  })();
  if (block.image_path) removeNarrativeImage(block.image_path);
  res.json({ ok: true });
});

campaignArchiveRouter.patch(
  '/bloques/:blockId/imagen',
  requireArchiveDm,
  expressRaw({ type: () => true, limit: '15mb' }),
  (req, res) => {
    const blockId = cleanId(req.params.blockId);
    const block = blockId && getBlock(req.campaign.id, blockId);
    if (!block) return res.status(404).json({ error: 'Bloque no encontrado' });
    if (block.type !== 'imagen') return res.status(400).json({ error: 'Este bloque no es una imagen' });
    const format = validateRasterImage(req.body, req.headers['content-type']);
    if (!format) {
      return res.status(400).json({ error: 'La imagen debe ser PNG, JPEG, WebP o GIF válido' });
    }

    const storageKey = `archivo-${req.campaign.id}-${block.id}-${crypto.randomUUID()}${format.extension}`;
    const absolute = narrativeImagePath(storageKey);
    if (block.image_path) writeNarrativeBackup(req.campaign.id, 'antes-de-sustituir-imagen');
    try {
      fs.writeFileSync(absolute, req.body, { flag: 'wx' });
      db.prepare(
        `UPDATE campaign_narrative_blocks
         SET image_path = ?, image_mime = ?, url = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(storageKey, format.mime, block.id);
    } catch (error) {
      removeNarrativeImage(storageKey);
      throw error;
    }
    if (block.image_path) removeNarrativeImage(block.image_path);
    writeNarrativeBackup(req.campaign.id, 'guardar-imagen');
    res.json({ block: serializeNarrativeBlock(getBlock(req.campaign.id, block.id), req.campaign.id) });
  }
);

campaignArchiveRouter.get('/bloques/:blockId/imagen', (req, res) => {
  const blockId = cleanId(req.params.blockId);
  const block = blockId && getBlock(req.campaign.id, blockId);
  if (!block?.image_path) return res.status(404).json({ error: 'Imagen no encontrada' });
  if (req.membership.role !== 'dm' && block.node_visibility !== 'players') {
    return res.status(404).json({ error: 'Imagen no encontrada' });
  }
  const absolute = narrativeImagePath(block.image_path);
  if (!absolute || !fs.existsSync(absolute)) return res.status(404).json({ error: 'Imagen no encontrada' });
  res.set({
    'Content-Type': block.image_mime || 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(absolute);
});

campaignArchiveRouter.get('/buscar', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!q) return res.json({ results: [] });
  const forPlayer = req.membership.role !== 'dm';
  const rows = db
    .prepare(
      `SELECT DISTINCT n.* FROM campaign_narrative_nodes n
       LEFT JOIN campaign_narrative_blocks b ON b.node_id = n.id
       WHERE n.campaign_id = ?
         AND (? = 0 OR (n.kind = 'entrada' AND n.visibility = 'players'))
         AND (
         instr(lower(n.title), lower(?)) > 0 OR
         instr(lower(n.summary), lower(?)) > 0 OR
         instr(lower(COALESCE(b.content, '')), lower(?)) > 0 OR
         instr(lower(COALESCE(b.caption, '')), lower(?)) > 0 OR
         instr(lower(COALESCE(b.url, '')), lower(?)) > 0
       )
       ORDER BY n.updated_at DESC, n.id DESC LIMIT 50`
    )
    .all(req.campaign.id, forPlayer ? 1 : 0, q, q, q, q, q);
  res.json({ results: serializeArchive(req.campaign.id, rows, { forPlayer }) });
});

campaignArchiveRouter.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La imagen supera el límite de 15 MB' });
  }
  next(error);
});
