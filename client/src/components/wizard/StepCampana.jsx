import { inputClass } from './styles.js';

export default function StepCampana({ char, patch, campaigns }) {
  return <div className="space-y-6">
    <p className="text-lg leading-relaxed text-bone/80">Toda leyenda empieza en algún lugar.<br /><span className="text-bone/50">Elige la mesa en la que comenzará la tuya.</span></p>
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-gold">Tu campaña</span>
      <select className={`${inputClass} w-full min-w-0`} value={char.campaign_id ?? ''}
        onChange={(e) => patch({ campaign_id: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Sin campaña por ahora</option>
        {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <span className="text-sm text-bone/60">Tu campaña determina las especies y clases de tu DM que puedes elegir. También fija tu nivel inicial.</span>
    </label>
    <div className="rounded-md border border-gold/20 bg-gold/5 p-5">
      <p className="font-display text-sm text-gold">Un personaje, a tu manera</p>
      <p className="mt-2 text-sm leading-relaxed text-bone/65">Primero elegirás tu especie y tu clase. Después, sus fortalezas y su equipo. El nombre y el retrato llegan al final.</p>
      <p className="mt-3 text-xs text-bone/50">Puedes empezar sin campaña y asociarlo más adelante. Tu progreso se guarda automáticamente.</p>
    </div>
  </div>;
}
