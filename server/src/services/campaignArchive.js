import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { NARRATIVE_BACKUP_DIR, NARRATIVE_MEDIA_DIR } from '../config.js';

export const NARRATIVE_NODE_KINDS = new Set(['seccion', 'entrada']);
export const NARRATIVE_BLOCK_TYPES = new Set(['texto', 'imagen', 'video', 'enlace', 'musica']);
export const NARRATIVE_VISIBILITIES = new Set(['private', 'players']);
export const NARRATIVE_ICONS = new Set([
  'folder',
  'book',
  'scroll',
  'document',
  'users',
  'flag',
  'pin',
  'map',
  'castle',
  'crown',
  'shield',
  'sword',
  'skull',
  'gem',
  'potion',
  'sparkles',
]);

export const DEFAULT_NARRATIVE_SECTIONS = [
  'Lore general',
  'Personajes',
  'Facciones',
  'Lugares',
  'Tramas y sesiones',
];

export function inferNarrativeIcon(kind, title) {
  const clean = String(title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/lore|historia|cronica|leyenda/.test(clean)) return 'book';
  if (/personaje|p[jn]j|reparto|npc|aliado/.test(clean)) return 'users';
  if (/faccion|gremio|bando|organizacion|culto/.test(clean)) return 'flag';
  if (/mapa|mundo|continente/.test(clean)) return 'map';
  if (/lugar|region|ciudad|pueblo|aldea|ubicacion/.test(clean)) return 'pin';
  if (/trama|sesion|aventura|mision|capitulo/.test(clean)) return 'scroll';
  if (/reino|castillo|fortaleza|torre/.test(clean)) return 'castle';
  if (/rey|reina|corona|noble/.test(clean)) return 'crown';
  if (/guerra|combate|arma|espada/.test(clean)) return 'sword';
  if (/enemigo|monstruo|muerte|peligro/.test(clean)) return 'skull';
  if (/tesoro|objeto|reliquia|gema/.test(clean)) return 'gem';
  if (/magia|hechizo|arcano/.test(clean)) return 'sparkles';
  return kind === 'seccion' ? 'folder' : 'document';
}

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

// Instantánea completa y privada del archivo. Se escribe de forma atómica
// para no dejar JSON a medias si el proceso se interrumpe. También copia las
// imágenes privadas referenciadas a una carpeta hermana, de modo que una
// versión anterior siga siendo recuperable tras sustituir o borrar medios.
export function writeNarrativeBackup(campaignId, reason = 'guardado') {
  const campaign = db
    .prepare('SELECT id, name FROM campaigns WHERE id = ?')
    .get(campaignId);
  if (!campaign) return null;

  const nodes = db
    .prepare(
      `SELECT id, campaign_id, parent_id, kind, title, summary, visibility, icon,
              position, created_at, updated_at
         FROM campaign_narrative_nodes
        WHERE campaign_id = ?
        ORDER BY parent_id, position, id`
    )
    .all(campaignId);
  const blocks = db
    .prepare(
      `SELECT b.* FROM campaign_narrative_blocks b
       JOIN campaign_narrative_nodes n ON n.id = b.node_id
       WHERE n.campaign_id = ? ORDER BY b.node_id, b.position, b.id`
    )
    .all(campaignId);

  const directory = path.join(NARRATIVE_BACKUP_DIR, `campana-${campaign.id}`);
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const cleanReason = String(reason || 'guardado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'guardado';
  const filename = `${timestamp}-${cleanReason}-${crypto.randomUUID()}.json`;
  const destination = path.join(directory, filename);
  const temporary = `${destination}.tmp`;
  const mediaDirectoryName = filename.replace(/\.json$/, '-media');
  const mediaDirectory = path.join(directory, mediaDirectoryName);
  const backupMedia = {};
  for (const block of blocks) {
    if (!block.image_path) continue;
    const source = narrativeImagePath(block.image_path);
    if (!source || !fs.existsSync(source)) continue;
    fs.mkdirSync(mediaDirectory, { recursive: true });
    const targetName = `${block.id}-${path.basename(block.image_path)}`;
    fs.copyFileSync(source, path.join(mediaDirectory, targetName));
    backupMedia[block.id] = `${mediaDirectoryName}/${targetName}`;
  }
  const payload = {
    format: 'tridnd-archivo-v1',
    savedAt: new Date().toISOString(),
    reason,
    campaign: { id: campaign.id, name: campaign.name },
    nodes,
    blocks,
    backupMedia,
  };
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, destination);
  return destination;
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
  const customIcon = NARRATIVE_ICONS.has(row.icon) ? row.icon : null;
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    kind: row.kind,
    title: row.title,
    summary: row.summary ?? '',
    visibility: row.visibility ?? 'private',
    icon: customIcon ?? inferNarrativeIcon(row.kind, row.title),
    iconAutomatic: customIcon == null,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blocks,
  };
}
