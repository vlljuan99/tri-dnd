// Secciones de la zona de campañas. El Hub era una sola columna con scroll
// donde convivían crear, unirse, las campañas y las escaramuzas; aquí cada
// cosa tiene su sitio, con el mismo patrón de sub-navegación que el Taller.
//
// Las rutas son segmentos ESTÁTICOS a propósito: `/campanas/:id` (el detalle
// de una campaña) ya existe, y dos rutas dinámicas hermanas se pisarían. Como
// React Router prioriza lo estático sobre lo dinámico y los ids son
// numéricos, `/campanas/escaramuzas` y `/campanas/7` conviven sin ambigüedad.

export const HUB_SECTIONS = [
  {
    id: 'campanas',
    path: '/campanas',
    label: 'Campañas',
    hint: 'Tus mesas largas y su preparación',
  },
  {
    id: 'escaramuzas',
    path: '/campanas/escaramuzas',
    label: 'Escaramuzas',
    hint: 'Partidas de un solo tablero',
  },
  {
    id: 'escenarios',
    path: '/campanas/escenarios',
    label: 'Escenarios',
    hint: 'Listos para jugar y los que guardes tú',
  },
  {
    id: 'donde-juego',
    path: '/campanas/donde-juego',
    label: 'Donde juego',
    hint: 'Mesas en las que eres jugador',
  },
];

export function campaignTypeOf(campaign) {
  return campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza');
}

export function isDraft(campaign) {
  return campaign.status === 'draft';
}

/** Reparto de las campañas del usuario entre las secciones que las muestran. */
export function splitCampaigns(campaigns) {
  const own = (campaigns ?? []).filter((campaign) => campaign.role === 'dm');
  return {
    campanas: own.filter((campaign) => campaignTypeOf(campaign) === 'campana'),
    escaramuzas: own.filter((campaign) => campaignTypeOf(campaign) === 'escaramuza'),
    ajenas: (campaigns ?? []).filter((campaign) => campaign.role !== 'dm'),
  };
}
