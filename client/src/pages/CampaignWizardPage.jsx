import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import WizardProgress from '../components/wizard/WizardProgress.jsx';
import StepConcepto, { validateConcepto } from '../components/campaign-wizard/StepIdentidad.jsx';
import StepEstructura, { validateEstructura } from '../components/campaign-wizard/StepEstructura.jsx';
import StepPresentacion, { validatePresentacion } from '../components/campaign-wizard/StepLore.jsx';
import StepResumen from '../components/campaign-wizard/StepResumen.jsx';

function campaignTypeOf(campaign) {
  if (!campaign) return 'campana';
  return campaign.campaignType ?? (campaign.hasWorldMap ? 'campana' : 'escaramuza');
}

const STEPS = [
  { id: 'concepto', label: 'Concepto', Component: StepConcepto, validate: validateConcepto },
  { id: 'estructura', label: 'Estructura del archivo', Component: StepEstructura, validate: validateEstructura },
  {
    id: 'presentacion',
    label: 'Presentación al grupo',
    Component: StepPresentacion,
    validate: validatePresentacion,
  },
  { id: 'resumen', label: 'Abrir el estudio', Component: StepResumen, validate: () => ({}) },
];

export default function CampaignWizardPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error
  const [step, setStep] = useState(0);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [stepErrors, setStepErrors] = useState({});
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [error, setError] = useState('');

  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const stepHeadingRef = useRef(null);

  useEffect(() => {
    api(`/campaigns/${id}`)
      .then(async ({ campaign: loaded }) => {
        if (loaded.role !== 'dm') {
          setError('Solo el DM puede preparar esta campaña.');
          return;
        }
        const loadedType = campaignTypeOf(loaded);
        // Las escaramuzas nuevas ya nacen completas y van directas al editor.
        // Este caso solo cubre enlaces o borradores antiguos sin recuperar un
        // asistente que ya no forma parte de su flujo rápido.
        if (loadedType === 'escaramuza') {
          if (loaded.status !== 'complete') {
            await api(`/campaigns/${id}`, { method: 'PATCH', body: { status: 'complete' } });
          }
          navigate(`/campanas/${id}/editor`, { replace: true });
          return;
        }
        if (loaded.status === 'complete') {
          navigate(`/campanas/${id}/archivo`, { replace: true });
          return;
        }
        setCampaign(loaded);
        const savedStep = Math.min(loaded.wizardStep ?? 0, STEPS.length - 1);
        setStep(savedStep);
        setMaxStepReached(savedStep);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const flush = useCallback(async ({ throwOnError = false } = {}) => {
    const body = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(body).length === 0) return;
    setSaveState('saving');
    try {
      await api(`/campaigns/${id}`, { method: 'PATCH', body });
      setSaveState('saved');
    } catch (saveError) {
      setSaveState('error');
      Object.assign(pendingRef.current, body);
      if (throwOnError) throw saveError;
    }
  }, [id]);

  const patch = useCallback(
    (fields) => {
      setCampaign((current) => (current ? { ...current, ...fields } : current));
      Object.assign(pendingRef.current, fields);
      setSaveState('pending');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 800);
    },
    [flush]
  );

  async function flushNow(throwOnError = false) {
    clearTimeout(timerRef.current);
    await flush({ throwOnError });
  }

  useEffect(() => {
    function onBeforeUnload() {
      if (Object.keys(pendingRef.current).length > 0) {
        navigator.sendBeacon?.(`/api/campaigns/${id}`, JSON.stringify(pendingRef.current));
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(timerRef.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  const stepStatuses = useMemo(() => {
    if (!campaign) return STEPS.map(() => 'locked');
    return STEPS.map((currentStep, index) => {
      if (index > maxStepReached) return 'locked';
      if (index === step) return 'current';
      const errs = currentStep.validate(campaign);
      return Object.keys(errs).length > 0 ? 'error' : 'done';
    });
  }, [campaign, maxStepReached, step, STEPS]);

  function goNext() {
    const errs = STEPS[step].validate(campaign);
    setStepErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setMaxStepReached((current) => Math.max(current, next));
    setStepErrors({});
    patch({ wizardStep: next });
    flushNow();
  }

  function goBack() {
    const previous = Math.max(step - 1, 0);
    setStep(previous);
    setStepErrors({});
    patch({ wizardStep: previous });
    flushNow();
  }

  function jumpTo(index) {
    if (index > maxStepReached) return;
    setStep(index);
    setStepErrors({});
    patch({ wizardStep: index });
    flushNow();
  }

  async function saveAndExit() {
    await flushNow();
    navigate('/');
  }

  async function discardDraft() {
    if (!window.confirm('¿Descartar esta campaña? Se perderá todo el progreso.')) return;
    await api(`/campaigns/${id}`, { method: 'DELETE' });
    navigate('/');
  }

  async function finish() {
    setFinishError('');
    setFinishing(true);
    try {
      await flushNow(true);
      await api(`/campaigns/${id}`, { method: 'PATCH', body: { status: 'complete' } });
      navigate(`/campanas/${id}/archivo`);
    } catch (e) {
      setFinishError(e.message);
    } finally {
      setFinishing(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-full bg-night-950 p-6 text-bone">
        <p className="text-blood">{error}</p>
        <Link to="/" className="text-gold underline">
          Volver al hub
        </Link>
      </div>
    );
  }
  if (!campaign) {
    return <div className="min-h-full bg-night-950 p-6 text-bone/60">Cargando asistente…</div>;
  }

  const saveLabels = {
    saved: 'Guardado ✓',
    pending: 'Cambios sin guardar…',
    saving: 'Guardando…',
    error: 'Error al guardar',
  };
  const { Component } = STEPS[step];
  const progressSteps = STEPS.map((currentStep, index) => ({
    id: currentStep.id,
    label: currentStep.label,
    status: stepStatuses[index],
  }));

  return (
    <div className="min-h-full bg-night-950 text-bone">
      <div className="mx-auto grid max-w-4xl gap-4 p-4 pb-28 sm:grid-cols-[230px_1fr] sm:pb-6">
        <div className="flex items-center justify-between sm:hidden">
          <button onClick={discardDraft} className="text-sm text-bone/50 hover:text-blood">
            Cancelar
          </button>
          <span className={`text-xs ${saveState === 'error' ? 'text-blood' : 'text-bone/50'}`}>
            {saveLabels[saveState]}
          </span>
        </div>

        <aside className="sm:sticky sm:top-4 sm:self-start">
          <div className="mb-3 hidden rounded-sm border border-gold/15 bg-night-900/70 p-3 sm:block">
            <p className="font-display text-sm tracking-wide text-gold">Crear campaña</p>
            <p className="mt-1 text-xs leading-relaxed text-bone/45">
              La base de tu archivo y estudio como DM.
            </p>
          </div>
          <WizardProgress steps={progressSteps} current={step} onJump={jumpTo} />
        </aside>

        <main
          ref={stepHeadingRef}
          tabIndex={-1}
          className="rounded-md border border-gold/15 bg-night-900 p-5 focus:outline-none"
        >
          <Component
            campaign={campaign}
            patch={patch}
            errors={stepErrors}
            onFinish={finish}
            finishing={finishing}
            finishError={finishError}
          />

          <div className="mt-6 hidden items-center justify-between border-t border-bone/10 pt-4 sm:flex">
            <div className="flex gap-2">
              <button
                onClick={discardDraft}
                className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm text-bone/60 hover:border-blood hover:text-blood"
              >
                Cancelar
              </button>
              <button
                onClick={saveAndExit}
                className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm hover:bg-bone/10"
              >
                Guardar y salir
              </button>
            </div>
            <span className={`text-xs ${saveState === 'error' ? 'text-blood' : 'text-bone/50'}`}>
              {saveLabels[saveState]}
            </span>
            <div className="flex gap-2">
              <button
                onClick={goBack}
                disabled={step === 0}
                className="rounded-sm border border-bone/30 px-4 py-1.5 text-sm hover:bg-bone/10 disabled:opacity-30"
              >
                ← Atrás
              </button>
              {step < STEPS.length - 1 && (
                <button
                  onClick={goNext}
                  className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
                >
                  Continuar →
                </button>
              )}
            </div>
          </div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-gold/20 bg-night-900 p-3 sm:hidden">
        <button
          onClick={goBack}
          disabled={step === 0}
          aria-label="Paso anterior"
          className="rounded-sm border border-bone/30 px-3 py-2 text-sm disabled:opacity-30"
        >
          ← Atrás
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={goNext}
            className="flex-1 rounded-sm bg-gold px-4 py-2 font-display text-sm tracking-wide text-night-950"
          >
            Continuar
          </button>
        ) : (
          <button onClick={saveAndExit} className="flex-1 rounded-sm border border-bone/30 px-4 py-2 text-sm">
            Guardar y salir
          </button>
        )}
      </div>
    </div>
  );
}
