import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { NARRATIVE_MEDIA_DIR } from '../config.js';

export const NARRATIVE_NODE_KINDS = new Set(['seccion', 'entrada']);
export const NARRATIVE_BLOCK_TYPES = new Set(['texto', 'imagen', 'video', 'enlace', 'musica']);

export const DEFAULT_NARRATIVE_SECTIONS = [
  'Lore general',
  'Personajes',
  'Facciones',
  'Lugares',
  'Tramas y sesiones',
];

// Se llama al crear una campaña y también al convertir una escaramuza en
// campaña. Si el DM ya organizó su archivo (aunque lo haya dejado distinto a
// la plantilla), no se vuelve a sembrar nada.
export function seedDefaultNarrativeSections(campaignId) {
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM campaign_narrative_nodes WHERE campaign_id = ?')
    .get(campaignId).n;
  if (count > 0) return false;

  const insert = db.prepare(
    `INSERT INTO campaign_narrative_nodes (campaign_id, parent_id, kind, title, summary, position)
     VALUES (?, NULL, 'seccion', ?, '', ?)`
  );
  DEFAULT_NARRATIVE_SECTIONS.forEach((title, position) => insert.run(campaignId, title, position));
  return true;
}

export function isSafeExternalUrl(value) {
  if (typeof value !== 'string') return false;
  const clean = value.trim();
  if (!clean || clean.length > 2048) return false;
  try {
    const parsed = new URL(clean);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function normalizeExternalUrl(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  return isSafeExternalUrl(value) ? value.trim() : undefined;
}

// Evita tanto hacerse padre a uno mismo como mover una sección dentro de
// cualquiera de sus descendientes. getParentId permite probar esta regla sin
// depender de SQLite.
export function wouldCreateNarrativeCycle(nodeId, parentId, getParentId) {
  if (parentId == null) return false;
  const target = Number(nodeId);
  let cursor = Number(parentId);
  const seen = new Set();
  while (Number.isInteger(cursor) && !seen.has(cursor)) {
    if (cursor === target) return true;
    seen.add(cursor);
    const next = getParentId(cursor);
    if (next == null) return false;
    cursor = Number(next);
  }
  // Una jerarquía ya corrupta tampoco debe admitir otro movimiento.
  return seen.has(cursor);
}

const RASTER_BY_MIME = {
  'image/png': { extension: '.png', matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { extension: '.jpg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': {
    extension: '.webp',
    matches: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  'image/gif': {
    extension: '.gif',
    matches: (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)),
  },
};

// No basta con confiar en Content-Type: comprobamos también la firma del
// binario y excluimos expresamente SVG/HTML por su capacidad de ejecutar JS.
export function validateRasterImage(buffer, claimedMime) {
  const mime = typeof claimedMime === 'string' ? claimedMime.split(';', 1)[0].trim().toLowerCase() : '';
  const format = RASTER_BY_MIME[mime];
  if (!Buffer.isBuffer(buffer) || !format || !format.matches(buffer)) return null;
  return { mime, extension: format.extension };
}

export function narrativeImagePath(storageKey) {
  if (typeof storageKey !== 'string' || path.basename(storageKey) !== storageKey) return null;
  const resolved = path.resolve(NARRATIVE_MEDIA_DIR, storageKey);
  const root = `${path.resolve(NARRATIVE_MEDIA_DIR)}${path.sep}`;
  return resolved.startsWith(root) ? resolved : null;
}

export function removeNarrativeImage(storageKey) {
  const absolute = narrativeImagePath(storageKey);
  if (!absolute) return false;
  try {
    fs.rmSync(absolute, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function narrativeImagesForCampaign(campaignId) {
  return db
    .prepare(
      `SELECT b.image_path FROM campaign_narrative_blocks b
       JOIN campaign_narrative_nodes n ON n.id = b.node_id
       WHERE n.campaign_id = ? AND b.image_path IS NOT NULL`
    )
    .all(campaignId)
    .map((row) => row.image_path);
}

export function serializeNarrativeBlock(row, campaignId) {
  const hasPrivateImage = Boolean(row.image_path);
  return {
    id: row.id,
    nodeId: row.node_id,
    type: row.type,
    content: row.content ?? '',
    url: row.url ?? null,
    caption: row.caption ?? '',
    altText: row.alt_text ?? '',
    position: row.position,
    hasPrivateImage,
    imageUrl: hasPrivateImage
      ? `/api/campaigns/${campaignId}/archivo/bloques/${row.id}/imagen`
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeNarrativeNode(row, blocks = []) {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    kind: row.kind,
    title: row.title,
    summary: row.summary ?? '',
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blocks,
  };
}
