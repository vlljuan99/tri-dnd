import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import ArchiveWorkspace from '../../campaign-archive/components/ArchiveWorkspace.jsx';

const inputClass =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none disabled:opacity-50';

// Paso 2 — Lore y trama: TODO el material narrativo en un solo sitio. El
// archivo privado del DM ocupa el paso, y la presentación pública (lo único
// que antes vivía aparte, en «Gestión») es un panel plegable encima: mismo
// lugar, distinta visibilidad.
export default function LoreStep({ progress }) {
  const { id } = useParams();
  const { campaign, setCampaign } = progress;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    lore: campaign.lore ?? '',
    objectives: (campaign.objectives ?? []).join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const objectivesCount = (campaign.objectives ?? []).filter(Boolean).length;

  async function savePresentation(event) {
    event.preventDefault();
    const objectives = form.objectives
      .split('\n')
      .map((objective) => objective.trim())
      .filter(Boolean);
    if (objectives.length > 30) {
      setError('Puedes publicar como máximo 30 objetivos.');
      return;
    }
    if (objectives.some((objective) => objective.length > 200)) {
      setError('Cada objetivo puede ocupar como máximo 200 caracteres.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { campaign: updated } = await api(`/campaigns/${id}`, {
        method: 'PATCH',
        body: { lore: form.lore, objectives },
      });
      setCampaign(updated);
      setNotice('Publicado ✓');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-gold/15 bg-night-900/40 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl tracking-wide text-gold">Lore y trama</h2>
            <p className="text-xs text-bone/50">
              Tu archivo privado de preparación. Lo que publiques como artículo o en la presentación lo verá el grupo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className={`rounded-sm border px-3 py-1.5 text-xs ${
              open
                ? 'border-gold bg-gold/10 text-gold'
                : 'border-bone/25 text-bone/70 hover:border-gold hover:text-gold'
            }`}
          >
            Presentación pública · {campaign.lore?.trim() ? 'introducción lista' : 'sin introducción'} ·{' '}
            {objectivesCount} objetivo{objectivesCount === 1 ? '' : 's'} {open ? '▴' : '▾'}
          </button>
        </div>

        {open && (
          <form onSubmit={savePresentation} className="mt-3 grid gap-3 border-t border-bone/10 pt-3 lg:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-bone/50">
              Introducción pública
              <textarea
                value={form.lore}
                onChange={(event) => {
                  setForm((current) => ({ ...current, lore: event.target.value }));
                  setNotice('');
                }}
                rows={5}
                maxLength={5000}
                placeholder="Lo que el grupo conoce al comenzar la aventura…"
                className={`${inputClass} resize-y normal-case tracking-normal`}
              />
              <span className="text-[0.65rem] normal-case tracking-normal text-bone/40">
                Aparece en el diario del campamento; no incluyas aquí secretos del DM.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-bone/50">
              Objetivos conocidos
              <textarea
                value={form.objectives}
                onChange={(event) => {
                  setForm((current) => ({ ...current, objectives: event.target.value }));
                  setNotice('');
                }}
                rows={5}
                placeholder={'Encontrar la espada perdida\nDescubrir quién controla el puerto'}
                className={`${inputClass} resize-y normal-case tracking-normal`}
              />
              <span className="text-[0.65rem] normal-case tracking-normal text-bone/40">
                Un objetivo por línea, hasta 30.
              </span>
            </label>
            <div className="flex items-center gap-3 lg:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
              >
                {busy ? 'Guardando…' : 'Publicar presentación'}
              </button>
              {notice && <p className="text-sm text-sage">{notice}</p>}
              {error && <p className="text-sm text-blood">{error}</p>}
            </div>
          </form>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <ArchiveWorkspace
          campaignId={id}
          canEdit
          initialData={progress.archive}
          onData={(data) => progress.updateResource('archive', data)}
        />
      </div>
    </div>
  );
}
