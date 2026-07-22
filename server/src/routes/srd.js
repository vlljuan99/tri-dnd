import { Router, raw as expressRaw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { AVATAR_UPLOADS_DIR } from '../config.js';
import { extensionForMimeType } from '../utils/uploads.js';
import { generateAvatarImage } from '../services/avatarImageGeneration.js';
import { notifyCampaignMap } from '../services/liveMap.js';
import { buildMeta, SRD_CATEGORIES, SRD_CATEGORY_KEYS } from '../services/srdShape.js';
import { searchSrdRows } from '../services/srdSearch.js';
import {
  customCategorySupported,
  isCustomIndex,
  customIdFromIndex,
  listCustomRowsForOwners,
  getCustomRowForOwners,
  serializeCustomEntry,
} from '../services/customLibrary.js';
import { campaignDmForMember, visibleCustomOwnerIds } from '../services/customLibraryAccess.js';

export const srdRouter = Router();
srdRouter.use(requireAuth);

const CATEGORIES = new Set(SRD_CATEGORY_KEYS);
const SPANISH_COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function integerQueryParam(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function numberQueryParam(value, { min = 0, max = 100 } = {}) {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function textQueryParam(value, maximum = 80) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function searchFacetFilters(query) {
  return {
    spellLevelMin: numberQueryParam(query.nivelMin, { min: 0, max: 9 }),
    spellLevelMax: numberQueryParam(query.nivelMax, { min: 0, max: 9 }),
    spellSchool: textQueryParam(query.escuela),
    spellClass: textQueryParam(query.clase),
    monsterCrMin: numberQueryParam(query.vdMin, { min: 0, max: 30 }),
    monsterCrMax: numberQueryParam(query.vdMax, { min: 0, max: 30 }),
    monsterType: textQueryParam(query.tipoMonstruo),
    magicItemRarity: textQueryParam(query.rareza),
  };
}

function matchesSearchFacets(entry, filters) {
  const families = [];
  const spellActive = filters.spellLevelMin != null
    || filters.spellLevelMax != null
    || filters.spellSchool
    || filters.spellClass;
  if (spellActive) {
    const meta = entry.meta ?? {};
    families.push(entry.category === 'spells'
      && (filters.spellLevelMin == null || Number(meta.level) >= filters.spellLevelMin)
      && (filters.spellLevelMax == null || Number(meta.level) <= filters.spellLevelMax)
      && (!filters.spellSchool || meta.school === filters.spellSchool)
      && (!filters.spellClass || meta.classes?.includes(filters.spellClass)));
  }

  const monsterActive = filters.monsterCrMin != null
    || filters.monsterCrMax != null
    || filters.monsterType;
  if (monsterActive) {
    const meta = entry.meta ?? {};
    families.push(entry.category === 'monsters'
      && (filters.monsterCrMin == null || Number(meta.cr) >= filters.monsterCrMin)
      && (filters.monsterCrMax == null || Number(meta.cr) <= filters.monsterCrMax)
      && (!filters.monsterType || String(meta.type).toLowerCase() === filters.monsterType.toLowerCase()));
  }

  if (filters.magicItemRarity) {
    families.push(entry.category === 'magic-items'
      && String(entry.meta?.rarity).toLowerCase() === filters.magicItemRarity.toLowerCase());
  }
  return families.length === 0 || families.some(Boolean);
}

function facetOptions() {
  const spellSchools = db.prepare(
    `SELECT DISTINCT json_extract(spell.data, '$.school.index') AS value,
            COALESCE(reference.name_es, reference.name_en, json_extract(spell.data, '$.school.name')) AS label
       FROM srd_entries spell
       LEFT JOIN srd_entries reference
         ON reference.category = 'magic-schools'
        AND reference.idx = json_extract(spell.data, '$.school.index')
      WHERE spell.category = 'spells' AND value IS NOT NULL
      ORDER BY label`
  ).all();
  const spellClasses = db.prepare(
    `SELECT DISTINCT json_extract(item.value, '$.index') AS value,
            COALESCE(reference.name_es, reference.name_en, json_extract(item.value, '$.name')) AS label
       FROM srd_entries spell
       JOIN json_each(spell.data, '$.classes') item
       LEFT JOIN srd_entries reference
         ON reference.category = 'classes'
        AND reference.idx = json_extract(item.value, '$.index')
      WHERE spell.category = 'spells' AND value IS NOT NULL
      ORDER BY label`
  ).all();
  const monsterTypes = db.prepare(
    `SELECT DISTINCT json_extract(data, '$.type') AS value
       FROM srd_entries
      WHERE category = 'monsters' AND value IS NOT NULL
      ORDER BY value`
  ).all().map(({ value }) => ({ value, label: value }));
  const magicItemRarities = db.prepare(
    `SELECT DISTINCT json_extract(data, '$.rarity.name') AS value
       FROM srd_entries
      WHERE category = 'magic-items' AND value IS NOT NULL
      ORDER BY value`
  ).all().map(({ value }) => ({ value, label: value }));
  return { spellSchools, spellClasses, monsterTypes, magicItemRarities };
}

function sortEntries(entries) {
  return entries.sort((a, b) => SPANISH_COLLATOR.compare(a.name, b.name));
}

function campaignLibraryContext(req, res) {
  if (req.query.campaignId === undefined) return { ok: true, dmUserId: null };
  if (typeof req.query.campaignId !== 'string') {
    res.status(400).json({ error: 'La campaña no es válida' });
    return { ok: false, dmUserId: null };
  }
  const campaignId = Number(req.query.campaignId);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: 'La campaña no es válida' });
    return { ok: false, dmUserId: null };
  }
  const dmUserId = campaignDmForMember(db, campaignId, req.user.id);
  if (dmUserId == null) {
    res.status(403).json({ error: 'No perteneces a esta campaña' });
    return { ok: false, dmUserId: null };
  }
  return { ok: true, dmUserId };
}

