import { useEffect, useState } from 'react';
import { useRoom } from '../../../store/socket.js';

export default function FallPanel({ target, suggestedFeet = 10, onClose }) {
  const makeFall = useRoom((state) => state.makeFall);
  const [feet, setFeet] = useState(suggestedFeet);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    setFeet(suggestedFeet);
    setError('');
    setResult(null);
  }, [suggestedFeet, target.id]);

  const targetRef = target.serverId
    ? { kind: 'marcador', id: target.serverId }
    : { kind: 'personaje', id: target.characterId };

  async function submit() {
    if (busy || result) return;
    setBusy(true);
    setError('');
    const response = await makeFall({ target: targetRef, feet });
    setBusy(false);
    if (response?.error) {
      setError(response.error);
      return;
    }
    setResult(response);
  }

  return (
    <div className="absolute bottom-20 left-1/2 z-30 w-[22rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-blood/40 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">
          Hacer caer a <span className="text-bone">{target.name}</span>
        </p>
        <button type="button" onClick={onClose} aria-label="Cerrar caída" className="px-1 text-bone/60 hover:text-bone">
          ✕
        </button>
      </div>

      {result ? (
        <div className="space-y-2">
          <p className="text-sm text-bone/85">
            <span className="font-mono text-gold">{result.dice}d6 = {result.damage}</span> puntos de daño.
          </p>
          {Number.isInteger(result.remainingHp) && (
            <p className="text-xs text-bone/60">
              {result.defeated
                ? `${target.name} ha caído derrotado.`
                : `Le quedan ${Math.max(0, result.remainingHp)}${Number.isInteger(result.maxHp) ? `/${result.maxHp}` : ''} PG.`}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-sm border border-gold/40 px-3 py-1.5 text-sm text-gold hover:bg-gold/10"
          >
            Cerrar
          </button>
        </div>
      ) : (
        <>
          <label className="block text-xs uppercase tracking-widest text-bone/55" htmlFor="fall-feet">
            Altura de la caída
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="fall-feet"
              type="number"
              min="10"
              max="200"
              step="10"
              value={feet}
              onChange={(event) => setFeet(Math.max(10, Math.min(200, Number(event.target.value) || 10)))}
              className="min-w-0 flex-1 rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 font-mono text-bone outline-none focus:border-gold"
            />
            <span className="text-sm text-bone/60">pies · {Math.floor(feet / 10)}d6</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-bone/45">
            El servidor tira el daño y lo aplica. No mueve el token ni consume una acción; recolócalo después si corresponde.
          </p>
          {error && <p className="mt-2 text-xs text-blood">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || feet % 10 !== 0}
              className="flex-1 rounded-sm bg-blood px-3 py-1.5 font-display text-sm tracking-wide text-bone hover:bg-blood/85 disabled:opacity-40"
            >
              {busy ? 'Tirando…' : `Hacer caer · ${Math.floor(feet / 10)}d6`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-bone/25 px-3 py-1.5 text-sm text-bone/70 hover:bg-bone/5"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
