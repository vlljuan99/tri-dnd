import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CLASS_NAMES } from '../lib/dnd.js';

export default function CharactersPage() {
  const [characters, setCharacters] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api('/characters').then(({ characters }) => setCharacters(characters)).catch((e) => setError(e.message));
  }, []);

  async function createCharacter() {
    setCreating(true);
    try {
      // El personaje nace como borrador: el asistente guiado se encarga de
      // completarlo paso a paso, nunca se abre una ficha vacía directamente.
      const { character } = await api('/characters', { method: 'POST', body: {} });
      navigate(`/personajes/${character.id}/asistente`);
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
        <button
          onClick={createCharacter}
          disabled={creating}
          className="rounded-sm bg-ember px-4 py-2 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40"
        >
          + Crear personaje
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-ember">{error}</p>}
      {characters === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : characters.length === 0 ? (
        <p className="italic text-ink/60">Aún no tienes personajes. Crea el primero para empezar la aventura.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {characters.map((c) => (
            <li key={c.id} className="group rounded-md border border-ink/20 bg-parchment-100/70 shadow-sm transition-shadow hover:shadow-md">
              <Link to={c.status === 'draft' ? `/personajes/${c.id}/asistente` : `/personajes/${c.id}`} className="block p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-lg font-semibold text-ink">{c.name}</span>
                  {c.status === 'draft' ? (
                    <span className="rounded-sm border border-ochre/50 bg-ochre/10 px-1.5 py-0.5 font-mono text-xs text-ochre">
                      Borrador
                    </span>
                  ) : (
                    <span className="font-mono text-sm text-ink/60">nv. {c.level}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink/70">
                  {c.status === 'draft'
                    ? 'Continúa la creación guiada donde la dejaste.'
                    : `${CLASS_NAMES[c.class_index] ?? 'Sin clase'} · HP ${c.hp_current}/${c.hp_max} · CA ${c.ac}`}
                </p>
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
