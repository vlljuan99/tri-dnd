import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { abilityModifier, estimateHitPoints } from '../lib/dnd.js';
import { applyRacialBonuses, mergeAutomaticSkills, raceAutomaticSkills } from '../lib/wizard.js';
import { srdCampaignPath } from '../lib/srdCampaign.js';
import WizardProgress from '../components/wizard/WizardProgress.jsx';
import WizardPreview from '../components/wizard/WizardPreview.jsx';
import StepIdentidad, { validateIdentidad } from '../components/wizard/StepIdentidad.jsx';
import StepClase, { validateClase } from '../components/wizard/StepClase.jsx';
import StepRaza, { validateRaza } from '../components/wizard/StepRaza.jsx';
import StepCaracteristicas, { validateCaracteristicas } from '../components/wizard/StepCaracteristicas.jsx';
import StepCompetencias, { validateCompetencias } from '../components/wizard/StepCompetencias.jsx';
import StepResumen from '../components/wizard/StepResumen.jsx';

const STEPS = [
  { id: 'identidad', label: 'Identidad', Component: StepIdentidad, validate: (char) => validateIdentidad(char) },
  { id: 'clase', label: 'Clase', Component: StepClase, validate: (char) => validateClase(char) },
  { id: 'raza', label: 'Raza o especie', Component: StepRaza, validate: (char) => validateRaza(char) },
  {
    id: 'caracteristicas',
    label: 'Características',
    Component: StepCaracteristicas,
    validate: (char) => validateCaracteristicas(char),
  },
  {
    id: 'competencias',
    label: 'Competencias',
    Component: StepCompetencias,
    validate: (char, ctx) => validateCompetencias(char, ctx.classDetail),
  },
  { id: 'resumen', label: 'Resumen y confirmación', Component: StepResumen, validate: () => ({}) },
];

