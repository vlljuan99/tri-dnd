import { useState } from 'react';
import { api } from '../api.js';
import { ABILITIES, abilityModifier, formatModifier, proficiencyBonus } from '../lib/dnd.js';
import { rollDie } from '../lib/dice.js';

/**
 * Mini-asistente de subida de nivel (Fase D). Enseña ANTES de confirmar todo
 * lo que cambia — PG por los dos caminos, rasgos nuevos, mejora de
 * característica y espacios de conjuro— y manda una sola petición al
 * servidor, que es quien aplica las reglas de verdad.
 *
 * El nivel ya lo ha concedido el DM: aquí solo se completa.
 */
export default function LevelUpDialog({ characterId, character, preview, onDone, onClose }) {
  const [method, setMethod] = useState('fijo');
  const [roll, setRoll] = useState(null);
  const [increases, setIncreases] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const gains = preview.progression;
  const offersImprovement = Boolean(gains?.abilityScoreImprovement);
  const pointsSpent = Object.values(increases).reduce((sum, n) => sum + n, 0);
  const profBefore = proficiencyBonus(preview.fromLevel);
  const profAfter = proficiencyBonus(preview.toLevel);

  // La CON de la mejora cuenta ya para los PG de este mismo nivel, igual que
  // en el servidor.
  const conMod = abilityModifier((character.abilities?.con ?? 10) + (increases.con ?? 0));
  const hpFixed = Math.max(1, Math.floor(preview.hitDie / 2) + 1 + conMod);
  const hpFromRoll = roll == null ? null : Math.max(1, roll + conMod);

  function tirar() {
    setRoll(rollDie(preview.hitDie));
  }

  function toggleAbility(key, value) {
    setIncreases((current) => {
      const next = { ...current };
      if (value <= 0) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function confirmar() {
    setBusy(true);
    setError('');
    try {
      const { character: updated } = await api(`/characters/${characterId}/subir-nivel`, {
        method: 'POST',
        body: {
          hpMethod: method,
          hpRoll: method === 'tirada' ? roll : null,
          abilityIncreases: offersImprovement ? increases : null,
        },
      });
      onDone?.(updated);
    } catch (e) {
      setError(e.message || 'No se pudo subir de nivel.');
      setBusy(false);
    }
  }

  const faltanPuntos = offersImprovement && pointsSpent < 2;
  const faltaTirada = method === 'tirada' && roll == null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sm border border-gold/40 bg-night-900 p-4 text-bone shadow-2xl">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg tracking-wide text-gold">
            Subir al nivel {preview.toLevel}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="px-1 text-bone/60 hover:text-bone">
            ✕
          </button>
        </div>

        <section className="mb-3 rounded-sm border border-bone/10 bg-night-950/60 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-bone/50">Puntos de golpe</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMethod('fijo')}
              className={`rounded-sm border px-3 py-1.5 text-sm ${
                method === 'fijo' ? 'border-gold/60 bg-gold/10 text-gold' : 'border-bone/20 text-bone/80'
              }`}
            >
              Valor fijo · +{hpFixed}
            </button>
            <button
              onClick={() => setMethod('tirada')}
              className={`rounded-sm border px-3 py-1.5 text-sm ${
                method === 'tirada' ? 'border-gold/60 bg-gold/10 text-gold' : 'border-bone/20 text-bone/80'
              }`}
            >
              Tirar 1d{preview.hitDie}
            </button>
            {method === 'tirada' && (
              <button
                onClick={tirar}
                disabled={busy}
                className="rounded-sm border border-bone/30 px-3 py-1.5 text-sm text-bone/90 hover:bg-bone/10"
              >
                {roll == null ? 'Tirar el dado' : `Sacaste ${roll} → +${hpFromRoll}`}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[0.7rem] text-bone/50">
            Se suma tu modificador de CON ({formatModifier(conMod)}) y nunca baja de 1 PG.
          </p>
        </section>

        {offersImprovement && (
          <section className="mb-3 rounded-sm border border-gold/20 bg-night-950/60 p-3">
            <p className="mb-1 text-xs uppercase tracking-wider text-bone/50">
              Mejora de característica · te quedan {2 - pointsSpent} puntos
            </p>
            <div className="grid grid-cols-3 gap-2">
              {ABILITIES.map(({ key, short: label, name }) => {
                const value = increases[key] ?? 0;
                const base = character.abilities?.[key] ?? 10;
                const topeAlcanzado = base + value >= 20;
                return (
                  <div key={key} className="rounded-sm border border-bone/10 px-2 py-1.5 text-center">
                    <p className="text-xs uppercase tracking-wider text-bone/60">{label}</p>
                    <p className="font-mono text-sm">
                      {base}
                      {value > 0 && <span className="text-gold"> +{value}</span>}
                    </p>
                    <div className="mt-1 flex justify-center gap-1">
                      <button
                        onClick={() => toggleAbility(key, value - 1)}
                        disabled={value === 0}
                        className="h-6 w-6 rounded-sm border border-bone/20 text-xs disabled:opacity-30"
                        aria-label={`Quitar punto de ${name}`}
                      >
                        −
                      </button>
                      <button
                        onClick={() => toggleAbility(key, value + 1)}
                        disabled={pointsSpent >= 2 || value >= 2 || topeAlcanzado}
                        className="h-6 w-6 rounded-sm border border-bone/20 text-xs disabled:opacity-30"
                        aria-label={`Subir ${name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[0.7rem] text-bone/50">
              Dos puntos a repartir, ninguna característica pasa de 20. Las dotes quedan fuera por ahora.
            </p>
          </section>
        )}

        {gains?.features?.length > 0 && (
          <section className="mb-3 rounded-sm border border-bone/10 bg-night-950/60 p-3">
            <p className="mb-1 text-xs uppercase tracking-wider text-bone/50">Rasgos nuevos</p>
            <ul className="space-y-1 text-sm text-bone/85">
              {gains.features.map((feature) => (
                <li key={feature.index}>
                  {feature.name}
                  {!feature.translated && <span className="ml-1.5 text-[0.65rem] text-bone/40">EN</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[0.7rem] text-bone/50">
              Los rasgos narrativos los lleva la mesa: quedan anotados en tu ficha, no se automatizan.
            </p>
          </section>
        )}

        {gains?.newSpellSlots?.some((n) => n > 0) && (
          <section className="mb-3 rounded-sm border border-bone/10 bg-night-950/60 p-3">
            <p className="mb-1 text-xs uppercase tracking-wider text-bone/50">Espacios de conjuro</p>
            <p className="text-sm text-bone/85">
              {gains.spellSlots
                .map((slots, i) => (slots > 0 ? `nivel ${i + 1}: ${slots}` : null))
                .filter(Boolean)
                .join(' · ')}
            </p>
          </section>
        )}

        {profAfter !== profBefore && (
          <p className="mb-3 text-sm text-gold/80">
            Tu bonificador de competencia sube a {formatModifier(profAfter)}.
          </p>
        )}

        {error && <p className="mb-2 text-xs text-blood">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm text-bone/80">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={busy || faltanPuntos || faltaTirada}
            className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 disabled:opacity-40"
            title={faltanPuntos ? 'Reparte los dos puntos de la mejora' : faltaTirada ? 'Tira el dado de golpe' : ''}
          >
            {busy ? 'Subiendo…' : `Confirmar nivel ${preview.toLevel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
