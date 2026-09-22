import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { api } from '../api.js';
import { abilityModifier, estimateHitPoints } from '../lib/dnd.js';
import { applyRacialBonuses, mergeAutomaticSkills, raceAutomaticSkills, restoreWizardDraft, randomBuild, parseStartingEquipment } from '../lib/wizard.js';
import { deriveWizardPreview, wizardPreviewDeltas, previewCharacter, buildWizardEquipment } from '../lib/wizardPreview.js';
import { srdCampaignPath } from '../lib/srdCampaign.js';
import WizardProgress from '../components/wizard/WizardProgress.jsx';
import WizardPreview from '../components/wizard/WizardPreview.jsx';
import StepIdentidad, { validateIdentidad } from '../components/wizard/StepIdentidad.jsx';
import StepClase, { validateClase } from '../components/wizard/StepClase.jsx';
import StepRaza, { validateRaza } from '../components/wizard/StepRaza.jsx';
import StepCaracteristicas, { validateCaracteristicas } from '../components/wizard/StepCaracteristicas.jsx';
import StepCompetencias, { validateCompetencias } from '../components/wizard/StepCompetencias.jsx';
import StepEquipo, { validateEquipo } from '../components/wizard/StepEquipo.jsx';
import StepResumen from '../components/wizard/StepResumen.jsx';
import StepCampana from '../components/wizard/StepCampana.jsx';
import '../components/wizard/wizard.css';

const STEPS = [
  { id: 'campana', label: 'Campaña', title: 'Elige tu mundo', Component: StepCampana, validate: () => ({}) },
  { id: 'raza', label: 'Especie', title: 'Tus orígenes', Component: StepRaza, validate: (char, ctx) => validateRaza(char, ctx.raceDetail) },
  { id: 'clase', label: 'Clase', title: 'Encuentra tu vocación', Component: StepClase, validate: (char, ctx) => validateClase(char, ctx.classDetail) },
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
  {
    id: 'equipo',
    label: 'Equipo',
    Component: StepEquipo,
    validate: (char, ctx) => validateEquipo(char, ctx.classDetail),
  },
  // G2 insertará Apariencia entre equipo e identidad; no existe aún en este recorrido.
  { id: 'identidad', label: 'Identidad', title: 'Ponle nombre a tu leyenda', Component: StepIdentidad, validate: validateIdentidad },
  { id: 'resumen', label: 'Resumen', title: 'Tu aventura empieza aquí', Component: StepResumen, validate: () => ({}) },
];

