import { Router, raw as expressRaw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { AVATAR_UPLOADS_DIR } from '../config.js';
import { extensionForMimeType } from '../utils/uploads.js';
import { generateAvatarImage } from '../services/avatarImageGeneration.js';
import { notifyCampaignMap } from '../services/liveMap.js';
import { buildMeta } from '../services/srdShape.js';
import {
  customCategorySupported,
  isCustomIndex,
  customIdFromIndex,
  listCustomRows,
  getCustomRow,
  serializeCustomEntry,
} from '../services/customLibrary.js';

export const srdRouter = Router();
srdRouter.use(requireAuth);

const CATEGORIES = new Set([
  'ability-scores',
  'classes',
  'conditions',
  'damage-types',
  'equipment',
  'magic-schools',
  'monsters',
  'races',
  'skills',
  'spells',
  'weapon-properties',
]);

function toEntry(row, { full = false } = {}) {
  const data = JSON.parse(row.data);
  const entry = {
    category: row.category,
    index: row.idx,
    name: row.name_es || row.name_en,
    nameEn: row.name_en,
    translated: Boolean(row.name_es),
    meta: buildMeta(row.category, data),
  };
  if (full) {
    entry.data = data;
    entry.descEs = row.desc_es || null;
  }
  return entry;
}

// Favoritos e imagen personalizada del usuario sobre entradas del compendio
// (hoy solo monstruos): se añaden al vuelo a las entradas serializadas.
function attachMonsterUserData(entries, userId) {
  const monsters = entries.filter((e) => e.category === 'monsters');
  if (!monsters.length) return entries;
  const favorites = new Set(
    db
      .prepare("SELECT idx FROM srd_favorites WHERE user_id = ? AND category = 'monsters'")
      .all(userId)
      .map((r) => r.idx)
  );
  const images = new Map(
    db
      .prepare('SELECT monster_idx, avatar_path FROM monster_images WHERE user_id = ?')
      .all(userId)
      .map((r) => [r.monster_idx, r.avatar_path])
  );
  for (const entry of monsters) {
    entry.favorite = favorites.has(entry.index);
    entry.imageUrl = images.get(entry.index) ?? null;
  }
  return entries;
}

// Al cambiar la imagen de un monstruo, los tableros de las campañas de este
// DM que ya lo tengan colocado repintan su marcador (misma señal que
// cualquier otro cambio de mapa: nunca viajan datos por el socket).
function notifyDmCampaigns(userId) {
  for (const { id } of db.prepare('SELECT id FROM campaigns WHERE dm_user_id = ?').all(userId)) {
    notifyCampaignMap(id);
  }
}

// Estado de la sincronización del compendio
srdRouter.get('/status', (req, res) => {
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'srd_last_sync'").get();
  const counts = db
    .prepare('SELECT category, COUNT(*) AS n FROM srd_entries GROUP BY category')
    .all();
  res.json({
    lastSync: meta?.value ?? null,
    counts: Object.fromEntries(counts.map((c) => [c.category, c.n])),
  });
});

// --- Favoritos del compendio (Bestiario) -----------------------------------
// Registradas antes de '/:category' para que 'favoritos' no se interprete
// como una categoría del SRD.

srdRouter.get('/favoritos', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  if (category && !CATEGORIES.has(category)) {
    return res.status(404).json({ error: 'Categoría desconocida' });
  }
  const rows = db
    .prepare(
      `SELECT e.* FROM srd_favorites fav
       JOIN srd_entries e ON e.category = fav.category AND e.idx = fav.idx
       WHERE fav.user_id = ? ${category ? 'AND fav.category = ?' : ''}
       ORDER BY COALESCE(e.name_es, e.name_en)`
    )
    .all(...(category ? [req.user.id, category] : [req.user.id]));
  res.json({ results: attachMonsterUserData(rows.map((r) => toEntry(r)), req.user.id) });
});

