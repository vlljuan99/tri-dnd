import { Navigate, useOutletContext, useParams } from 'react-router-dom';
import { stepsForCampaign } from '../steps.js';
import IdentidadStep from '../components/IdentidadStep.jsx';
import LoreStep from '../components/LoreStep.jsx';
import MundoStep from '../components/MundoStep.jsx';
import RepartoStep from '../components/RepartoStep.jsx';
import MapasStep from '../components/MapasStep.jsx';
import EventosStep from '../components/EventosStep.jsx';
import JugadoresStep from '../components/JugadoresStep.jsx';

const PANELS = {
  identidad: IdentidadStep,
  lore: LoreStep,
  mundo: MundoStep,
  reparto: RepartoStep,
  mapas: MapasStep,
  eventos: EventosStep,
  jugadores: JugadoresStep,
};

/** Resuelve /taller/:seccion al panel del paso; secciones desconocidas o no
 *  aplicables al tipo de campaña vuelven al inicio del taller. */
export default function TallerStepPage() {
  const { id, seccion } = useParams();
  const progress = useOutletContext();
  const steps = stepsForCampaign(progress.campaign);
  const step = steps.find((candidate) => candidate.id === seccion);
  if (!step) return <Navigate to={`/campanas/${id}/taller`} replace />;
  const Panel = PANELS[step.id];
  return <Panel progress={progress} />;
}

/** Índice del taller: prioriza un paso vacío; si ya se empezaron todos,
 *  retoma el primero que aún está en marcha. */
export function TallerIndexRedirect() {
  const { id } = useParams();
  const progress = useOutletContext();
  const steps = stepsForCampaign(progress.campaign);
  const firstEmpty = steps.find((step) => progress.statuses[step.id] === 'empty');
  const firstStarted = steps.find((step) => progress.statuses[step.id] === 'started');
  const target = firstEmpty ?? firstStarted ?? steps[0];
  return <Navigate to={`/campanas/${id}/taller/${target.id}`} replace />;
}
