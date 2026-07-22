// Los pasos del Taller de campaña: la preparación del DM como estructura
// permanente y navegable, no como un asistente del que se sale. Cada paso
// sabe si aplica al tipo de campaña y cómo calcular su estado a partir de
// los datos que ya sirve la API (sin endpoints nuevos).

export const TALLER_STEPS = [
  {
    id: 'identidad',
    label: 'Identidad',
    hint: 'Nombre, sinopsis y plazas',
    narrativeOnly: false,
  },
  {
    id: 'lore',
    label: 'Lore y trama',
    hint: 'Archivo privado y presentación pública',
    narrativeOnly: true,
  },
  {
    id: 'mundo',
    label: 'Mundo',
    hint: 'El mapa de mundo y sus ubicaciones',
    narrativeOnly: true,
  },
  {
    id: 'reparto',
    label: 'Reparto',
    hint: 'PNJ, enemigos y su equipo',
    narrativeOnly: false,
  },
  {
    id: 'mapas',
    label: 'Mapas',
    hint: 'Los tableros tácticos',
    narrativeOnly: false,
  },
  {
    id: 'eventos',
    label: 'Eventos',
    hint: 'Efectos y disparadores',
    narrativeOnly: false,
  },
  {
    id: 'jugadores',
    label: 'Jugadores',
    hint: 'Invitación y grupo',
    narrativeOnly: false,
  },
];

export function campaignTypeOf(campaign) {
  if (!campaign) return 'campana';
  return campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza');
}

/** Pasos visibles para una campaña concreta (la escaramuza omite los narrativos). */
export function stepsForCampaign(campaign) {
  if (campaignTypeOf(campaign) === 'campana') return TALLER_STEPS;
  return TALLER_STEPS.filter((step) => !step.narrativeOnly);
}
