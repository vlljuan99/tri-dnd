import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api.js';

const AREA_LABEL = {
  sphere: 'esfera', cone: 'cono', cube: 'cubo', cylinder: 'cilindro', line: 'línea',
};

export default function SpellPanel({
  characterId,
  campaignId,
  selection,
  validation,
  affectedNames,
  busy,
  error,
  onSelect,
  onSlotLevel,
  onCast,
  onClose,
}) {
  const [character, setCharacter] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loadingSpell, setLoadingSpell] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api(`/characters/${characterId}`)
      .then(({ character: next }) => {
        if (!cancelled) setCharacter(next);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause.message || 'No se pudo cargar la lista de conjuros.');
      });
    return () => { cancelled = true; };
  }, [characterId]);

  const available = useMemo(() => {
    if (!character) return [];
    const prepared = new Set(character.spells?.prepared ?? []);
    return (character.spells?.known ?? [])
      .filter((spell) => Number(spell.level) === 0 || prepared.has(spell.index))
      .filter((spell) => spell.attackType || spell.hasDamage || spell.area)
      .sort((a, b) => Number(a.level) - Number(b.level) || a.name.localeCompare(b.name));
  }, [character]);

  async function choose(spell) {
    setLoadingSpell(spell.index);
    setLoadError('');
    try {
      const suffix = campaignId ? `?campaignId=${campaignId}` : '';
      const detail = await api(`/srd/spells/${encodeURIComponent(spell.index)}${suffix}`);
      onSelect({ spell, data: detail.data, slotLevel: Number(spell.level) || 0 });
    } catch (cause) {
      setLoadError(cause.message || 'No se pudo cargar el conjuro.');
    } finally {
      setLoadingSpell(null);
    }
  }

  return (
    <div className="absolute left-3 top-28 z-30 max-h-[62vh] w-[22rem] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-sm border border-violet-300/45 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur sm:left-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-sm tracking-wide text-violet-200">Lanzar conjuro</p>
        <button type="button" onClick={onClose} className="px-1 text-bone/55 hover:text-bone" aria-label="Cerrar">✕</button>
      </div>

      {!selection && (
        <>
          <p className="mt-1 text-xs text-bone/55">Elige un conjuro preparado con ataque, daño o área.</p>
          <div className="mt-3 space-y-1.5">
            {available.map((spell) => (
              <button
                key={spell.index}
                type="button"
                disabled={loadingSpell === spell.index}
                onClick={() => choose(spell)}
                className="flex w-full items-center justify-between gap-2 rounded-sm border border-bone/15 px-2.5 py-2 text-left text-sm hover:border-violet-300/60 hover:bg-violet-300/10 disabled:opacity-50"
              >
                <span className="truncate">{spell.name}</span>
                <span className="shrink-0 text-xs text-bone/45">{Number(spell.level) === 0 ? 'truco' : `nivel ${spell.level}`}</span>
              </button>
            ))}
            {character && available.length === 0 && (
              <p className="text-sm text-bone/45">No hay conjuros preparados.</p>
            )}
          </div>
        </>
      )}

      {selection && (
        <div className="mt-2">
          <button type="button" onClick={() => onSelect(null)} className="text-xs text-violet-200/75 hover:text-violet-200">
            ← Cambiar conjuro
          </button>
          <p className="mt-2 font-display text-base text-violet-100">{selection.spell.name}</p>
          <p className="mt-1 text-xs text-bone/55">
            {selection.area
              ? `Plantilla: ${AREA_LABEL[selection.area.type] ?? selection.area.type}, ${selection.area.size * 5} pies.`
              : 'Pulsa una criatura del tablero para fijarla como objetivo.'}
          </p>
          <p className="mt-1 text-xs text-bone/70">
            {selection.aim
              ? validation?.ok
                ? affectedNames.length
                  ? `Afecta a: ${affectedNames.join(', ')}.`
                  : 'La plantilla no contiene criaturas visibles.'
                : validation?.error
              : selection.area
                ? 'Pulsa una casilla para colocar el centro o elegir la dirección.'
                : 'Esperando objetivo…'}
          </p>
          {Number(selection.spell.level) > 0 && (
            <label className="mt-3 flex items-center justify-between gap-2 text-xs text-bone/65">
              Espacio de nivel
              <select
                value={selection.slotLevel}
                onChange={(event) => onSlotLevel(Number(event.target.value))}
                className="rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-bone"
              >
                {Array.from({ length: 10 - Number(selection.spell.level) }, (_, index) => Number(selection.spell.level) + index).map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={busy || !selection.aim || !validation?.ok || (!selection.area && !selection.target)}
            onClick={onCast}
            className="mt-3 w-full rounded-sm bg-violet-200 px-3 py-2 font-display text-sm text-night-950 hover:bg-violet-100 disabled:opacity-35"
          >
            {busy ? 'Resolviendo…' : 'Lanzar'}
          </button>
        </div>
      )}
      {(loadError || error) && <p className="mt-2 text-xs text-blood">{loadError || error}</p>}
    </div>
  );
}
