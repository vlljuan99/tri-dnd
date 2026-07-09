import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CLASS_NAMES } from '../lib/dnd.js';

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
  const [raceNames, setRaceNames] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    api('/characters').then(({ characters }) => setCharacters(characters)).catch((e) => setError(e.message));
    // Traducciones de raza del compendio, igual que en la ficha completa
    api('/srd/races')
      .then(({ results }) => setRaceNames(Object.fromEntries(results.map((r) => [r.index, r.name]))))
      .catch(() => {});
  }, []);

  async function createCharacter(kind = 'pj') {
    setCreating(true);
    try {
      // El PJ nace como borrador: el asistente guiado se encarga de
      // completarlo paso a paso, nunca se abre una ficha vacía directamente.
      // Un jefe no pasa por el asistente (no elige clase/raza del SRD): va
      // directo a la ficha completa para que el DM rellene sus stats.
      const { character } = await api('/characters', { method: 'POST', body: { kind } });
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-3xl font-semibold text-ink">Tus personajes</h2>
        <div className="flex gap-2">
          <button
            onClick={() => createCharacter('pj')}
            disabled={creating}
            className="rounded-sm bg-ember px-4 py-2 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
          >
            + Crear personaje
          </button>
          <button
            onClick={() => createCharacter('boss')}
            disabled={creating}
            title="Ficha completa para un enemigo importante: la usa el DM en el mapa"
            className="rounded-sm border border-ink/30 px-4 py-2 font-display tracking-wide text-ink hover:bg-ink/5 disabled:opacity-40"
          >
            + Crear jefe
          </button>
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
      ) : characters.length === 0 ? (
        <p className="italic text-ink/60">Aún no tienes personajes. Crea el primero para empezar la aventura.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {characters.map((c) => (
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
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-lg font-semibold text-ink">{c.name}</span>
                    {c.kind === 'boss' && (
                      <span className="shrink-0 rounded-sm border border-blood/50 bg-blood/10 px-1.5 py-0.5 font-mono text-xs text-blood">
                        Jefe
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
                        {CLASS_NAMES[c.class_index] ?? 'Sin clase'}
                        {raceNames[c.race_index] ? ` · ${raceNames[c.race_index]}` : ''}
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
              <button
                onClick={() => deleteCharacter(c)}
                className="w-full border-t border-ink/10 py-1 text-xs text-ink/40 opacity-0 transition-opacity hover:text-ember group-hover:opacity-100"
              >
                {c.status === 'draft' ? 'Descartar borrador' : 'Retirar personaje'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
