import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const CLASS_NAMES = {
  barbarian: 'Bárbaro', bard: 'Bardo', cleric: 'Clérigo', druid: 'Druida',
  fighter: 'Guerrero', monk: 'Monje', paladin: 'Paladín', ranger: 'Explorador',
  rogue: 'Pícaro', sorcerer: 'Hechicero', warlock: 'Brujo', wizard: 'Mago',
};

export default function CharactersPage() {
  const [characters, setCharacters] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/characters').then(({ characters }) => setCharacters(characters)).catch((e) => setError(e.message));
  }, []);

  async function createCharacter(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const { character } = await api('/characters', { method: 'POST', body: { name: newName } });
      setCharacters((cs) => [character, ...(cs ?? [])]);
      setNewName('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCharacter(character) {
    if (!window.confirm(`¿Retirar a ${character.name} para siempre?`)) return;
    await api(`/characters/${character.id}`, { method: 'DELETE' });
    setCharacters((cs) => cs.filter((c) => c.id !== character.id));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h2 className="mb-6 font-display text-3xl font-semibold text-ink">Tus personajes</h2>

      <form onSubmit={createCharacter} className="mb-6 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nombre del nuevo héroe"
          required
          className="flex-1 rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-ink placeholder:text-ink/40 focus:border-ochre focus:outline-none"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="rounded-sm bg-ember px-4 font-display tracking-wide text-parchment-100 hover:bg-ember/90 disabled:opacity-40 disabled:hover:bg-ember"
        >
          Crear
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-ember">{error}</p>}
      {characters === null ? (
        <p className="text-ink/60">Cargando…</p>
      ) : characters.length === 0 ? (
        <p className="italic text-ink/60">Aún no tienes personajes. Crea el primero para empezar la aventura.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {characters.map((c) => (
            <li key={c.id} className="group rounded-md border border-ink/20 bg-parchment-100/70 shadow-sm transition-shadow hover:shadow-md">
              <Link to={`/personajes/${c.id}`} className="block p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-lg font-semibold text-ink">{c.name}</span>
                  <span className="font-mono text-sm text-ink/60">nv. {c.level}</span>
                </div>
                <p className="mt-1 text-sm text-ink/70">
                  {CLASS_NAMES[c.class_index] ?? 'Sin clase'} · HP {c.hp_current}/{c.hp_max} · CA {c.ac}
                </p>
              </Link>
              <button
                onClick={() => deleteCharacter(c)}
                className="w-full border-t border-ink/10 py-1 text-xs text-ink/40 opacity-0 transition-opacity hover:text-ember group-hover:opacity-100"
              >
                Retirar personaje
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