function visibleOwnerIds(req, category, campaignContext) {
  return visibleCustomOwnerIds(req.user.id, category, campaignContext.dmUserId);
}

function serializeVisibleCustomEntry(row, category, viewerUserId, options = {}) {
  return serializeCustomEntry(row, category, {
    ...options,
    sharedFromDm: row.user_id !== viewerUserId,
  });
}

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
  const syncError = db.prepare("SELECT value FROM meta WHERE key = 'srd_last_sync_error'").get();
  const rows = db
    .prepare('SELECT category, COUNT(*) AS n FROM srd_entries GROUP BY category')
    .all();
  const storedCounts = Object.fromEntries(rows.map((row) => [row.category, row.n]));
  const counts = Object.fromEntries(SRD_CATEGORY_KEYS.map((category) => [category, storedCounts[category] ?? 0]));
  res.json({
    lastSync: meta?.value ?? null,
    syncError: syncError?.value ?? null,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
    categories: SRD_CATEGORIES,
    facets: facetOptions(),
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
// '/:category' para que "buscar" no se interprete como una categoría. Busca
// las 24 categorías locales y pagina después de mezclar la biblioteca propia.
srdRouter.get('/buscar', (req, res) => {
  const requested = typeof req.query.categorias === 'string'
    ? req.query.categorias.split(',').filter((category) => CATEGORIES.has(category))
    : SRD_CATEGORY_KEYS;
  const categories = requested.length ? [...new Set(requested)] : SRD_CATEGORY_KEYS;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  const limit = Math.max(1, integerQueryParam(req.query.limit, 60, 120));
  const offset = integerQueryParam(req.query.offset, 0, 100_000);
  const source = req.query.fuente === 'srd' || req.query.fuente === 'propios' ? req.query.fuente : null;
  const filters = searchFacetFilters(req.query);
  const campaignContext = campaignLibraryContext(req, res);
  if (!campaignContext.ok) return;

  // Con texto, el índice FTS aplana toda la prosa de cada entrada y ordena por
  // relevancia (bm25); sin texto, se listan las categorías pedidas y se ordena
  // alfabéticamente más abajo. Las categorías se empujan a la consulta para
  // que un término muy común no desplace resultados válidos antes de paginar.
  const srdRows = source === 'propios'
    ? []
    : q
      ? searchSrdRows(q, { categories })
      : db
          .prepare(`SELECT * FROM srd_entries WHERE category IN (${categories.map(() => '?').join(', ')})`)
          .all(...categories);
  let allResults = srdRows.map((row) => toEntry(row));

  const customResults = [];
  if (source !== 'srd') {
    for (const category of categories.filter(customCategorySupported)) {
      const ownerIds = visibleOwnerIds(req, category, campaignContext);
      customResults.push(
        ...listCustomRowsForOwners(ownerIds, category, { q }).map((row) =>
          serializeVisibleCustomEntry(row, category, req.user.id)
        )
      );
    }
  }

  if (q) {
    // Relevancia del SRD ya viene del FTS; el contenido propio del DM (pocas
    // entradas) se añade ordenado por nombre al final.
    allResults = [...allResults, ...sortEntries(customResults)];
  } else {
    allResults = sortEntries([...allResults, ...customResults]);
  }
  allResults = allResults.filter((entry) => matchesSearchFacets(entry, filters));
  const counts = allResults.reduce((result, entry) => {
    result[entry.category] = (result[entry.category] ?? 0) + 1;
    return result;
  }, {});
  const total = allResults.length;
  const results = attachMonsterUserData(allResults.slice(offset, offset + limit), req.user.id);
  res.json({ results, total, counts, offset, limit, hasMore: offset + results.length < total });
});

// Listado con filtros opcionales:
//   ?q=texto      — busca en nombre español e inglés
//   ?cat=weapon   — solo equipment: categoría de equipo (weapon, armor, adventuring-gear…)
//   ?class=wizard — solo spells: hechizos disponibles para esa clase
//   ?maxLevel=3   — solo spells: nivel de hechizo máximo
srdRouter.get('/:category', (req, res) => {
  const { category } = req.params;
  if (!CATEGORIES.has(category)) return res.status(404).json({ error: 'Categoría desconocida' });
  const campaignContext = campaignLibraryContext(req, res);
  if (!campaignContext.ok) return;

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

  const rows = db.prepare(`SELECT * FROM srd_entries WHERE ${where.join(' AND ')}`).all(...params);
  let results = rows.map((row) => toEntry(row));

  // Biblioteca propia del DM (objetos/hechizos): se mezcla con el compendio
  // salvo que se pida explícitamente solo una de las dos fuentes con ?fuente.
  // El filtro de clase de los hechizos no aplica al contenido propio (no tiene
  // lista de clases): los hechizos propios se muestran siempre.
  const fuente = req.query.fuente;
  if (customCategorySupported(category) && fuente !== 'srd') {
    const maxLevel = Number(req.query.maxLevel);
    const ownerIds = visibleOwnerIds(req, category, campaignContext);
    const custom = listCustomRowsForOwners(ownerIds, category, {
      q,
      cat: category === 'equipment' && typeof req.query.cat === 'string' ? req.query.cat : null,
      maxLevel: Number.isInteger(maxLevel) ? maxLevel : null,
    }).map((row) => serializeVisibleCustomEntry(row, category, req.user.id));
    if (fuente === 'propios') results = custom;
    else results = [...custom, ...results];
  }
  sortEntries(results);
  const total = results.length;
  const limit = Math.max(1, integerQueryParam(req.query.limit, 400, 1_000));
  const offset = integerQueryParam(req.query.offset, 0, 100_000);
  results = attachMonsterUserData(results.slice(offset, offset + limit), req.user.id);
  res.json({ results, total, offset, limit, hasMore: offset + results.length < total });
});

// Detalle de una entrada, con datos completos del SRD o de la biblioteca propia
srdRouter.get('/:category/:idx', (req, res) => {
  const { category, idx } = req.params;

  if (isCustomIndex(idx)) {
    if (!customCategorySupported(category)) {
      return res.status(404).json({ error: 'Entrada no encontrada' });
    }
    const campaignContext = campaignLibraryContext(req, res);
    if (!campaignContext.ok) return;
    const id = customIdFromIndex(idx);
    const ownerIds = visibleOwnerIds(req, category, campaignContext);
    const row = id != null && getCustomRowForOwners(ownerIds, category, id);
    if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
    return res.json(serializeVisibleCustomEntry(row, category, req.user.id, { full: true }));
  }

  const row = db
    .prepare('SELECT * FROM srd_entries WHERE category = ? AND idx = ?')
    .get(category, idx);
  if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
  const [entry] = attachMonsterUserData([toEntry(row, { full: true })], req.user.id);
  res.json(entry);
});
