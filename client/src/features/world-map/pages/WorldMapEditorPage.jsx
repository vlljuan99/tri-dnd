import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useWorldMap } from '../hooks/useWorldMap.js';
import LocationPanel from '../components/LocationPanel.jsx';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Editor del mapa de mundo (solo DM): sube o genera una imagen de región y
// coloca ubicaciones (puntos de interés) clicando sobre ella. Cada ubicación
// se enlaza a un mapa jugable de la biblioteca; el grupo "viaja" a ellas desde
// la mesa. Colocación por click y recolocación por arrastre, en % sobre la
// imagen (independiente del tamaño de render).
export default function WorldMapEditorPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const [campaign, setCampaign] = useState(null);
  const [campaignError, setCampaignError] = useState('');

  const editor = useWorldMap(campaignId);
  const { world, maps, busy, error } = editor;

  const [selectedId, setSelectedId] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null); // { locId } mientras se arrastra un pin

  useEffect(() => {
    api(`/campaigns/${campaignId}`)
      .then(({ campaign: loaded }) => setCampaign(loaded))
      .catch((e) => setCampaignError(e.message));
  }, [campaignId]);

  const locations = world?.locations ?? [];
  const selected = locations.find((l) => l.id === selectedId) ?? null;

  // Convierte un evento de puntero a coordenadas en % sobre la imagen
  function pointToPercent(e) {
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
  }

  async function placePin(e) {
    if (dragRef.current) return; // no crear al soltar un arrastre
    const { x, y } = pointToPercent(e);
    await editor.createLocation({ x, y });
  }

  function onPinPointerDown(e, loc) {
    e.stopPropagation();
    setSelectedId(loc.id);
    dragRef.current = { locId: loc.id, moved: false };
    e.target.setPointerCapture?.(e.pointerId);
  }

  function onImagePointerMove(e) {
    if (!dragRef.current) return;
    dragRef.current.moved = true;
    const { x, y } = pointToPercent(e);
    // Movimiento visual optimista: reposiciona el pin en el DOM mientras se arrastra
    const pin = document.getElementById(`pin-${dragRef.current.locId}`);
    if (pin) {
      pin.style.left = `${x}%`;
      pin.style.top = `${y}%`;
    }
  }

  async function onImagePointerUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) return; // fue un click simple sobre el pin, no un arrastre
    const { x, y } = pointToPercent(e);
    await editor.updateLocation(drag.locId, { x, y });
  }

  if (campaignError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">{campaignError}</p>
        <Link to="/" className="text-gold underline">Volver al hub</Link>
      </div>
    );
  }
  if (!campaign || !world) {
    return (
      <div className="flex h-full items-center justify-center bg-night-950 text-bone">
        <p className="font-display text-lg text-gold">Cargando mapa de mundo…</p>
      </div>
    );
  }
  if (campaign.role !== 'dm') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">Solo el DM puede editar el mapa de mundo.</p>
        <Link to={`/campanas/${campaignId}`} className="text-gold underline">Volver a la mesa</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to={`/campanas/${campaignId}`}
            className="rounded-sm border border-gold/25 px-2.5 py-1 font-display text-sm text-gold/80 hover:border-gold hover:text-gold"
          >
            ← Mesa
          </Link>
          <h1 className="font-display text-xl tracking-wide text-gold">Mapa de mundo — {campaign.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          {busy && <span className="text-xs text-bone/50">Guardando…</span>}
          <Link to={`/campanas/${campaignId}/editor`} className="text-xs text-gold/70 underline hover:text-gold">
            Editor de mapas
          </Link>
        </div>
      </header>

      {error && <p className="bg-blood/10 px-4 py-1.5 text-sm text-blood">{error}</p>}

      <div className="flex min-h-0 flex-1">
        {/* Lienzo del mundo */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto p-4">
          {world.worldMapUrl ? (
            <div
              className="relative max-h-full max-w-full select-none"
              onPointerMove={onImagePointerMove}
              onPointerUp={onImagePointerUp}
            >
              <img
                ref={imageRef}
                src={world.worldMapUrl}
                alt="Mapa de mundo"
                onClick={placePin}
                className="max-h-[calc(100vh-8rem)] w-auto cursor-crosshair rounded-md border border-gold/20"
                draggable={false}
              />
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  id={`pin-${loc.id}`}
                  type="button"
                  onPointerDown={(e) => onPinPointerDown(e, loc)}
                  style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-full cursor-grab active:cursor-grabbing`}
                  title={loc.name}
                >
                  <span className="flex flex-col items-center">
                    <span
                      className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[0.65rem] font-display tracking-wide ${
                        loc.id === selectedId
                          ? 'bg-gold text-night-950'
                          : 'bg-night-900/90 text-gold border border-gold/40'
                      }`}
                    >
                      {loc.name}
                    </span>
                    <span
                      className={`h-3 w-3 rotate-45 border ${
                        loc.id === selectedId ? 'border-gold bg-gold' : 'border-gold/60 bg-blood'
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center text-bone/50">
              <p className="font-display text-lg">Aún no hay imagen de mundo.</p>
              <p className="text-sm">Sube o genera una en el panel de la derecha para empezar a colocar ubicaciones.</p>
            </div>
          )}
          {world.worldMapUrl && (
            <p className="mt-3 text-xs text-bone/40">
              Haz clic en el mapa para colocar una ubicación. Arrastra un pin para recolocarlo.
            </p>
          )}
        </div>

        {/* Panel derecho: imagen + ubicación seleccionada */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gold/20 bg-night-900">
          <div className="space-y-3 border-b border-gold/15 p-3">
            <p className={labelClass}>Imagen del mundo</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex-1 rounded-sm border border-gold/30 px-2 py-1.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
              >
                Subir imagen
              </button>
              {world.worldMapUrl && (
                <button
                  type="button"
                  onClick={() => editor.removeImage()}
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
                if (file) editor.uploadImage(file);
                e.target.value = '';
              }}
            />
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim()) editor.generateImage({ prompt: prompt.trim(), provider });
              }}
            >
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe el mundo/región para generarlo con IA…"
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

          <div className="p-3">
            {selected ? (
              <LocationPanel
                key={selected.id}
                location={selected}
                maps={maps}
                busy={busy}
                onSave={(fields) => editor.updateLocation(selected.id, fields)}
                onDelete={() => {
                  if (window.confirm(`¿Borrar la ubicación "${selected.name}"?`)) {
                    editor.deleteLocation(selected.id);
                    setSelectedId(null);
                  }
                }}
              />
            ) : (
              <p className="text-sm text-bone/50">
                {locations.length
                  ? 'Selecciona una ubicación en el mapa para editarla.'
                  : 'Coloca tu primera ubicación haciendo clic en el mapa.'}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
