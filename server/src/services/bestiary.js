import { db } from '../db.js';

function cleanName(value) {
  return String(value ?? 'Criatura desconocida').trim().slice(0, 80) || 'Criatura desconocida';
}

function creatureIdentity(creature) {
  const monsterIndex = typeof creature?.monster_index === 'string' && creature.monster_index
    ? creature.monster_index
    : typeof creature?.monsterIndex === 'string' && creature.monsterIndex
      ? creature.monsterIndex
      : null;
  const name = cleanName(creature?.name ?? creature?.displayName);
  return {
    key: monsterIndex ? `monster:${monsterIndex}` : `custom:${name.toLocaleLowerCase('es')}`,
    monsterIndex,
    name,
  };
}

// Registra una aparición por criatura, no por cada copia de un mismo grupo
// revelado a la vez. Volver a encontrarla en otra sala/sesión incrementa el
// contador y mantiene la primera fecha.
export function discoverCreatures(campaignId, creatures) {
  const unique = new Map();
  for (const creature of creatures ?? []) {
    const identity = creatureIdentity(creature);
    unique.set(identity.key, identity);
  }
  const upsert = db.prepare(
    `INSERT INTO campaign_bestiary
       (campaign_id, creature_key, monster_index, display_name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(campaign_id, creature_key) DO UPDATE SET
       display_name = excluded.display_name,
       appearances = campaign_bestiary.appearances + 1,
       last_seen_at = datetime('now')`
  );
  for (const creature of unique.values()) {
    upsert.run(campaignId, creature.key, creature.monsterIndex, creature.name);
  }
  return unique.size;
}

export function campaignBestiary(campaignId) {
  return db
    .prepare(
      `SELECT bestiary.*, entry.name_es, entry.name_en, entry.data,
              image.avatar_path AS custom_image
       FROM campaign_bestiary bestiary
       LEFT JOIN srd_entries entry
         ON entry.category = 'monsters' AND entry.idx = bestiary.monster_index
       LEFT JOIN campaigns campaign ON campaign.id = bestiary.campaign_id
       LEFT JOIN monster_images image
         ON image.user_id = campaign.dm_user_id AND image.monster_idx = bestiary.monster_index
       WHERE bestiary.campaign_id = ?
       ORDER BY bestiary.last_seen_at DESC, bestiary.display_name COLLATE NOCASE`
    )
    .all(campaignId)
    .map((row) => {
      let data = {};
      try {
        data = JSON.parse(row.data || '{}');
      } catch {
        data = {};
      }
      // Solo datos de diario: nombre, aspecto y texto. Nunca se incluyen CA,
      // PG, VD, salvaciones ni acciones del bloque de monstruo.
      return {
        id: row.id,
        monsterIndex: row.monster_index,
        name: row.name_es || row.display_name || row.name_en,
        translated: Boolean(row.name_es),
        appearances: row.appearances,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        imageUrl: row.custom_image || (typeof data.image === 'string' && data.image.startsWith('http') ? data.image : null),
        size: data.size || null,
        type: data.type || null,
        alignment: data.alignment || null,
      };
    });
}