export default function CharacterWizardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

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
  const [preview, setPreview] = useState(null);
  const [randomBusy, setRandomBusy] = useState(false);
  const [randomError, setRandomError] = useState('');
  const [randomNotice, setRandomNotice] = useState('');
  const [choicesLoading, setChoicesLoading] = useState(true);

  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const stepHeadingRef = useRef(null);
  const savingRef = useRef(null);
  const previewButtonRef = useRef(null);
  const closePreviewRef = useRef(null);
  const previewDrawerRef = useRef(null);

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
        const restored = restoreWizardDraft(character);
        setChar({ ...restored, name: restored.wizard_data.identityName ?? restored.name });
        setStep(restored.wizard_step);
        setMaxStepReached(restored.wizard_step);
        // La versión del recorrido se guarda con el siguiente cambio, sin migrar SQLite.
        pendingRef.current = { wizard_data: restored.wizard_data, wizard_step: restored.wizard_step };
      })
      .catch((e) => setError(e.message));
    api('/campaigns').then(({ campaigns }) => setCampaigns(campaigns)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Las clases y razas del DM solo se comparten dentro de una campaña de la
  // que el jugador sea miembro. Al cambiar la campaña se recarga
  // el selector; sin campaña, el usuario conserva su propia Biblioteca.
  useEffect(() => {
    if (!char) return undefined;
    let cancelled = false;
    const campaignId = char.campaign_id;
    setChoicesLoading(true);

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
    setClassDetails({});
    setRaceDetails({});
    Promise.all([
      loadChoices('classes', setClasses, setClassDetails),
      loadChoices('races', setRaces, setRaceDetails),
    ]).then(() => { if (!cancelled) setChoicesLoading(false); }).catch((e) => {
      if (!cancelled) setError(e.message);
    });

    return () => {
      cancelled = true;
    };
  }, [char?.campaign_id]);

  const flush = useCallback(async () => {
    // Serializa los PUT: una respuesta antigua nunca pisa el siguiente guardado.
    while (savingRef.current) await savingRef.current;
    const body = { ...pendingRef.current };
    // El nombre puede permanecer vacío mientras se edita. La API histórica
    // exige uno en cada PUT que incluya el campo: se envía al ser válido.
    if ('name' in body && (!body.name.trim() || body.name.length > 60)) delete body.name;
    pendingRef.current = {};
    if (Object.keys(body).length === 0) return true;
    setSaveState('saving');
    const request = (async () => { try {
      const { character } = await api(`/characters/${id}`, { method: 'PUT', body });
      // El servidor manda en los campos derivados (nivel inicial de la
      // campaña, competencias, CA): se recogen tal cual vuelven en vez de
      // dejar el borrador local diciendo otra cosa.
      setChar((current) =>
        current ? { ...current, level: character.level, ac: character.ac } : current
      );
      setSaveState(Object.keys(pendingRef.current).length ? 'pending' : 'saved');
      return true;
    } catch {
      setSaveState('error');
      pendingRef.current = { ...body, ...pendingRef.current };
      return false;
    } })();
    savingRef.current = request;
    const result = await request;
    if (savingRef.current === request) savingRef.current = null;
    return result;
  }, [id]);

  const patch = useCallback(
    (fields) => {
      setChar((c) => (c ? { ...c, ...fields } : c));
      setStepErrors({});
      if ('campaign_id' in fields) setChoicesLoading(true);
      Object.assign(pendingRef.current, fields);
      setSaveState('pending');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 800);
    },
    [flush]
  );

  async function flushNow() {
    clearTimeout(timerRef.current);
    return flush();
  }

  // Guarda cualquier cambio pendiente si el usuario cierra o abandona la pestaña
  useEffect(() => {
    function onBeforeUnload() {
      if (Object.keys(pendingRef.current).length > 0) {
        const body = { ...pendingRef.current };
        if ('name' in body && (!body.name.trim() || body.name.length > 60)) delete body.name;
        fetch(`/api/characters/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), credentials: 'same-origin', keepalive: true }).catch(() => {});
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
    setPreview(null);
    stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!previewOpen) return undefined;
    closePreviewRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') { setPreviewOpen(false); previewButtonRef.current?.focus(); }
      if (event.key === 'Tab') {
        const focusable = [...(previewDrawerRef.current?.querySelectorAll('button, summary, [tabindex="0"]') ?? [])]
          .filter(element => element.getClientRects().length);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  // Competencias de salvación: siempre las fija la clase (no hay elección en 5e)
  useEffect(() => {
    if (!char?.class_index) return;
    const detail = classDetails[char.class_index];
    if (!detail) return;
    const saves = (detail.saving_throws ?? []).map((s) => s.index);
    if (JSON.stringify(saves) !== JSON.stringify(char.save_proficiencies)) {
      patch({ save_proficiencies: saves });
    }
  }, [char?.class_index, char?.save_proficiencies, classDetails, patch]);

  // Competencia real de armas/armaduras (Fase B): siempre la fija la clase,
  // resuelta por el servidor al cargar su detalle (weapon_proficiencies_resolved).
  useEffect(() => {
    if (!char?.class_index) return;
    const detail = classDetails[char.class_index];
    if (!detail) return;
    const weaponProf = detail.weapon_proficiencies_resolved ?? [];
    const armorProf = detail.armor_proficiencies_resolved ?? [];
    if (
      JSON.stringify(weaponProf) !== JSON.stringify(char.weapon_proficiencies) ||
      JSON.stringify(armorProf) !== JSON.stringify(char.armor_proficiencies)
    ) {
      patch({ weapon_proficiencies: weaponProf, armor_proficiencies: armorProf });
    }
  }, [char?.class_index, char?.weapon_proficiencies, char?.armor_proficiencies, classDetails, patch]);

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

  const classDetail = char?.class_index ? classDetails[char.class_index] ?? null : null;
  const raceDetail = char?.race_index ? raceDetails[char.race_index] ?? null : null;
  const raceName = char?.race_index ? races.find((r) => r.index === char.race_index)?.name : null;
  const classDisplayName = char?.class_index ? classes.find((c) => c.index === char.class_index)?.name : null;

  const stepStatuses = useMemo(() => {
    if (!char) return STEPS.map(() => 'locked');
    return STEPS.map((s, i) => {
      if (i > maxStepReached) return 'locked';
      if (i === step) return 'current';
      const errs = s.validate(char, { classDetail, raceDetail });
      return Object.keys(errs).length > 0 ? 'error' : 'done';
    });
  }, [char, maxStepReached, step, classDetail, raceDetail]);

  function goNext() {
    if (choicesLoading || randomBusy) return;
    const errs = STEPS[step].validate(char, { classDetail, raceDetail });
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
    if (i > maxStepReached || randomBusy || choicesLoading) return;
    setStep(i);
    setStepErrors({});
    patch({ wizard_step: i });
    flushNow();
  }

  async function saveAndExit() {
    if (await flushNow()) navigate('/personajes');
  }

  async function discardDraft() {
    if (!window.confirm('¿Descartar este borrador? Se perderá todo el progreso.')) return;
    clearTimeout(timerRef.current);
    if (savingRef.current) await savingRef.current;
    pendingRef.current = {};
    await api(`/characters/${id}`, { method: 'DELETE' });
    navigate('/personajes');
  }

  async function finish() {
    setFinishError('');
    setFinishing(true);
    try {
      if (choicesLoading || randomBusy) throw new Error('Espera a que terminen de cargarse las opciones.');
      const invalidStep = STEPS.findIndex((s) => Object.keys(s.validate(char, { classDetail, raceDetail })).length > 0);
      if (invalidStep >= 0) { setStep(invalidStep); setStepErrors(STEPS[invalidStep].validate(char, { classDetail, raceDetail })); return; }
      if (!await flushNow()) throw new Error('No se pudieron guardar los cambios. Reintenta antes de finalizar.');
      const conMod = abilityModifier(char.abilities.con);
      const hpMax = Math.max(1, estimateHitPoints(classDetail?.hit_die ?? 8, conMod, char.level));
      // La CA la deriva el servidor a partir del inventario (ya aplicada en el
      // paso de Equipo); aquí solo se cierran PG y estado.
      await api(`/characters/${id}`, {
        method: 'PUT',
        body: { hp_max: hpMax, hp_current: hpMax, status: 'complete' },
      });
      localStorage.removeItem('tridnd_sheet_tutorial_seen');
      navigate(`/personajes/${id}?tutorial=1`);
    } catch (e) {
      setFinishError(e.message);
    } finally {
      setFinishing(false);
    }
  }

  async function randomize() {
    setRandomBusy(true);
    setRandomError('');
    try {
      const indexes = [...new Set(Object.values(classDetails).flatMap(detail => parseStartingEquipment(detail).groups
        .flatMap(group => group.options.flatMap(option => option.categorySlots.map(slot => slot.categoryIndex)))))];
      const entries = await Promise.all(indexes.map(index => api(srdCampaignPath('equipment-categories', char.campaign_id, index))));
      const categoryMembers = Object.fromEntries(entries.map((entry, i) => [indexes[i], entry.data?.equipment ?? []]));
      const fields = randomBuild({ char, classDetails, raceDetails, categoryMembers });
      const { fixed, groups } = parseStartingEquipment(classDetails[fields.class_index]);
      const itemIndexes = new Set(fixed.map(item => item.index));
      groups.forEach(group => {
        const choice = group.options.find(option => option.key === fields.wizard_data.equipmentGroupChoice[group.key]);
        choice?.fixedGrants.forEach(item => itemIndexes.add(item.index));
        choice?.categorySlots.forEach(slot => (fields.wizard_data.equipmentCategoryPicks[slot.pathKey] ?? []).forEach(index => itemIndexes.add(index)));
      });
      const items = await Promise.all([...itemIndexes].map(index => api(srdCampaignPath('equipment', char.campaign_id, index))));
      const built = buildWizardEquipment({ fixed, groups, groupChoice: fields.wizard_data.equipmentGroupChoice,
        categoryPicks: fields.wizard_data.equipmentCategoryPicks, categoryMembers, itemsByIndex: Object.fromEntries(items.map(item => [item.index, item])) });
      fields.inventory = built.inventory;
      fields.wizard_data.appliedEquipmentSignature = built.signature;
      patch(fields);
      setPreview(null);
      setMaxStepReached((value) => Math.max(value, 6));
      setRandomNotice('Destino elegido. Revisa tus opciones; solo falta darle tu nombre.');
    } catch (e) { setRandomError(e.message); }
    finally { setRandomBusy(false); }
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

  const saveLabels = { saved: 'Guardado', pending: 'Cambios pendientes…', saving: 'Guardando…', error: 'Error al guardar · reintentar' };
  const { Component, title, label } = STEPS[step];
  const steps = STEPS.map((s, i) => ({ id: s.id, label: s.label, status: stepStatuses[i] }));
  const anticipatedCharacter = preview?.fields ? previewCharacter(char, preview.fields) : char;
  const previewClassName = anticipatedCharacter.class_index
    ? classes.find((entry) => entry.index === anticipatedCharacter.class_index)?.name ?? anticipatedCharacter.class_index
    : null;
  const previewRaceName = anticipatedCharacter.race_index
    ? races.find((entry) => entry.index === anticipatedCharacter.race_index)?.name ?? anticipatedCharacter.race_index
    : null;
  const previewProps = { char, classDisplayName: previewClassName, raceName: previewRaceName,
    classDetail, raceDetail, classDetails, raceDetails, preview, buildStage: maxStepReached };
  const stats = deriveWizardPreview(char, { classDetail, raceDetail, classDetails, raceDetails });
  const changes = preview?.fields ? wizardPreviewDeltas(stats, deriveWizardPreview(previewCharacter(char, preview.fields), { classDetail, raceDetail, classDetails, raceDetails })) : [];

  return (
    <div className="character-creator min-h-full text-bone">
      <header className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 border-b border-gold/15 px-4 py-5 sm:px-8">
        <div><p className="text-[10px] uppercase tracking-[.3em] text-gold/70">TriDnD · D&D 5e 2014</p>
          <h1 className="mt-1 font-display text-lg tracking-wide text-bone sm:text-2xl">Forja tu leyenda</h1></div>
        <div className="flex items-center gap-3">
          <button onClick={flushNow} className={`text-xs ${saveState === 'error' ? 'text-red-300' : 'text-bone/40'}`} aria-live="polite">{saveLabels[saveState]}</button>
          <button onClick={saveAndExit} disabled={randomBusy || finishing} className="rounded border border-bone/20 px-3 py-2 text-xs text-bone/70 hover:border-gold disabled:opacity-40">Guardar y salir</button>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] items-start gap-5 px-4 py-5 pb-36 sm:px-8 lg:grid-cols-[175px_minmax(0,1fr)_290px] lg:gap-7 lg:pb-8 xl:grid-cols-[190px_minmax(0,1fr)_320px]">
        <aside className="min-w-0 lg:sticky lg:top-5">
          <WizardProgress steps={steps} current={step} onJump={jumpTo} />
          <button onClick={discardDraft} className="mt-8 hidden text-xs text-bone/35 hover:text-red-300 lg:block">Descartar borrador</button>
        </aside>
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] uppercase tracking-[.25em] text-gold/70">Capítulo {String(step + 1).padStart(2, '0')} · {label}</p>
              <h2 ref={stepHeadingRef} tabIndex={-1} className="mt-2 font-display text-2xl text-bone outline-none sm:text-3xl">{title ?? label}</h2></div>
            <button onClick={randomize} disabled={randomBusy || finishing || choicesLoading || !classes.length || !races.length}
              className="rounded-md border border-gold/35 bg-gold/5 px-3 py-2 text-xs text-gold hover:bg-gold/15 disabled:opacity-40">⚄ {randomBusy ? 'El destino decide…' : 'Personaje aleatorio'}</button>
          </div>
          {randomError && <p role="alert" className="mb-4 text-sm text-red-300">{randomError}</p>}
          {randomNotice && <p role="status" className="mb-4 text-sm text-teal-200">{randomNotice}</p>}
          <motion.div key={STEPS[step].id} initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.22 }} className="wizard-step min-w-0 rounded-lg border border-gold/15 bg-night-900/80 p-4 shadow-xl shadow-black/10 sm:p-5">
            <fieldset disabled={randomBusy || finishing} className="min-w-0 border-0 p-0">
            <Component char={char} patch={patch} errors={stepErrors} classes={classes} classDetails={classDetails}
              classDetail={classDetail} classDisplayName={classDisplayName} races={races} raceDetails={raceDetails}
              raceDetail={raceDetail} raceName={raceName} campaigns={campaigns} onFinish={finish}
              finishing={finishing} finishError={finishError} onPreview={setPreview} />
            </fieldset>
          </motion.div>
          <div className="mt-5 hidden items-center justify-between gap-3 lg:flex">
            <button onClick={goBack} disabled={step === 0} className="rounded border border-bone/20 px-5 py-2.5 text-sm text-bone/70 disabled:opacity-25">← Anterior</button>
            <span className="text-xs italic text-bone/35">Cada elección escribe tu historia.</span>
            {step < STEPS.length - 1 && <button onClick={goNext} disabled={choicesLoading || randomBusy} className="rounded bg-gold px-6 py-2.5 font-display text-sm text-night-950 hover:bg-gold/90 disabled:opacity-40">{choicesLoading ? 'Cargando opciones…' : 'Continuar →'}</button>}
          </div>
        </main>
        <aside className="hidden min-w-0 rounded-lg border border-gold/20 bg-night-900/90 p-5 lg:sticky lg:top-5 lg:block lg:max-h-[calc(100vh-40px)] lg:overflow-y-auto">
          <p className="mb-4 text-[10px] uppercase tracking-[.25em] text-gold/65">Tu leyenda · Vista previa</p>
          <WizardPreview {...previewProps} />
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gold/30 bg-night-950/95 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] shadow-xl lg:hidden">
        {preview && <p role="status" className="line-clamp-2 text-[11px] text-teal-200">{preview.label}: {changes.slice(0, 4).join(' · ') || 'Sin cambios en las estadísticas'}</p>}
        <button ref={previewButtonRef} onClick={() => setPreviewOpen(!previewOpen)} aria-expanded={previewOpen} aria-controls="wizard-preview-drawer"
          className="flex w-full items-center justify-between gap-2 py-2 text-left text-xs text-gold">
          <span className="min-w-0 truncate">◈ {stats.hp} PG · CA {stats.ac} · {stats.speed} pies</span><span className="shrink-0">Vista previa ↑</span>
        </button>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <button onClick={goBack} disabled={step === 0} className="rounded border border-bone/25 px-4 py-2.5 text-sm disabled:opacity-30">← Atrás</button>
          {step < STEPS.length - 1 ? <button onClick={goNext} disabled={choicesLoading || randomBusy} className="rounded bg-gold px-4 py-2.5 font-display text-sm text-night-950 disabled:opacity-40">{choicesLoading ? 'Cargando…' : 'Continuar →'}</button>
            : <button onClick={saveAndExit} className="rounded border border-gold/40 px-4 py-2.5 text-sm text-gold">Guardar y salir</button>}
        </div>
      </div>
      {previewOpen && <div className="fixed inset-0 z-40 flex items-end bg-black/70 lg:hidden" onClick={() => { setPreviewOpen(false); previewButtonRef.current?.focus(); }}>
        <section ref={previewDrawerRef} id="wizard-preview-drawer" role="dialog" aria-modal="true" aria-label="Vista previa del personaje" onClick={(e) => e.stopPropagation()}
          className="max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-gold/30 bg-night-900 p-5">
          <div className="mb-4 flex items-center justify-between"><p className="font-display text-gold">Tu personaje</p>
            <button ref={closePreviewRef} onClick={() => { setPreviewOpen(false); previewButtonRef.current?.focus(); }} aria-label="Cerrar vista previa" className="rounded border border-bone/20 px-3 py-2">✕</button></div>
          <WizardPreview {...previewProps} />
        </section>
      </div>}
    </div>
  );
}