srdRouter.put('/favoritos/:category/:idx', (req, res) => {
  const { category, idx } = req.params;
  const row = db
    .prepare('SELECT 1 FROM srd_entries WHERE category = ? AND idx = ?')
    .get(category, idx);
  if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
  db.prepare(
    'INSERT OR IGNORE INTO srd_favorites (user_id, category, idx) VALUES (?, ?, ?)'
  ).run(req.user.id, category, idx);
  res.json({ ok: true, favorite: true });
});

srdRouter.delete('/favoritos/:category/:idx', (req, res) => {
  const { category, idx } = req.params;
  db.prepare('DELETE FROM srd_favorites WHERE user_id = ? AND category = ? AND idx = ?').run(
    req.user.id,
    category,
    idx
  );
  res.json({ ok: true, favorite: false });
});

// --- Imagen personalizada de un monstruo del compendio ---------------------
// Por usuario: cada DM viste el compendio a su gusto sin pisar el de otros.
// La imagen se guarda una vez y se reutiliza en cada marcador del tablero.

function getMonsterEntry(req, res) {
  const row = db
    .prepare("SELECT * FROM srd_entries WHERE category = 'monsters' AND idx = ?")
    .get(req.params.idx);
  if (!row) {
    res.status(404).json({ error: 'Monstruo no encontrado' });
    return null;
  }
  return row;
}

