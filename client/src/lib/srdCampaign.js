export function srdCampaignPath(category, campaignId = null, index = null) {
  const base = `/srd/${encodeURIComponent(category)}`;
  const detail = index == null ? base : `${base}/${encodeURIComponent(index)}`;
  return Number.isInteger(campaignId) && campaignId > 0
    ? `${detail}?campaignId=${encodeURIComponent(campaignId)}`
    : detail;
}
