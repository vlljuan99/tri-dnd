import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import ConfirmationDialog from '../../../components/ConfirmationDialog.jsx';
import { campaignTypeOf } from '../steps.js';
import StepShell from './StepShell.jsx';

const AUTOSAVE_DELAY = 700;
const inputClass =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none disabled:opacity-50';
const labelClass = 'flex flex-col gap-1 text-xs uppercase tracking-wider text-bone/50';

function formFromCampaign(campaign) {
  return {
    name: campaign.name ?? '',
    description: campaign.description ?? '',
    maxPlayers: campaign.maxPlayers == null ? '' : String(campaign.maxPlayers),
  };
}

function identitySnapshot(form) {
  return JSON.stringify({
    name: form.name.trim(),
    description: form.description,
    maxPlayers: String(form.maxPlayers).trim(),
  });
}

function payloadFor(form, isDraft) {
  const name = form.name.trim();
  if (!name) return { error: 'La campaña necesita un nombre.' };

  const rawMaxPlayers = String(form.maxPlayers).trim();
  const maxPlayers = rawMaxPlayers === '' ? null : Number(rawMaxPlayers);
  if (maxPlayers !== null && (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 20)) {
    return { error: 'Las plazas deben ser un número entre 1 y 20.' };
  }

  return {
    snapshot: identitySnapshot(form),
    body: {
      name,
      description: form.description,
      maxPlayers,
      ...(isDraft ? { status: 'complete' } : {}),
    },
  };
}

const SAVE_LABELS = {
  saved: 'Guardado ✓',
  dirty: 'Sin guardar',
  saving: 'Guardando…',
  error: 'No se pudo guardar',
};