function saveMonsterImage(userId, monsterIdx, buffer, extension) {
  const filename = `monster-${userId}-${monsterIdx}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(AVATAR_UPLOADS_DIR, filename), buffer);
  const imageUrl = `/uploads/avatars/${filename}`;
  db.prepare(
    `INSERT INTO monster_images (user_id, monster_idx, avatar_path) VALUES (?, ?, ?)
     ON CONFLICT(user_id, monster_idx)
     DO UPDATE SET avatar_path = excluded.avatar_path, updated_at = datetime('now')`
  ).run(userId, monsterIdx, imageUrl);
  notifyDmCampaigns(userId);
  return imageUrl;
}

srdRouter.patch(
  '/monsters/:idx/imagen',
  expressRaw({ type: () => true, limit: '8mb' }),
  (req, res) => {
    const row = getMonsterEntry(req, res);
    if (!row) return;
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'El archivo debe ser una imagen' });
    }
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }
    const imageUrl = saveMonsterImage(req.user.id, row.idx, buffer, extensionForMimeType(contentType));
    res.json({ imageUrl });
  }
);

srdRouter.post('/monsters/:idx/imagen/generar', async (req, res) => {
  const row = getMonsterEntry(req, res);
  if (!row) return;
  const { prompt, provider } = req.body ?? {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 400) : '';
  // Sin descripción del DM, el nombre en inglés del SRD ya es un buen prompt
  const finalPrompt = cleanPrompt || `${row.name_en}, monstruo de Dungeons and Dragons`;
  try {
    const generated = await generateAvatarImage(provider, finalPrompt);
    const imageUrl = saveMonsterImage(req.user.id, row.idx, generated.buffer, '.png');
    res.json({ imageUrl });
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo generar la imagen' });
  }
});

srdRouter.delete('/monsters/:idx/imagen', (req, res) => {
  const row = getMonsterEntry(req, res);
  if (!row) return;
  db.prepare('DELETE FROM monster_images WHERE user_id = ? AND monster_idx = ?').run(
    req.user.id,
    row.idx
  );
  notifyDmCampaigns(req.user.id);
  res.json({ imageUrl: null });
});

// Buscador transversal del compendio (Fase 11). Se registra antes de
// '/:category' para que "buscar" no se interprete como una categoria.
srdRouter.get('/buscar', (req, res) => {
  const searchable = ['spells', 'monsters', 'equipment', 'conditions'];
  const requested = typeof req.query.categorias === 'string'
    ? req.query.categorias.split(',').filter((category) => searchable.includes(category))
    : searchable;
  const categories = requested.length ? [...new Set(requested)] : searchable;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  const placeholders = categories.map(() => '?').join(', ');
  const where = [`category IN (${placeholders})`];
  const params = [...categories];
  if (q) {
    where.push('(name_es LIKE ? OR name_en LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  let results = db
    .prepare(
      `SELECT * FROM srd_entries WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(name_es, name_en) LIMIT 120`
    )
    .all(...params)
    .map((row) => toEntry(row));

  for (const category of categories.filter(customCategorySupported)) {
    results.push(...listCustomRows(req.user.id, category, { q }).map((row) => serializeCustomEntry(row, category)));
  }
  results = attachMonsterUserData(results, req.user.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .slice(0, 120);
  res.json({ results });
});

// Listado con filtros opcionales:
//   ?q=texto      — busca en nombre español e inglés
//   ?cat=weapon   — solo equipment: categoría de equipo (weapon, armor, adventuring-gear…)
//   ?class=wizard — solo spells: hechizos disponibles para esa clase
//   ?maxLevel=3   — solo spells: nivel de hechizo máximo
srdRouter.get('/:category', (req, res) => {
  const { category } = req.params;
  if (!CATEGORIES.has(category)) return res.status(404).json({ error: 'Categoría desconocida' });

  const where = ['category = ?'];
  const params = [category];

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    where.push('(name_es LIKE ? OR name_en LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category === 'equipment' && typeof req.query.cat === 'string') {
    where.push("json_extract(data, '$.equipment_category.index') = ?");
    params.push(req.query.cat);
  }
  if (category === 'spells') {
    if (typeof req.query.class === 'string') {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(srd_entries.data, '$.classes') je WHERE json_extract(je.value, '$.index') = ?)"
      );
      params.push(req.query.class);
    }
    const maxLevel = Number(req.query.maxLevel);
    if (Number.isInteger(maxLevel)) {
      where.push("json_extract(data, '$.level') <= ?");
      params.push(maxLevel);
    }
  }

  const rows = db
    .prepare(
      `SELECT * FROM srd_entries WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(name_es, name_en) LIMIT 400`
    )
    .all(...params);
  let results = attachMonsterUserData(rows.map((r) => toEntry(r)), req.user.id);

  // Biblioteca propia del DM (objetos/hechizos): se mezcla con el compendio
  // salvo que se pida explícitamente solo una de las dos fuentes con ?fuente.
  // El filtro de clase de los hechizos no aplica al contenido propio (no tiene
  // lista de clases): los hechizos propios se muestran siempre.
  const fuente = req.query.fuente;
  if (customCategorySupported(category) && fuente !== 'srd') {
    const maxLevel = Number(req.query.maxLevel);
    const custom = listCustomRows(req.user.id, category, {
      q,
      cat: category === 'equipment' && typeof req.query.cat === 'string' ? req.query.cat : null,
      maxLevel: Number.isInteger(maxLevel) ? maxLevel : null,
    }).map((row) => serializeCustomEntry(row, category));
    if (fuente === 'propios') results = custom;
    else results = [...custom, ...results];
  }
  res.json({ results });
});

// Detalle de una entrada, con datos completos del SRD o de la biblioteca propia
srdRouter.get('/:category/:idx', (req, res) => {
  const { category, idx } = req.params;

  if (isCustomIndex(idx)) {
    if (!customCategorySupported(category)) {
      return res.status(404).json({ error: 'Entrada no encontrada' });
    }
    const id = customIdFromIndex(idx);
    const row = id != null && getCustomRow(req.user.id, category, id);
    if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
    return res.json(serializeCustomEntry(row, category, { full: true }));
  }

  const row = db
    .prepare('SELECT * FROM srd_entries WHERE category = ? AND idx = ?')
    .get(category, idx);
  if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
  const [entry] = attachMonsterUserData([toEntry(row, { full: true })], req.user.id);
  res.json(entry);
});
