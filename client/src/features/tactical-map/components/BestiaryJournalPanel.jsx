import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { useRoom } from '../../../store/socket.js';

const SIZE_ES = {
  Tiny: 'Diminuta', Small: 'Pequeña', Medium: 'Mediana', Large: 'Grande', Huge: 'Enorme', Gargantuan: 'Gargantuesca',
};
const TYPE_ES = {
  aberration: 'aberración', beast: 'bestia', celestial: 'celestial', construct: 'constructo',
  dragon: 'dragón', elemental: 'elemental', fey: 'feérico', fiend: 'infernal', giant: 'gigante',
  humanoid: 'humanoide', monstrosity: 'monstruosidad', ooze: 'cieno', plant: 'planta', undead: 'muerto viviente',
};
const ALIGNMENT_ES = {
  'lawful good': 'legal bueno', 'neutral good': 'neutral bueno', 'chaotic good': 'caótico bueno',
  'lawful neutral': 'legal neutral', neutral: 'neutral', 'chaotic neutral': 'caótico neutral',
  'lawful evil': 'legal maligno', 'neutral evil': 'neutral maligno', 'chaotic evil': 'caótico maligno',
  unaligned: 'sin alineamiento', any: 'cualquiera',
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-ES');
}

export default function BestiaryJournalPanel({ campaignId }) {
  const version = useRoom((state) => state.bestiaryVersion);
  const [creatures, setCreatures] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/campaigns/${campaignId}/bestiario`)
      .then((response) => {
        if (!cancelled) {
          setCreatures(response.creatures ?? []);
          setError('');
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message || 'No se pudo abrir el bestiario.');
      });
    return () => { cancelled = true; };
  }, [campaignId, version]);

  if (error) return <p className="p-4 text-sm text-blood">{error}</p>;
  if (!creatures.length) {
    return (
      <div className="p-6 text-center">
        <p className="font-display text-lg text-gold/75">El diario aún está en blanco</p>
        <p className="mt-2 text-xs leading-relaxed text-bone/45">
          Se llenará solo al revelar enemigos o incorporarlos a una sesión.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 overflow-y-auto p-3">
      <p className="text-[0.68rem] leading-relaxed text-bone/45">
        Criaturas conocidas por el grupo. Las estadísticas del DM nunca forman parte de este diario.
      </p>
      {creatures.map((creature) => (
        <article key={creature.id} className="flex gap-3 rounded-sm border border-gold/15 bg-night-950/45 p-2.5">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-sm border border-bone/10 bg-night-950">
            {creature.imageUrl ? (
              <img src={creature.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center font-display text-xl text-gold/30">?</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate font-display text-sm text-gold">{creature.name}</h3>
              {!creature.translated && creature.monsterIndex && (
                <span className="rounded-sm border border-bone/15 px-1 text-[0.55rem] text-bone/40">EN</span>
              )}
            </div>
            <p className="mt-0.5 text-[0.68rem] capitalize text-bone/55">
              {[
                SIZE_ES[creature.size] ?? creature.size,
                TYPE_ES[creature.type] ?? creature.type,
                ALIGNMENT_ES[creature.alignment] ?? creature.alignment,
              ].filter(Boolean).join(' · ') || 'Criatura singular'}
            </p>
            <p className="mt-1 text-[0.62rem] text-bone/35">
              Vista por primera vez: {formatDate(creature.firstSeenAt)} · {creature.appearances} {creature.appearances === 1 ? 'encuentro' : 'encuentros'}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
