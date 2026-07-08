import { useEffect, useState } from 'react';
import { api } from '../../../api.js';

const inputClass =
  'w-full rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-sm text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none';

function emptyDraft() {
  return { title: '', sessionDate: '', body: '' };
}

/**
 * Diario de sesión privado del jugador (Fase 8.6): varias notas con título y
 * fecha de sesión, ligadas a tu propio personaje de esta campaña. Ni el DM
 * ni otros jugadores las ven — el servidor las filtra por dueño sin
 * excepción, así que este panel solo tiene sentido para tu propio personaje.
 */
export default function NotesPanel({ characterId, onClose }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null); // null | 'new' | id
  const [draft, setDraft] = useState(emptyDraft());

  useEffect(() => {
    api(`/characters/${characterId}/notas`)
      .then(({ notes }) => setNotes(notes))
      .catch((e) => setError(e.message || 'No se pudieron cargar las notas.'));
  }, [characterId]);

  function startNew() {
    setDraft(emptyDraft());
    setEditingId('new');
  }

  function startEdit(note) {
    setDraft({ title: note.title, sessionDate: note.sessionDate, body: note.body });
    setEditingId(note.id);
  }

  async function save() {
    setError('');
    try {
      if (editingId === 'new') {
        const { note } = await api(`/characters/${characterId}/notas`, { method: 'POST', body: draft });
        setNotes((n) => [note, ...n]);
      } else {
        const { note } = await api(`/characters/${characterId}/notas/${editingId}`, {
          method: 'PUT',
          body: draft,
        });
        setNotes((n) => n.map((existing) => (existing.id === note.id ? note : existing)));
      }
      setEditingId(null);
    } catch (e) {
      setError(e.message || 'No se pudo guardar la nota.');
    }
  }

  async function remove(noteId) {
    if (!window.confirm('¿Borrar esta nota?')) return;
    try {
      await api(`/characters/${characterId}/notas/${noteId}`, { method: 'DELETE' });
      setNotes((n) => n.filter((note) => note.id !== noteId));
    } catch (e) {
      setError(e.message || 'No se pudo borrar la nota.');
    }
  }

  return (
    <div className="absolute bottom-20 left-1/2 z-20 w-[26rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-gold/30 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-display text-sm tracking-wide text-gold">Tus notas de sesión</p>
        <button onClick={onClose} aria-label="Cerrar notas" className="px-1 text-bone/60 hover:text-bone">
          ✕
        </button>
      </div>
      <p className="mb-2 text-[0.65rem] text-bone/40">Privadas: ni el DM ni el resto del grupo las ven.</p>

      {error && <p className="mb-2 text-xs text-blood">{error}</p>}

      {editingId ? (
        <div className="space-y-1.5">
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Título"
            className={inputClass}
          />
          <input
            value={draft.sessionDate}
            onChange={(e) => setDraft((d) => ({ ...d, sessionDate: e.target.value }))}
            placeholder="Fecha de sesión (ej. 2026-07-08)"
            className={inputClass}
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={5}
            placeholder="Qué pasó en la sesión..."
            className={`${inputClass} resize-none`}
          />
          <div className="flex gap-1.5">
            <button
              onClick={save}
              className="flex-1 rounded-sm bg-gold py-1.5 font-display text-xs tracking-wide text-night-950 hover:bg-gold/90"
            >
              Guardar
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="rounded-sm border border-bone/20 px-3 text-xs text-bone/60 hover:text-bone"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startNew}
          className="mb-2 w-full rounded-sm border border-gold/40 py-1.5 text-xs text-gold hover:bg-gold/10"
        >
          + Nueva nota
        </button>
      )}

      {notes === null && !error && <p className="text-sm text-bone/50">Cargando…</p>}
      {notes?.length === 0 && !editingId && (
        <p className="text-sm text-bone/50">Aún no tienes notas. Escribe la primera.</p>
      )}

      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {notes
          ?.filter((n) => n.id !== editingId)
          .map((note) => (
            <div key={note.id} className="rounded-sm border border-bone/10 bg-night-950/60 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-display text-sm text-bone">
                  {note.title || 'Sin título'}
                </span>
                <span className="shrink-0 font-mono text-xs text-bone/40">{note.sessionDate}</span>
              </div>
              {note.body && <p className="mt-1 whitespace-pre-wrap text-xs text-bone/70">{note.body}</p>}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => startEdit(note)}
                  className="rounded-sm border border-bone/20 px-2 py-0.5 text-xs text-bone/60 hover:text-bone"
                >
                  Editar
                </button>
                <button
                  onClick={() => remove(note.id)}
                  className="rounded-sm border border-blood/30 px-2 py-0.5 text-xs text-blood/80 hover:bg-blood/10"
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
