const SAFE_TALLER_STEPS = new Set([
  'identidad',
  'lore',
  'mundo',
  'reparto',
  'mapas',
  'eventos',
  'jugadores',
]);

function safeCampaignId(value) {
  const raw = String(value ?? '');
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function buildTallerReturnSearch(campaignId, step = 'reparto') {
  const id = safeCampaignId(campaignId);
  if (!id || !SAFE_TALLER_STEPS.has(step)) return '';
  const params = new URLSearchParams({ volver: 'taller', campana: String(id), paso: step });
  return `?${params.toString()}`;
}

export function resolveCharacterReturn(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? '');
  if (params.get('volver') !== 'taller') return null;
  const campaignId = safeCampaignId(params.get('campana'));
  const step = params.get('paso');
  if (!campaignId || !SAFE_TALLER_STEPS.has(step)) return null;
  return {
    to: `/campanas/${campaignId}/taller/${step}`,
    label: 'Volver al Taller',
    search: buildTallerReturnSearch(campaignId, step),
  };
}