// Paso 1 — Identidad. Los cambios se guardan en serie tras una pausa breve:
// nunca hay dos PATCH compitiendo ni una respuesta antigua puede imponerse a
// una edición posterior. Los enlaces del Taller esperan este flush.
export default function IdentidadStep({ progress }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { campaign, updateCampaign, registerLeaveGuard } = progress;
  const isCampaign = campaignTypeOf(campaign) === 'campana';
  const isDraft = campaign.status === 'draft';

  const [form, setForm] = useState(() => formFromCampaign(campaign));
  const [saveStatus, setSaveStatus] = useState('saved');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const formRef = useRef(form);
  const savedSnapshotRef = useRef(identitySnapshot(form));
  const serverCampaignRef = useRef(campaign);
  const draftRef = useRef(isDraft);
  const editRevisionRef = useRef(0);
  const debounceRef = useRef(null);
  const savePromiseRef = useRef(null);
  const skipAutosaveRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    draftRef.current = campaign.status === 'draft';
    serverCampaignRef.current = campaign;
  }, [campaign]);

  // Si se cambia de campaña sin desmontar el router, la nueva identidad no
  // hereda el borrador local de la anterior.
  useEffect(() => {
    const next = formFromCampaign(campaign);
    formRef.current = next;
    savedSnapshotRef.current = identitySnapshot(next);
    editRevisionRef.current = 0;
    setForm(next);
    setSaveStatus('saved');
    setError('');
    // Solo debe reinicializarse al cambiar de entidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const drainSaves = useCallback(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (skipAutosaveRef.current) return Promise.resolve(true);
    if (savePromiseRef.current) return savePromiseRef.current;

    const promise = (async () => {
      while (!skipAutosaveRef.current) {
        const prepared = payloadFor(formRef.current, draftRef.current);
        if (prepared.error) {
          if (mountedRef.current) {
            setSaveStatus('dirty');
            setError(prepared.error);
          }
          return false;
        }

        if (prepared.snapshot === savedSnapshotRef.current) {
          // Puede ser la respuesta de una edición que volvió exactamente al
          // valor en vuelo; en ese caso aún hay que reflejarla en la cabecera.
          if (serverCampaignRef.current) updateCampaign(serverCampaignRef.current);
          if (mountedRef.current) {
            setSaveStatus('saved');
            setError('');
          }
          return true;
        }

        const revision = editRevisionRef.current;
        if (mountedRef.current) {
          setSaveStatus('saving');
          setError('');
        }

        try {
          const { campaign: updated } = await api(`/campaigns/${id}`, {
            method: 'PATCH',
            body: prepared.body,
          });
          savedSnapshotRef.current = prepared.snapshot;
          serverCampaignRef.current = updated;
          draftRef.current = updated.status === 'draft';

          // Si se escribió durante la petición, no declaramos victoria: el
          // bucle guarda inmediatamente la revisión nueva, siempre en serie.
          if (revision !== editRevisionRef.current) continue;

          updateCampaign(updated);
          if (mountedRef.current) {
            setSaveStatus('saved');
            setError('');
          }
          return true;
        } catch (saveError) {
          if (mountedRef.current) {
            setSaveStatus('error');
            setError(saveError.message || 'No se pudo guardar la identidad.');
          }
          return false;
        }
      }
      return true;
    })();

    savePromiseRef.current = promise;
    promise.finally(() => {
      if (savePromiseRef.current === promise) savePromiseRef.current = null;
    });
    return promise;
  }, [id, updateCampaign]);

  const scheduleAutosave = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void drainSaves();
    }, AUTOSAVE_DELAY);
  }, [drainSaves]);

  function change(field, value) {
    const next = { ...formRef.current, [field]: value };
    formRef.current = next;
    editRevisionRef.current += 1;
    setForm(next);
    setSaveStatus('dirty');
    setError('');
    scheduleAutosave();
  }

  async function save(event) {
    event.preventDefault();
    await drainSaves();
  }

  useEffect(() => registerLeaveGuard(drainSaves), [drainSaves, registerLeaveGuard]);

  // La navegación interna usa el guard anterior. Para cerrar o recargar la
  // pestaña, el navegador muestra su aviso nativo si aún queda una revisión.
  useEffect(() => {
    function warnBeforeUnload(event) {
      const pending =
        Boolean(savePromiseRef.current) ||
        identitySnapshot(formRef.current) !== savedSnapshotRef.current;
      if (!pending || skipAutosaveRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  // Una salida ajena a los enlaces del Taller (por ejemplo, Atrás del
  // navegador) no puede esperar, pero sí dispara la petición antes de desmontar.
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (!skipAutosaveRef.current) void drainSaves();
    },
    [drainSaves]
  );

  async function deleteCampaign() {
    setDeleting(true);
    skipAutosaveRef.current = true;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    try {
      if (savePromiseRef.current) await savePromiseRef.current;
      await api(`/campaigns/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (deleteError) {
      skipAutosaveRef.current = false;
      setDeleting(false);
      setError(deleteError.message);
    }
  }

  const statusClass =
    saveStatus === 'saved'
      ? 'text-sage'
      : saveStatus === 'error'
        ? 'text-blood'
        : saveStatus === 'saving'
          ? 'text-gold'
          : 'text-ochre';

  return (
    <StepShell
      progress={progress}
      stepId="identidad"
      description={
        isCampaign
          ? 'Ponle nombre y resume su premisa. La sinopsis es tu brújula privada: los jugadores no la ven. Los cambios se guardan automáticamente mientras trabajas.'
          : 'La partida rápida solo necesita su nombre y el número de plazas.'
      }
    >
      {isDraft && (
        <p className="mb-4 rounded-sm border border-ochre/40 bg-ochre/10 px-3 py-2 text-sm text-ochre">
          Borrador: escribe un nombre válido y se guardará automáticamente al dejar de escribir.
        </p>
      )}

      <form onSubmit={save} className="space-y-4 rounded-md border border-gold/20 bg-night-900/70 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className={labelClass}>
            Nombre *
            <input
              value={form.name}
              onChange={(event) => change('name', event.target.value)}
              maxLength={80}
              required
              autoFocus={isDraft}
              placeholder="Nombre de la campaña"
              className={`${inputClass} font-display text-lg normal-case tracking-normal`}
            />
          </label>
          <label className={labelClass}>
            Plazas
            <input
              type="number"
              min={1}
              max={20}
              value={form.maxPlayers}
              onChange={(event) => change('maxPlayers', event.target.value)}
              placeholder="Sin límite"
              className={`${inputClass} font-mono normal-case tracking-normal`}
            />
          </label>
        </div>

        <label className={labelClass}>
          Sinopsis privada (solo la ves tú)
          <textarea
            value={form.description}
            onChange={(event) => change('description', event.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Una expedición hacia un reino aislado donde los recuerdos se convierten en moneda…"
            className={`${inputClass} resize-y normal-case tracking-normal`}
          />
          <span className="text-right font-mono text-[0.65rem] normal-case tracking-normal text-bone/35">
            {form.description.length}/2000
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bone/10 pt-3">
          <div>
            <p className="text-xs text-bone/45">
              {isCampaign ? 'Campaña' : 'Escaramuza'} · invitación:{' '}
              <span className="font-mono tracking-widest text-bone/70">{campaign.inviteCode}</span>
            </p>
            <p role="status" aria-live="polite" className={`mt-1 text-xs ${statusClass}`}>
              {SAVE_LABELS[saveStatus]}
            </p>
          </div>
          <button
            type="submit"
            disabled={saveStatus === 'saving' || saveStatus === 'saved' || !form.name.trim()}
            className="rounded-sm border border-gold/40 px-4 py-2 font-display text-sm tracking-wide text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Guardar ahora
          </button>
        </div>
        {error && <p className="text-sm text-blood">{error}</p>}
      </form>

      <div className="mt-6 flex items-center justify-between gap-3 rounded-md border border-blood/20 bg-blood/5 p-3">
        <p className="text-xs text-bone/50">
          {isDraft
            ? 'Descartar este borrador y volver al hub.'
            : 'Borrar la campaña entera. Las fichas de personaje se conservan.'}
        </p>
        <button
          type="button"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
          className="shrink-0 rounded-sm border border-blood/40 px-3 py-1.5 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          {deleting ? 'Borrando…' : isDraft ? 'Descartar borrador' : 'Borrar campaña'}
        </button>
      </div>

      <ConfirmationDialog
        open={confirmDelete}
        title={
          isDraft
            ? '¿Descartar este borrador?'
            : `Borrar «${campaign.name}» para siempre`
        }
        description={
          isDraft
            ? 'Se eliminará todo lo que hayas preparado en este borrador.'
            : `Se borrarán el chat, la mesa, los mapas y el Taller de esta ${
                isCampaign ? 'campaña' : 'escaramuza'
              }. Las fichas de personaje se conservarán fuera de ella.`
        }
        detail="Esta acción no se puede deshacer."
        requiredText={isDraft ? undefined : campaign.name}
        confirmLabel={isDraft ? 'Descartar borrador' : 'Borrar definitivamente'}
        busy={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={deleteCampaign}
      />
    </StepShell>
  );
}
