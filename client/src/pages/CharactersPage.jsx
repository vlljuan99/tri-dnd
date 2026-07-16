import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CLASS_NAMES } from '../lib/dnd.js';

const DM_CATEGORY_LABELS = {
  enemigo: 'Enemigo',
  jefe: 'Jefe',
  pnj: 'PNJ',
};

const DM_CATEGORY_STYLES = {
  enemigo: 'border-blood/50 bg-blood/10 text-blood',
  jefe: 'border-ochre/50 bg-ochre/10 text-ochre',
  pnj: 'border-moss/50 bg-moss/10 text-moss',
};

function dmCategory(character) {
  return DM_CATEGORY_LABELS[character.dm_category] ? character.dm_category : 'jefe';
}

function AvatarBadge({ character }) {
  if (character.avatar_path) {
    return (
      <img
        src={character.avatar_path}
        alt={`Icono de ${character.name}`}
        className="h-16 w-16 shrink-0 rounded-full border-2 border-ember/50 object-cover shadow-sm"
      />
    );
  }
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-ember/30 bg-ember/10 font-display text-2xl text-ember">
      {character.name?.trim()?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function HpBar({ current, max }) {
  if (!Number.isInteger(max) || max <= 0) return null;
  const ratio = Math.max(0, Math.min(1, current / max));
  const color = ratio > 0.5 ? 'bg-moss' : ratio > 0.25 ? 'bg-ochre' : 'bg-ember';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2 w-20 overflow-hidden rounded-sm bg-ink/10">
        <div className={`h-full ${color}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="font-mono text-xs text-ink/60">
        {current}/{max}
      </span>
    </div>
  );
}

export default function CharactersPage() {
  const [characters, setCharacters] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [classifyingId, setClassifyingId] = useState(null);
  const [raceNames, setRaceNames] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    api('/characters').then(({ characters }) => setCharacters(characters)).catch((e) => setError(e.message));
    // Traducciones de raza del compendio, igual que en la ficha completa
    api('/srd/races')
      .then(({ results }) => setRaceNames(Object.fromEntries(results.map((r) => [r.index, r.name]))))
      .catch(() => {});
  }, []);

  async function createCharacter(kind = 'pj', dmCategoryValue = null) {
    setCreating(true);
    try {
      // El PJ nace como borrador: el asistente guiado se encarga de
      // completarlo paso a paso, nunca se abre una ficha vacía directamente.
      // Un jefe no pasa por el asistente (no elige clase/raza del SRD): va
      // directo a la ficha completa para que el DM rellene sus stats.
      const body = kind === 'boss' ? { kind, dm_category: dmCategoryValue ?? 'jefe' } : { kind };
      const { character } = await api('/characters', { method: 'POST', body });
      navigate(kind === 'boss' ? `/personajes/${character.id}` : `/personajes/${character.id}/asistente`);
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  async function deleteCharacter(character) {
    const msg =
      character.status === 'draft'
        ? `¿Descartar el borrador de ${character.name}?`
        : `¿Retirar a ${character.name} para siempre?`;
    if (!window.confirm(msg)) return;
    await api(`/characters/${character.id}`, { method: 'DELETE' });
    setCharacters((cs) => cs.filter((c) => c.id !== character.id));
  }

  async function classifyDmCharacter(character, category) {
    if (category === dmCategory(character)) return;
    setClassifyingId(character.id);
    setError('');
    try {
      const { character: updated } = await api(`/characters/${character.id}`, {
        method: 'PUT',
        body: { dm_category: category },
      });
      setCharacters((list) => list.map((c) => (c.id === character.id ? updated : c)));
    } catch (err) {
      setError(err.message);
    } finally {
      setClassifyingId(null);
    }
  }

  const playerCharacters = characters?.filter((c) => c.kind !== 'boss') ?? [];
  const dmCharacters = characters?.filter((c) => c.kind === 'boss') ?? [];

  function characterCard(c, { dm = false } = {}) {
    const category = dm ? dmCategory(c) : null;
    return (
      <li
        key={c.id}
        className="group overflow-hidden rounded-md border border-ink/20 bg-parchment-100/70 shadow-sm transition-shadow hover:shadow-md"
      >
        <Link
          to={c.status === 'draft' ? `/personajes/${c.id}/asistente` : `/personajes/${c.id}`}
          className="flex gap-3 p-4"
        >
          <AvatarBadge character={c} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-ink">{c.name}</span>
              {dm && (
                <span
                  className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-xs ${DM_CATEGORY_STYLES[category]}`}
                >
                  {DM_CATEGORY_LABELS[category]}
                </span>
              )}
              {c.status === 'draft' ? (
                <span className="shrink-0 rounded-sm border border-ochre/50 bg-ochre/10 px-1.5 py-0.5 font-mono text-xs text-ochre">
                  Borrador
                </span>
              ) : (
                <span className="shrink-0 font-mono text-sm text-ink/60">nv. {c.level}</span>
              )}
            </div>
            {c.status === 'draft' ? (
              <p className="mt-1 text-sm italic text-ink/70">Continúa la creación guiada donde la dejaste.</p>
            ) : (
              <>
                <p className="mt-0.5 truncate text-sm text-ink/70">
                  {dm ? 'Ficha completa del DM' : CLASS_NAMES[c.class_index] ?? 'Sin clase'}
                  {!dm && raceNames[c.race_index] ? ` · ${raceNames[c.race_index]}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <HpBar current={c.hp_current} max={c.hp_max} />
                  <span className="rounded-sm border border-ink/20 px-1.5 py-0.5 font-mono text-xs text-ink/70">
                    CA {c.ac}
                  </span>
                </div>
              </>
            )}
          </div>
        </Link>
        {dm && (
          <div className="flex items-center gap-2 border-t border-ink/10 px-3 py-2">
            <label className="text-xs text-ink/55" htmlFor={`dm-category-${c.id}`}>
              Organizar como
            </label>
            <select
              id={`dm-category-${c.id}`}
              value={category}
              disabled={classifyingId === c.id}
              onChange={(e) => classifyDmCharacter(c, e.target.value)}
              className="min-w-0 flex-1 rounded-sm border border-ink/20 bg-parchment-100 px-2 py-1 text-xs text-ink focus:border-ember focus:outline-none disabled:opacity-40"
            >
              <option value="enemigo">Enemigo</option>
              <option value="pnj">PNJ</option>
              <option value="jefe">Jefe</option>
            </select>
          </div>
        )}
        <button
          onClick={() => deleteCharacter(c)}
          className="w-full border-t border-ink/10 py-1 text-xs text-ink/40 opacity-0 transition-opacity hover:text-ember group-hover:opacity-100"
        >
          {c.status === 'draft' ? 'Descartar borrador' : dm ? 'Retirar ficha del DM' : 'Retirar personaje'}
        </button>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold text-ink">Personajes y criaturas</h2>
        <div className="flex gap-2">
          <Link
            to="/biblioteca"
            title="Tus objetos y hechizos propios, reutilizables en cualquier campaña"
            className="rounded-sm border border-ink/30 px-4 py-2 font-display tracking-wide text-ink hover:bg-ink/5"
          >
            Biblioteca
          </Link>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-ember">{error}</p>}
      {characters === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : (
        <div className="space-y-10">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">Personajes jugadores</h3>
                <p className="text-sm text-ink/55">Aventureros que pertenecen a un jugador.</p>
              </div>
              <button
                onClick={() => createCharacter('pj')}
                disabled={creating}
                className="rounded-sm bg-ember px-4 py-2 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
              >
                + Crear personaje
              </button>
            </div>
            {playerCharacters.length === 0 ? (
              <p className="rounded-md border border-dashed border-ink/20 p-4 text-sm italic text-ink/55">
                Aún no tienes personajes jugadores.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">{playerCharacters.map((c) => characterCard(c))}</ul>
            )}
          </section>

          <section>
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">PNJ y enemigos</h3>
                <p className="text-sm text-ink/55">
                  Fichas completas controladas por el DM, separadas de los personajes jugadores.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => createCharacter('boss', 'enemigo')}
                  disabled={creating}
                  className="rounded-sm border border-blood/40 px-3 py-2 font-display text-sm tracking-wide text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  + Enemigo
                </button>
                <button
                  onClick={() => createCharacter('boss', 'pnj')}
                  disabled={creating}
                  className="rounded-sm border border-moss/40 px-3 py-2 font-display text-sm tracking-wide text-moss hover:bg-moss/10 disabled:opacity-40"
                >
                  + PNJ
                </button>
                <button
                  onClick={() => createCharacter('boss', 'jefe')}
                  disabled={creating}
                  className="rounded-sm border border-ochre/40 px-3 py-2 font-display text-sm tracking-wide text-ochre hover:bg-ochre/10 disabled:opacity-40"
                >
                  + Jefe
                </button>
              </div>
            </div>
            {dmCharacters.length === 0 ? (
              <p className="rounded-md border border-dashed border-ink/20 p-4 text-sm italic text-ink/55">
                Aún no tienes PNJ, enemigos ni jefes con ficha propia.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {dmCharacters.map((c) => characterCard(c, { dm: true }))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