export default function CharacterWizardPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [char, setChar] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error
  const [classes, setClasses] = useState([]);
  const [races, setRaces] = useState([]);
  const [classDetails, setClassDetails] = useState({});
  const [raceDetails, setRaceDetails] = useState({});
  const [campaigns, setCampaigns] = useState([]);
  const [step, setStep] = useState(0);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [stepErrors, setStepErrors] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [error, setError] = useState('');

  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const stepHeadingRef = useRef(null);

  // Carga inicial: el personaje (con su progreso guardado) y sus campañas.
  // El compendio se carga después con el contexto de la campaña seleccionada.
  useEffect(() => {
    api(`/characters/${id}`)
      .then(({ character, editable }) => {
        if (!editable) {
          setError('Este personaje no es tuyo.');
          return;
        }
        if (character.status === 'complete') {
          navigate(`/personajes/${id}`, { replace: true });
          return;
        }
        setChar(character);
        setStep(Math.min(character.wizard_step ?? 0, STEPS.length - 1));
        setMaxStepReached(Math.min(character.wizard_step ?? 0, STEPS.length - 1));
      })
      .catch((e) => setError(e.message));
    api('/campaigns').then(({ campaigns }) => setCampaigns(campaigns)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Las clases y razas del DM solo se comparten dentro de una campaña de la
  // que el jugador sea miembro. Al cambiar la campaña en Identidad se recarga
  // el selector; sin campaña, el usuario conserva su propia Biblioteca.
  useEffect(() => {
    if (!char) return undefined;
    let cancelled = false;
    const campaignId = char.campaign_id;

    async function loadChoices(category, setEntries, setDetails) {
      const { results } = await api(srdCampaignPath(category, campaignId));
      const details = await Promise.all(
        results.map((entry) => api(srdCampaignPath(category, campaignId, entry.index)))
      );
      if (cancelled) return;
      setEntries(results);
      setDetails(Object.fromEntries(details.map((detail) => [detail.index, detail.data])));
    }

    setClasses([]);
    setRaces([]);
    Promise.all([
      loadChoices('classes', setClasses, setClassDetails),
      loadChoices('races', setRaces, setRaceDetails),
    ]).catch((e) => {
      if (!cancelled) setError(e.message);
    });

    return () => {
      cancelled = true;
    };
  }, [char?.campaign_id]);

  const flush = useCallback(async () => {
    const body = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(body).length === 0) return;
    setSaveState('saving');
    try {
      await api(`/characters/${id}`, { method: 'PUT', body });
      setSaveState('saved');
    } catch {
      setSaveState('error');
      Object.assign(pendingRef.current, body);
    }
  }, [id]);

  const patch = useCallback(
    (fields) => {
      setChar((c) => (c ? { ...c, ...fields } : c));
      Object.assign(pendingRef.current, fields);
      setSaveState('pending');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 800);
    },
    [flush]
  );

  async function flushNow() {
    clearTimeout(timerRef.current);
    await flush();
  }

  // Guarda cualquier cambio pendiente si el usuario cierra o abandona la pestaña
  useEffect(() => {
    function onBeforeUnload() {
      if (Object.keys(pendingRef.current).length > 0) {
        navigator.sendBeacon?.(`/api/characters/${id}`, JSON.stringify(pendingRef.current));
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

  // Foco accesible al cambiar de paso
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  // Competencias de salvación: siempre las fija la clase (no hay elección en 5e)
  useEffect(() => {
    if (!char?.class_index) return;
    const detail = classDetails[char.class_index];
    if (!detail) return;
    const saves = detail.saving_throws.map((s) => s.index);
    if (JSON.stringify(saves) !== JSON.stringify(char.save_proficiencies)) {
      patch({ save_proficiencies: saves });
    }
  }, [char?.class_index, char?.save_proficiencies, classDetails, patch]);

  // Velocidad: siempre la fija la raza elegida
  useEffect(() => {
    if (!char?.race_index) return;
    const detail = raceDetails[char.race_index];
    const speed = detail?.speed ?? 30;
    if (detail && char.speed !== speed) patch({ speed });
  }, [char?.race_index, char?.speed, raceDetails, patch]);

  // Características finales = base elegida en el paso 4 + bonificadores raciales
  useEffect(() => {
    const base = char?.wizard_data?.baseAbilities;
    if (!char || !base) return;
    const raceDetail = char.race_index ? raceDetails[char.race_index] : null;
    const computed = raceDetail
      ? applyRacialBonuses(base, raceDetail, char.wizard_data.raceAbilityChoice ?? [])
      : base;
    if (JSON.stringify(computed) !== JSON.stringify(char.abilities)) {
      patch({ abilities: computed });
    }
  }, [char?.wizard_data?.baseAbilities, char?.wizard_data?.raceAbilityChoice, char?.race_index, raceDetails, patch]);

  useEffect(() => {
    if (!char?.race_index) return;
    const detail = raceDetails[char.race_index];
    if (!detail) return;
    const previous = char.wizard_data.appliedRaceSkillProficiencies ?? [];
    const next = raceAutomaticSkills(detail);
    const merged = mergeAutomaticSkills(char.skill_proficiencies, previous, next);
    if (JSON.stringify(merged) === JSON.stringify(char.skill_proficiencies) && JSON.stringify(previous) === JSON.stringify(next)) {
      return;
    }
    patch({
      skill_proficiencies: merged,
      wizard_data: { ...char.wizard_data, appliedRaceSkillProficiencies: next },
    });
  }, [char?.race_index, char?.skill_proficiencies, char?.wizard_data, raceDetails, patch]);

  const classDetail = char?.class_index ? classDetails[char.class_index] : null;
  const raceDetail = char?.race_index ? raceDetails[char.race_index] : null;
  const raceName = char?.race_index ? races.find((r) => r.index === char.race_index)?.name : null;
  const classDisplayName = char?.class_index ? classes.find((c) => c.index === char.class_index)?.name : null;

  const stepStatuses = useMemo(() => {
    if (!char) return STEPS.map(() => 'locked');
    return STEPS.map((s, i) => {
      if (i > maxStepReached) return 'locked';
      if (i === step) return 'current';
      const errs = s.validate(char, { classDetail });
      return Object.keys(errs).length > 0 ? 'error' : 'done';
    });
  }, [char, maxStepReached, step, classDetail]);

  function goNext() {
    const errs = STEPS[step].validate(char, { classDetail });
    setStepErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
    setStepErrors({});
    patch({ wizard_step: next });
    flushNow();
  }

  function goBack() {
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    setStepErrors({});
    patch({ wizard_step: prev });
    flushNow();
  }

  function jumpTo(i) {
    if (i > maxStepReached) return;
    setStep(i);
    setStepErrors({});
    patch({ wizard_step: i });
    flushNow();
  }

  async function saveAndExit() {
    await flushNow();
    navigate('/personajes');
  }

  async function discardDraft() {
    if (!window.confirm('¿Descartar este borrador? Se perderá todo el progreso.')) return;
    await api(`/characters/${id}`, { method: 'DELETE' });
    navigate('/personajes');
  }

  async function finish() {
    setFinishError('');
    setFinishing(true);
    try {
      await flushNow();
      const conMod = abilityModifier(char.abilities.con);
      const dexMod = abilityModifier(char.abilities.dex);
      const hpMax = Math.max(1, estimateHitPoints(classDetail?.hit_die ?? 8, conMod, char.level));
      const ac = 10 + dexMod;
      await api(`/characters/${id}`, {
        method: 'PUT',
        body: { hp_max: hpMax, hp_current: hpMax, ac, status: 'complete' },
      });
      localStorage.removeItem('tridnd_sheet_tutorial_seen');
      navigate(`/personajes/${id}?tutorial=1`);
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
        <Link to="/personajes" className="text-gold underline">Volver a personajes</Link>
      </div>
    );
  }
  if (!char) {
    return <div className="min-h-full bg-night-950 p-6 text-bone/60">Cargando asistente…</div>;
  }

  const saveLabels = { saved: 'Guardado ✓', pending: 'Cambios sin guardar…', saving: 'Guardando…', error: 'Error al guardar' };
  const { Component } = STEPS[step];
  const steps = STEPS.map((s, i) => ({ id: s.id, label: s.label, status: stepStatuses[i] }));

  return (
    <div className="min-h-full bg-night-950 text-bone">
      <div className="mx-auto grid max-w-5xl gap-4 p-4 pb-28 sm:grid-cols-[220px_1fr] sm:pb-6 lg:grid-cols-[220px_1fr_260px]">
        {/* Cabecera móvil */}
        <div className="flex items-center justify-between sm:hidden">
          <button onClick={discardDraft} className="text-sm text-bone/50 hover:text-blood">Cancelar</button>
          <span className={`text-xs ${saveState === 'error' ? 'text-blood' : 'text-bone/50'}`}>{saveLabels[saveState]}</span>
        </div>

        {/* Progreso */}
        <aside className="sm:sticky sm:top-4 sm:self-start">
          <WizardProgress steps={steps} current={step} onJump={jumpTo} />
        </aside>

        {/* Paso actual */}
        <main
          ref={stepHeadingRef}
          tabIndex={-1}
          className="rounded-md border border-gold/15 bg-night-900 p-4 focus:outline-none"
        >
          <Component
            char={char}
            patch={patch}
            errors={stepErrors}
            classes={classes}
            classDetails={classDetails}
            classDetail={classDetail}
            classDisplayName={classDisplayName}
            races={races}
            raceDetails={raceDetails}
            raceDetail={raceDetail}
            raceName={raceName}
            campaigns={campaigns}
            onFinish={finish}
            finishing={finishing}
            finishError={finishError}
          />

          <div className="mt-6 hidden items-center justify-between border-t border-bone/10 pt-4 sm:flex">
            <div className="flex gap-2">
              <button onClick={discardDraft} className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm text-bone/60 hover:border-blood hover:text-blood">
                Cancelar
              </button>
              <button onClick={saveAndExit} className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm hover:bg-bone/10">
                Guardar y salir
              </button>
            </div>
            <span className={`text-xs ${saveState === 'error' ? 'text-blood' : 'text-bone/50'}`}>{saveLabels[saveState]}</span>
            <div className="flex gap-2">
              <button
                onClick={goBack}
                disabled={step === 0}
                className="rounded-sm border border-bone/30 px-4 py-1.5 text-sm hover:bg-bone/10 disabled:opacity-30"
              >
                ← Atrás
              </button>
              {step < STEPS.length - 1 && (
                <button onClick={goNext} className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90">
                  Continuar →
                </button>
              )}
            </div>
          </div>
        </main>

        {/* Vista previa — panel fijo en escritorio */}
        <aside className="hidden rounded-md border border-gold/15 bg-night-900 p-4 lg:block">
          <p className="mb-3 font-display text-sm tracking-wide text-gold">Vista previa</p>
          <WizardPreview char={char} classDisplayName={classDisplayName} raceName={raceName} classDetail={classDetail} />
        </aside>
      </div>

      {/* Navegación fija en móvil */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-gold/20 bg-night-900 p-3 sm:hidden">
        <button
          onClick={goBack}
          disabled={step === 0}
          aria-label="Paso anterior"
          className="rounded-sm border border-bone/30 px-3 py-2 text-sm disabled:opacity-30"
        >
          ← Atrás
        </button>
        <button onClick={() => setPreviewOpen(true)} className="rounded-sm border border-bone/20 px-3 py-2 text-sm text-bone/70">
          Vista previa
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={goNext} className="flex-1 rounded-sm bg-gold px-4 py-2 font-display text-sm tracking-wide text-night-950">
            Continuar
          </button>
        ) : (
          <button onClick={saveAndExit} className="flex-1 rounded-sm border border-bone/30 px-4 py-2 text-sm">
            Guardar y salir
          </button>
        )}
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60 sm:hidden" onClick={() => setPreviewOpen(false)}>
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-lg border border-gold/25 bg-night-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-sm tracking-wide text-gold">Vista previa</p>
              <button onClick={() => setPreviewOpen(false)} aria-label="Cerrar vista previa" className="px-2 text-bone/60 hover:text-bone">✕</button>
            </div>
            <WizardPreview char={char} classDisplayName={classDisplayName} raceName={raceName} classDetail={classDetail} />
          </div>
        </div>
      )}
    </div>
  );
}
