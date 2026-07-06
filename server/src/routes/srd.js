import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

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

// Resumen mínimo por categoría para pintar listados sin descargar el detalle
function buildMeta(category, data) {
  if (category === 'spells') {
    return {
      level: data.level,
      school: data.school?.index,
      concentration: data.concentration,
      ritual: data.ritual,
      attackType: data.attack_type ?? null,
      hasDamage: Boolean(data.damage),
      dc: data.dc?.dc_type?.index ?? null,
    };
  }
  if (category === 'equipment') {
    return {
      equipmentCategory: data.equipment_category?.index,
      damage: data.damage
        ? { dice: data.damage.damage_dice, type: data.damage.damage_type?.index }
        : null,
      twoHandedDamage: data.two_handed_damage
        ? { dice: data.two_handed_damage.damage_dice, type: data.two_handed_damage.damage_type?.index }
        : null,
      properties: (data.properties ?? []).map((p) => p.index),
      weaponRange: data.weapon_range ?? null,
      armorClass: data.armor_class ?? null,
    };
  }
  if (category === 'monsters') {
    return { cr: data.challenge_rating, type: data.type, hp: data.hit_points, ac: data.armor_class?.[0]?.value };
  }
  return undefined;
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
  res.json({ results: rows.map((r) => toEntry(r)) });
});

// Detalle de una entrada, con datos completos del SRD
srdRouter.get('/:category/:idx', (req, res) => {
  const { category, idx } = req.params;
  const row = db
    .prepare('SELECT * FROM srd_entries WHERE category = ? AND idx = ?')
    .get(category, idx);
  if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
  res.json(toEntry(row, { full: true }));
});
