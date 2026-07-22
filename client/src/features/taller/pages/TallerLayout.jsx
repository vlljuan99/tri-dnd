import { useCallback, useEffect, useRef } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useTallerProgress } from '../hooks/useTallerProgress.js';
import { campaignTypeOf, stepsForCampaign } from '../steps.js';

// El Taller de campaña: el único lugar de preparación del DM. La barra
// lateral con los pasos numerados y su estado no desaparece nunca; cada paso
// es un panel a la derecha. Sustituye al asistente, la gestión y las
// cabeceras cruzadas de las pantallas antiguas.

function StepIcon({ status, active }) {
  if (status === 'done') {
    return (
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] ${
          active ? 'border-gold bg-gold text-night-950' : 'border-sage/60 text-sage'
        }`}
      >
        ✓
      </span>
    );
  }
  if (status === 'started') {
    return (
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-base leading-none ${
          active ? 'border-gold bg-gold/20 text-gold' : 'border-ochre/70 text-ochre'
        }`}
      >
        ·
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`h-5 w-5 shrink-0 rounded-full border ${
        active ? 'border-gold bg-gold/20' : 'border-bone/25'
      }`}
    />
  );
}

export default function TallerLayout() {
  const { id } = useParams();
  const campaignId = Number(id);
  const progress = useTallerProgress(campaignId);
  const { campaign, statuses, readiness, error, loading } = progress;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navRef = useRef(null);

  const guardedNavigation = useCallback(
    (event, destination) => {
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
    },
    [navigate, progress.prepareNavigation]
  );

  // La navegación horizontal de móvil mantiene centrado el paso actual. En
  // escritorio no se desplaza nada: la barra lateral ya es completamente
  // visible y tocar su scroll resultaría molesto.
  useEffect(() => {
    if (loading || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(max-width: 1023px)').matches) return undefined;
    const frame = window.requestAnimationFrame(() => {
      navRef.current
        ?.querySelector('[aria-current="page"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, pathname]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">{error}</p>
        <Link to="/" className="text-gold underline">Volver al hub</Link>
      </div>
    );
  }
  if (loading || !campaign) {
    return (
      <div className="flex h-full items-center justify-center bg-night-950 text-bone">
        <p className="font-display text-lg text-gold">Abriendo el taller…</p>
      </div>
    );
  }
  if (campaign.role !== 'dm') {
    return <Navigate to={`/campanas/${campaignId}`} replace />;
  }

  const steps = stepsForCampaign(campaign);
  const doneCount = steps.filter((step) => statuses[step.id] === 'done').length;
  const startedCount = steps.filter((step) => statuses[step.id] === 'started').length;
  const isCampaign = campaignTypeOf(campaign) === 'campana';

  const stepItem = (step, index) => (
    <NavLink
      key={step.id}
      to={`/campanas/${campaignId}/taller/${step.id}`}
      onClick={(event) =>
        guardedNavigation(event, `/campanas/${campaignId}/taller/${step.id}`)
      }
      aria-label={`${index + 1}. ${step.label}: ${
        statuses[step.id] === 'done'
          ? 'completo'
          : statuses[step.id] === 'started'
            ? 'en marcha'
            : 'vacío'
      }`}
      className={({ isActive }) =>
        `flex shrink-0 items-center gap-2.5 rounded-sm px-3 py-2 text-left lg:w-full ${
          isActive
            ? 'border border-gold/40 bg-gold/10 text-gold'
            : 'border border-transparent text-bone/70 hover:bg-bone/5 hover:text-bone'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <StepIcon status={statuses[step.id]} active={isActive} />
          <span className="min-w-0">
            <span className="block truncate font-display text-sm tracking-wide">
              {index + 1} · {step.label}
            </span>
            <span className="hidden truncate text-[0.65rem] text-bone/40 lg:block">{step.hint}</span>
          </span>
        </>
      )}
    </NavLink>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-night-950 text-bone lg:flex-row">
      {/* Barra lateral (en móvil, franja superior deslizable) */}
      <aside className="flex shrink-0 flex-col border-b border-gold/20 bg-night-900/70 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="border-b border-gold/15 px-4 py-3">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-gold/60">
            Taller · {isCampaign ? 'Campaña' : 'Escaramuza'}
          </p>
          <h1 className="truncate font-display text-lg tracking-wide text-gold" title={campaign.name}>
            {campaign.name}
          </h1>
          {readiness.ready ? (
            <p className="mt-1 text-[0.68rem] leading-snug text-sage">
              ✓ Primera sesión lista: tablero activo y grupo preparado.
            </p>
          ) : (
            <p className="mt-1 text-[0.68rem] leading-snug text-bone/55">
              Para la primera sesión:{' '}
              {readiness.missing.map((requirement, index) => (
                <span key={requirement.id}>
                  {index > 0 && ' · '}
                  <Link
                    to={`/campanas/${campaignId}/taller/${requirement.id}`}
                    onClick={(event) =>
                      guardedNavigation(
                        event,
                        `/campanas/${campaignId}/taller/${requirement.id}`
                      )
                    }
                    className="text-gold/80 underline decoration-gold/30 underline-offset-2 hover:text-gold"
                  >
                    {requirement.label}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
          <p className="text-[0.7rem] text-bone/45">
            {doneCount} de {steps.length} pasos completos
            {startedCount > 0 ? ` · ${startedCount} en marcha` : ''}
          </p>
        </div>

        <nav
          ref={navRef}
          aria-label="Pasos del taller"
          className="flex gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-1 lg:flex-col lg:overflow-y-auto"
        >
          {steps.map(stepItem)}
        </nav>

        <div className="hidden border-t border-gold/15 p-3 lg:block">
          <Link
            to={`/campanas/${campaignId}`}
            onClick={(event) => guardedNavigation(event, `/campanas/${campaignId}`)}
            className="block rounded-sm bg-gold px-3 py-2 text-center font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
          >
            Abrir la mesa de juego →
          </Link>
          <Link
            to="/"
            onClick={(event) => guardedNavigation(event, '/')}
            className="mt-2 block text-center text-xs text-bone/50 hover:text-bone"
          >
            ← Volver al hub
          </Link>
        </div>
      </aside>

      {/* Panel del paso activo */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet context={progress} />
      </main>

      {/* Acceso a la mesa en móvil */}
      <div className="flex items-center justify-between gap-2 border-t border-gold/20 bg-night-900 px-3 py-2 lg:hidden">
        <Link
          to="/"
          onClick={(event) => guardedNavigation(event, '/')}
          className="text-xs text-bone/50"
        >
          ← Hub
        </Link>
        <Link
          to={`/campanas/${campaignId}`}
          onClick={(event) => guardedNavigation(event, `/campanas/${campaignId}`)}
          className="rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950"
        >
          Abrir la mesa →
        </Link>
      </div>
    </div>
  );
}
