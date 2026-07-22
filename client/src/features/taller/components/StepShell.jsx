import { Link, useNavigate, useParams } from 'react-router-dom';
import { stepsForCampaign } from '../steps.js';

// Armazón común de los pasos de formulario: cabecera con el nombre y la
// posición del paso, contenido desplazable y pie con «anterior / siguiente».
// Los pasos a pantalla completa (lore) no lo usan.

export default function StepShell({ progress, stepId, description, children, maxWidth = 'max-w-3xl' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const steps = stepsForCampaign(progress.campaign);
  const index = steps.findIndex((step) => step.id === stepId);
  const step = steps[index];
  const previous = steps[index - 1] ?? null;
  const next = steps[index + 1] ?? null;

  function guardedClick(destination) {
    return (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      void progress.prepareNavigation().then((canLeave) => {
        if (canLeave) navigate(destination);
      });
    };
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`mx-auto w-full ${maxWidth} px-4 py-6`}>
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl tracking-wide text-gold">{step.label}</h2>
          <span className="shrink-0 font-mono text-[0.65rem] uppercase tracking-widest text-bone/40">
            Paso {index + 1} de {steps.length}
          </span>
        </div>
        {description && <p className="mb-5 max-w-2xl text-sm leading-relaxed text-bone/55">{description}</p>}

        {children}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-bone/10 pt-4">
          {previous ? (
            <Link
              to={`/campanas/${id}/taller/${previous.id}`}
              onClick={guardedClick(`/campanas/${id}/taller/${previous.id}`)}
              className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm text-bone/70 hover:border-gold hover:text-gold"
            >
              ← {previous.label}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to={`/campanas/${id}/taller/${next.id}`}
              onClick={guardedClick(`/campanas/${id}/taller/${next.id}`)}
              className="rounded-sm border border-gold/40 px-3 py-1.5 font-display text-sm tracking-wide text-gold hover:bg-gold/10"
            >
              {next.label} →
            </Link>
          ) : (
            <Link
              to={`/campanas/${id}`}
              onClick={guardedClick(`/campanas/${id}`)}
              className="hidden rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 lg:inline-flex"
            >
              Abrir la mesa de juego →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
