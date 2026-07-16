import { useEffect, useRef, useState } from 'react';
import GridCalibrationModal from './GridCalibrationModal.jsx';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Panel lateral de la sala seleccionada: datos, revelado, notas, imagen y borrado
export default function RoomPanel({
  room,
  busy,
  onPatch,
  onDelete,
  onSaveTemplate,
  onUploadImage,
  onGenerateImage,
  onRemoveImage,
}) {
  const [form, setForm] = useState(room);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  // Imagen elegida pendiente de calibrar su cuadrícula antes de subirla
  const [pendingFile, setPendingFile] = useState(null);
  const fileRef = useRef(null);

  // Al cambiar de sala seleccionada se descartan los cambios sin guardar
  useEffect(() => setForm(room), [room]);

  function field(name, parse = (v) => v) {
    return {
      value: form[name] ?? '',
      onChange: (e) => setForm((f) => ({ ...f, [name]: parse(e.target.value) })),
    };
  }

  function save() {
    const numeric = ['x', 'y', 'width', 'height'];
    if (numeric.some((k) => !Number.isInteger(form[k]))) return;
    onPatch(room.id, {
      name: form.name,
      x: form.x,
      y: form.y,
      width: form.width,
      height: form.height,
      notes: form.notes,
    });
  }

  const toInt = (v) => (v === '' || v === '-' ? v : Number.parseInt(v, 10));

  // Imagen calibrada: se sube el recorte alineado y la sala pasa a medir las
  // casillas reales de la imagen, para que ambas cuadrículas coincidan 1:1
  async function handleCalibrated({ blob, cols, rows }) {
    try {
      const upload = new File([blob], 'suelo.webp', { type: 'image/webp' });
      await onUploadImage(room.id, upload);
      await onPatch(room.id, { width: cols, height: rows });
    } catch {
      // el error ya se muestra en el banner del editor
    }
    setPendingFile(null);
  }

  async function handleUploadOriginal() {
    try {
      await onUploadImage(room.id, pendingFile);
    } catch {
      // el error ya se muestra en el banner del editor
    }
    setPendingFile(null);
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <label className={labelClass} htmlFor="room-name">Nombre</label>
        <input id="room-name" className={inputClass} {...field('name')} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="room-w">Ancho (casillas)</label>
          <input id="room-w" type="number" min={1} max={100} className={inputClass} {...field('width', toInt)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="room-h">Alto (casillas)</label>
          <input id="room-h" type="number" min={1} max={100} className={inputClass} {...field('height', toInt)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="room-x">Posición X</label>
          <input id="room-x" type="number" className={inputClass} {...field('x', toInt)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="room-y">Posición Y</label>
          <input id="room-y" type="number" className={inputClass} {...field('y', toInt)} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="room-notes">Notas del DM (los jugadores no las ven)</label>
        <textarea id="room-notes" rows={3} className={inputClass} {...field('notes')} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-sm bg-gold/80 px-3 py-1.5 font-display text-sm text-night-950 hover:bg-gold disabled:opacity-40"
        >
          Guardar cambios
        </button>
        <button
          type="button"
          onClick={() => onPatch(room.id, { revealed: !room.revealed })}
          disabled={busy}
          className={`flex-1 rounded-sm border px-3 py-1.5 font-display text-sm disabled:opacity-40 ${
            room.revealed
              ? 'border-sage/60 text-sage hover:bg-sage/10'
              : 'border-bone/30 text-bone/70 hover:bg-bone/5'
          }`}
        >
          {room.revealed ? 'Revelada ✓' : 'Oculta — revelar'}
        </button>
      </div>

      <div className="border-t border-gold/15 pt-3">
        <p className={labelClass}>Suelo de la sala</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex-1 rounded-sm border border-gold/30 px-2 py-1.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Subir imagen
          </button>
          {room.backgroundUrl && (
            <button
              type="button"
              onClick={() => onRemoveImage(room.id)}
              disabled={busy}
              className="rounded-sm border border-blood/40 px-2 py-1.5 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
            >
              Quitar
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setPendingFile(file);
            e.target.value = '';
          }}
        />
        {pendingFile && (
          <GridCalibrationModal
            file={pendingFile}
            busy={busy}
            onCancel={() => setPendingFile(null)}
            onConfirm={handleCalibrated}
            onUploadOriginal={handleUploadOriginal}
          />
        )}
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) onGenerateImage(room.id, { prompt: prompt.trim(), provider });
          }}
        >
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe la sala para generar el suelo con IA…"
            className={inputClass}
          />
          <div className="flex gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
            </select>
            <button
              type="submit"
              disabled={busy || !prompt.trim()}
              className="shrink-0 rounded-sm border border-gold/30 px-3 py-1.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
            >
              Generar
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-2 border-t border-gold/15 pt-3">
        {onSaveTemplate && (
          <button
            type="button"
            onClick={() => onSaveTemplate(room.id)}
            disabled={busy}
            className="w-full rounded-sm border border-gold/30 px-3 py-1.5 font-display text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
            title="Guarda la sala (capas, suelo y marcadores) en tu biblioteca, reutilizable en cualquier campaña"
          >
            Guardar sala en biblioteca
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`¿Borrar la sala "${room.name}" y sus puertas?`)) onDelete(room.id);
          }}
          disabled={busy}
          className="w-full rounded-sm border border-blood/40 px-3 py-1.5 font-display text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
        >
          Borrar sala
        </button>
      </div>
    </div>
  );
}
