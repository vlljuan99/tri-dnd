import { useState } from 'react';
import { ABILITIES, SKILLS } from '../../../lib/dnd.js';
import { useRoom } from '../../../store/socket.js';

// «Pedir tirada» del DM (Fase 4c): prueba de característica, de habilidad o
// salvación, a unos PJ o a todo el grupo. Cada jugador recibe el aviso y tira
// él; los resultados los ve toda la mesa. La CD es opcional y queda oculta
// salvo que el DM la revele; una tirada de grupo necesita CD (el SRD la
// resuelve por mayoría: basta con que la supere la mitad).

const FIELD =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold/60 focus:outline-none';

export default function RequestRollDialog({ characters = [], onClose }) {
  const requestRoll = useRoom((s) => s.requestRoll);
  const [tipo, setTipo] = useState('habilidad');
  const [habilidad, setHabilidad] = useState('perception');
  const [caracteristica, setCaracteristica] = useState('dex');
  const [todos, setTodos] = useState(true);
  const [elegidos, setElegidos] = useState([]);
  const [cd, setCd] = useState('');
  const [revelarCd, setRevelarCd] = useState(false);
  const [grupal, setGrupal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggleElegido(id) {
    setElegidos((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function pedir(event) {
    event.preventDefault();
    if (!todos && !elegidos.length) {
      setError('Elige al menos a un personaje, o pide la tirada a todo el grupo.');
      return;
    }
    if (grupal && cd === '') {
      setError('Una tirada de grupo necesita una CD para saber quién la supera.');
      return;
    }
    setBusy(true);
    setError('');
    const resp = await requestRoll({
      tipo: tipo === 'salvacion' ? 'salvacion' : 'prueba',
      habilidad: tipo === 'habilidad' ? habilidad : null,
      caracteristica: tipo === 'habilidad' ? null : caracteristica,
      characterIds: todos ? [] : elegidos,
      cd: cd === '' ? null : Number(cd),
      revelarCd,
      grupal,
    });
    setBusy(false);
    if (resp?.error) {
      setError(resp.error);
      return;
    }
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/60 p-4" onClick={onClose}>
      <form
        onSubmit={pedir}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-md border border-gold/30 bg-night-900 p-4 text-bone shadow-2xl"
        aria-label="Pedir tirada"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg tracking-wide text-gold">Pedir tirada</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="px-1 text-bone/60 hover:text-bone">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-sm border border-bone/15 p-1" role="radiogroup" aria-label="Tipo de tirada">
          {[
            ['habilidad', 'Habilidad'],
            ['caracteristica', 'Característica'],
            ['salvacion', 'Salvación'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={tipo === value}
              onClick={() => setTipo(value)}
              className={`rounded-sm py-1 text-xs ${tipo === value ? 'bg-gold/80 text-night-950' : 'text-bone/60 hover:text-bone'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs text-bone/60">
          {tipo === 'habilidad' ? 'Habilidad' : 'Característica'}
          {tipo === 'habilidad' ? (
            <select value={habilidad} onChange={(event) => setHabilidad(event.target.value)} className={`mt-1 ${FIELD}`}>
              {SKILLS.map((skill) => (
                <option key={skill.index} value={skill.index}>
                  {skill.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={caracteristica}
              onChange={(event) => setCaracteristica(event.target.value)}
              className={`mt-1 ${FIELD}`}
            >
              {ABILITIES.map((ability) => (
                <option key={ability.key} value={ability.key}>
                  {ability.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <fieldset className="mt-3">
          <legend className="text-xs text-bone/60">A quién</legend>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={todos} onChange={(event) => setTodos(event.target.checked)} className="accent-gold" />
            Todo el grupo
          </label>
          {!todos && (
            <div className="mt-1 space-y-1 rounded-sm border border-bone/10 p-2">
              {characters.length === 0 && <p className="text-xs text-bone/40">No hay personajes en el tablero.</p>}
              {characters.map((character) => (
                <label key={character.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={elegidos.includes(character.id)}
                    onChange={() => toggleElegido(character.id)}
                    className="accent-gold"
                  />
                  {character.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-xs text-bone/60">
            CD (opcional)
            <input
              type="number"
              min="1"
              max="40"
              inputMode="numeric"
              value={cd}
              onChange={(event) => setCd(event.target.value)}
              className={`mt-1 ${FIELD}`}
              placeholder="—"
            />
          </label>
          <div className="flex flex-col justify-end gap-1 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={revelarCd}
                disabled={cd === ''}
                onChange={(event) => setRevelarCd(event.target.checked)}
                className="accent-gold"
              />
              Revelar la CD
            </label>
            <label className="flex items-center gap-2" title="La supera el grupo si al menos la mitad la supera">
              <input type="checkbox" checked={grupal} onChange={(event) => setGrupal(event.target.checked)} className="accent-gold" />
              Tirada de grupo
            </label>
          </div>
        </div>
        <p className="mt-2 text-[0.65rem] leading-snug text-bone/45">
          Cada jugador tira la suya (o se tira sola a los pocos segundos). Los resultados los ve toda la mesa;
          con la CD oculta, quién la supera solo lo ves tú.
        </p>

        {error && <p className="mt-2 text-xs text-blood">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-3 w-full rounded-sm bg-gold py-2 font-display tracking-wider text-night-950 hover:bg-gold/90 disabled:opacity-50"
        >
          {busy ? 'Pidiendo…' : 'Pedir tirada'}
        </button>
      </form>
    </div>
  );
}
