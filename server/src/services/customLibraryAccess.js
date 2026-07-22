// Política de lectura del homebrew en el compendio. La autoría sigue siendo
// privada (cada usuario solo edita su Biblioteca), pero clases y razas pueden
// consumirse desde una ficha vinculada a una campaña: en ese contexto también
// se leen las entradas creadas por el DM de esa campaña.

const CAMPAIGN_SHARED_CATEGORIES = new Set(['classes', 'races']);

export function visibleCustomOwnerIds(viewerUserId, category, campaignDmUserId = null) {
  const ownerIds = [viewerUserId];
  if (
    CAMPAIGN_SHARED_CATEGORIES.has(category) &&
    Number.isInteger(campaignDmUserId) &&
    campaignDmUserId !== viewerUserId
  ) {
    ownerIds.push(campaignDmUserId);
  }
  return ownerIds;
}

export function campaignDmForMember(database, campaignId, viewerUserId) {
  return database
    .prepare(
      `SELECT c.dm_user_id
       FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id
       WHERE c.id = ? AND m.user_id = ?`
    )
    .get(campaignId, viewerUserId)?.dm_user_id ?? null;
}
