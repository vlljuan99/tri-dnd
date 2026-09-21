import { useState } from 'react';
import { ALIGNMENTS } from '../../lib/dnd.js';
import { uploadCharacterAvatar, generateCharacterAvatar, removeCharacterAvatar } from '../../lib/characterAvatar.js';
import CharacterAvatarPanel from '../CharacterAvatarPanel.jsx';
import { inputClass, labelClass, labelTextClass } from './styles.js';
import { hasChosenName, PLACEHOLDER_NAME } from '../../lib/wizard.js';

// Identidad llega después del equipo. El futuro paso Apariencia se insertará antes.
export default function StepIdentidad({ char, patch, errors }) {
  const [busy, setBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  async function avatarAction(action) {
    setBusy(true);
    setAvatarError('');
    try { const updated = await action(); patch({ avatar_path: updated.avatar_path }); }
    catch (error) { setAvatarError(error.message || 'No se pudo actualizar el retrato.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-bone/70">Ya sabes de qué es capaz. Ahora dale un nombre y una historia. Solo el nombre es obligatorio.</p>
      <label className={labelClass}>
        <span className={labelTextClass}>Nombre *</span>
        <input value={char.name === PLACEHOLDER_NAME ? '' : char.name ?? ''} maxLength={100} onChange={(e) => patch({ name: e.target.value })}
          placeholder="¿Cómo se llamará tu héroe?" className={`${inputClass} font-display text-lg`}
          aria-invalid={Boolean(errors.name)} aria-describedby="wizard-name-help" />
        <span id="wizard-name-help" className={`text-xs ${errors.name ? 'text-red-300' : 'text-bone/50'}`}>
          {errors.name || 'Este es el nombre que verá tu grupo en la mesa y en las tiradas.'}
        </span>
      </label>
      <section className="rounded-md border border-gold/20 bg-black/15 p-4" aria-label="Retrato del personaje">
        <p className="mb-3 font-display text-sm text-gold">Tu retrato</p>
        <CharacterAvatarPanel avatarUrl={char.avatar_path} editable busy={busy} error={avatarError}
          onUpload={(file) => avatarAction(() => uploadCharacterAvatar(char.id, file))}
          onGenerate={(options) => avatarAction(() => generateCharacterAvatar(char.id, options))}
          onRemove={() => avatarAction(() => removeCharacterAvatar(char.id))} />
        <p className="mt-3 text-xs text-bone/50">Sube una imagen o genera un retrato. También puedes hacerlo más adelante.</p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}><span className={labelTextClass}>Pronombres (opcional)</span>
          <input value={char.pronouns ?? ''} onChange={(e) => patch({ pronouns: e.target.value })} placeholder="Ella, él, elle…" className={inputClass} /></label>
        <label className={labelClass}><span className={labelTextClass}>Alineamiento (opcional)</span>
          <select value={char.alignment ?? ''} onChange={(e) => patch({ alignment: e.target.value })} className={inputClass}>
            <option value="">Sin definir</option>{ALIGNMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></label>
      </div>
      <label className={labelClass}><span className={labelTextClass}>Trasfondo narrativo (opcional)</span>
        <input value={char.background ?? ''} onChange={(e) => patch({ background: e.target.value })} placeholder="Una antigua guardiana, un viajero sin hogar…" className={inputClass} />
        <span className="text-xs text-bone/50">Forma parte de tu historia; no concede competencias ni equipo.</span></label>
      <label className={labelClass}><span className={labelTextClass}>Notas iniciales (opcional)</span>
        <textarea value={char.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} rows={4} placeholder="¿Qué busca? ¿A quién dejó atrás? ¿Por qué se unió al grupo?" className={`${inputClass} resize-y`} /></label>
    </div>
  );
}
export function validateIdentidad(char) {
  return hasChosenName(char) ? {} : { name: 'Escribe un nombre: es lo que verá tu grupo en la mesa y en las tiradas.' };
}
