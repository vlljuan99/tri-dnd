import { useParams } from 'react-router-dom';
import CampaignEventsPanel from '../../../components/CampaignEventsPanel.jsx';
import { campaignTypeOf } from '../steps.js';
import StepShell from './StepShell.jsx';

// Paso 6 — Eventos: la biblioteca de eventos del DM y sus enlaces a esta
// campaña (salas, marcadores, ubicaciones o la campaña entera). El panel es
// el mismo que vivía en «Gestión».
export default function EventosStep({ progress }) {
  const { id } = useParams();
  const isNarrative = campaignTypeOf(progress.campaign) === 'campana';
  return (
    <StepShell
      progress={progress}
      stepId="eventos"
      description={
        isNarrative
          ? 'Efectos con disparador: manuales (recordatorios a tu vista), cada N rondas, al revelarse una sala o al llegar a una ubicación. Cuando se cumplen, publican un mensaje de sistema en el chat.'
          : 'Efectos con disparador para la escaramuza: manuales (recordatorios a tu vista), cada N rondas o al revelarse una sala. Cuando se cumplen, publican un mensaje de sistema en el chat.'
      }
    >
      <CampaignEventsPanel
        campaignId={id}
        campaignData={progress.eventos}
        refreshCampaignData={() => progress.refreshResource('eventos')}
        allowWorldLocations={isNarrative}
      />
    </StepShell>
  );
}
