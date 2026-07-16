import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useWorldMap } from '../hooks/useWorldMap.js';
import LocationPanel from '../components/LocationPanel.jsx';
import { kindGlyph } from '../kinds.js';

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Cadena de migas desde el raíz hasta el mapa en edición, siguiendo los pins
// padre (el mundo es un árbol: cada submapa cuelga del pin que salta a él)
function breadcrumbFor(world, mapId) {
  const chain = [];
  let cursor = world.maps.find((m) => m.id === mapId);
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parent ? world.maps.find((m) => m.id === cursor.parent.mapId) : null;
  }
  return chain;
}

// Editor del mapa de mundo (solo DM): sube o genera una imagen de región y
// coloca ubicaciones (puntos de interés) clicando sobre ella. Cada ubicación
// tiene un tipo (dungeon/ciudad/campamento/evento): un dungeon enlaza un mapa
// jugable de la biblioteca y una ciudad salta a un submapa con sus propios
// pins (capa intermedia opcional). El breadcrumb navega entre capas.
// Colocación por click y recolocación por arrastre, en % sobre la imagen.
export default function WorldMapEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const campaignId = Number(id);
  const [campaign, setCampaign] = useState(null);
  const [campaignError, setCampaignError] = useState('');

  const editor = useWorldMap(campaignId);
  const { world, maps, busy, error } = editor;

  const [editingMapId, setEditingMapId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  const [estilo, setEstilo] = useState('region');
  const [mapName, setMapName] = useState('');
  const [cityTemplates, setCityTemplates] = useState([]); // biblioteca de plantillas (v35)
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null); // { locId } mientras se arrastra un pin

  useEffect(() => {
    api(`/campaigns/${campaignId}`)
      .then(({ campaign: loaded }) => setCampaign(loaded))
      .catch((e) => setCampaignError(e.message));
  }, [campaignId]);

  const reloadTemplates = () => {
    api('/plantillas?tipo=ciudad')
      .then(({ templates }) => setCityTemplates(templates))
      .catch(() => {});
  };
  useEffect(reloadTemplates, []);

  async function saveCityTemplate() {
    try {
      const { template: saved } = await editor.saveCityTemplate(editingMap.id);
      setNotice(`«${saved.name}» guardada en tu biblioteca como plantilla de ciudad.`);
      reloadTemplates();
    } catch (e) {
      setNotice(e.message || 'No se pudo guardar la plantilla');
    }
    setTimeout(() => setNotice(''), 4000);
  }

  async function applyCityTemplate(templateId) {
    const template = cityTemplates.find((item) => item.id === templateId);
    if (!template || !editingMap) return;
    const layerLabel = editingMap.isRoot ? 'la región raíz' : 'esta ciudad';
    const confirmed = window.confirm(
      `¿Aplicar «${template.name}» sobre ${layerLabel} «${editingMap.name}»?\n\n` +
        'Se sustituirán la imagen y todas las ubicaciones de esta capa. Los tableros tácticos y ' +
        'submapas anteriores no se borrarán, pero dejarán de estar enlazados desde aquí.'
    );
    if (!confirmed) return;

    try {
      await editor.applyCityTemplate(editingMap.id, template.id);
      setNotice(`«${template.name}» aplicada sobre ${layerLabel}.`);
    } catch (e) {
      setNotice(e.message || 'No se pudo aplicar la plantilla');
    }
    setTimeout(() => setNotice(''), 5000);
  }

  // Mapa en edición: empieza en el raíz; si el mapa editado desaparece
  // (submapa borrado), vuelta al raíz
  const editingMap =
    world?.maps.find((m) => m.id === editingMapId) ??
    world?.maps.find((m) => m.id === world.rootMapId) ??
    null;

  useEffect(() => {
    if (world && editingMap && editingMapId !== editingMap.id) setEditingMapId(editingMap.id);
  }, [world, editingMap, editingMapId]);

  // El estilo de IA sugerido sigue a la capa: raíz = región, submapa = ciudad
  useEffect(() => {
    setEstilo(editingMap && !editingMap.isRoot ? 'ciudad' : 'region');
    setSelectedId(null);
  }, [editingMap?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aplicar una plantilla conserva el id de la capa pero puede cambiar su
  // nombre, por eso este campo también se sincroniza cuando cambia el nombre.
  useEffect(() => {
    setMapName(editingMap?.name ?? '');
  }, [editingMap?.id, editingMap?.name]);

  const locations = editingMap?.locations ?? [];
  const selected = locations.find((l) => l.id === selectedId) ?? null;
  const breadcrumb = world && editingMap ? breadcrumbFor(world, editingMap.id) : [];

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
    await editor.createLocation({ mapId: editingMap.id, x, y });
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

  async function deleteSubmap() {
    if (!editingMap || editingMap.isRoot) return;
    if (!window.confirm(`¿Borrar el submapa "${editingMap.name}" y todas sus ubicaciones?`)) return;
    const parentId = editingMap.parent?.mapId ?? world.rootMapId;
    await editor.deleteMap(editingMap.id);
    setEditingMapId(parentId);
  }

  if (campaignError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">{campaignError}</p>
        <Link to="/" className="text-gold underline">Volver al hub</Link>
      </div>
    );
  }
  if (!campaign || !world || !editingMap) {
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

      {/* Migas de navegación entre capas (raíz › ciudad › …) */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gold/10 bg-night-900/60 px-4 py-1.5 text-sm">
        {breadcrumb.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1">
            {i > 0 && <span className="text-bone/30">›</span>}
            {m.id === editingMap.id ? (
              <span className="font-display tracking-wide text-gold">{m.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => setEditingMapId(m.id)}
                className="text-bone/60 underline decoration-bone/30 hover:text-gold"
              >
                {m.name}
              </button>
            )}
          </span>
        ))}
        {!editingMap.isRoot && (
          <span className="ml-2 rounded-sm border border-gold/20 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-widest text-bone/50">
            Submapa
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Lienzo del mundo */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto p-4">
          {editingMap.imageUrl ? (
            <div
              className="relative max-h-full max-w-full select-none"
              onPointerMove={onImagePointerMove}
              onPointerUp={onImagePointerUp}
            >
              <img
                ref={imageRef}
                src={editingMap.imageUrl}
                alt={editingMap.name}
                onClick={placePin}
                className="max-h-[calc(100vh-11rem)] w-auto cursor-crosshair rounded-md border border-gold/20"
                draggable={false}
              />
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  id={`pin-${loc.id}`}
                  type="button"
                  onPointerDown={(e) => onPinPointerDown(e, loc)}
                  onDoubleClick={() => {
                    if (loc.targetMapId) setEditingMapId(loc.targetMapId);
                    else if (loc.mapId) navigate(`/campanas/${campaignId}/editor?mapa=${loc.mapId}`);
                  }}
                  style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-full cursor-grab active:cursor-grabbing ${
                    loc.hidden ? 'opacity-50' : ''
                  }`}
                  title={loc.hidden ? `${loc.name} (oculta para los jugadores)` : loc.name}
                >
                  <span className="flex flex-col items-center">
                    <span
                      className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[0.65rem] font-display tracking-wide ${
                        loc.id === selectedId
                          ? 'bg-gold text-night-950'
                          : 'bg-night-900/90 text-gold border border-gold/40'
                      }`}
                    >
                      {kindGlyph(loc.kind)} {loc.name}
                      {loc.hidden && ' 👁'}
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
              <p className="font-display text-lg">
                {editingMap.isRoot ? 'Aún no hay imagen de mundo.' : `Aún no hay imagen para "${editingMap.name}".`}
              </p>
              <p className="text-sm">Sube o genera una en el panel de la derecha para empezar a colocar ubicaciones.</p>
            </div>
          )}
          {editingMap.imageUrl && (
            <p className="mt-3 text-xs text-bone/40">
              Haz clic en el mapa para colocar una ubicación. Arrastra un pin para recolocarlo. Doble clic en un pin de
              ciudad para entrar en su submapa, o en otra ubicación para abrir su tablero.
            </p>
          )}
        </div>

        {/* Panel derecho: mapa en edición + ubicación seleccionada */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gold/20 bg-night-900">
          {!editingMap.isRoot && (
            <div className="space-y-2 border-b border-gold/15 p-3">
              <p className={labelClass}>Submapa</p>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={mapName}
                  onChange={(e) => setMapName(e.target.value)}
                  onBlur={() => {
                    if (mapName.trim() && mapName.trim() !== editingMap.name) {
                      editor.renameMap(editingMap.id, mapName.trim());
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={deleteSubmap}
                  disabled={busy}
                  className="shrink-0 rounded-sm border border-blood/40 px-2 py-1 text-xs text-blood hover:bg-blood/10 disabled:opacity-40"
                >
                  Borrar
                </button>
              </div>
              {editingMap.parent && (
                <p className="text-[0.7rem] text-bone/40">
                  Cuelga del pin «{editingMap.parent.locationName}».
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 border-b border-gold/15 p-3">
            <button
              type="button"
              onClick={saveCityTemplate}
              disabled={busy}
              className="w-full rounded-sm border border-gold/30 px-2 py-1.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
              title="Guarda esta capa (imagen, pins, tableros enlazados y submapas anidados) como plantilla de ciudad reutilizable en cualquier campaña"
            >
              Guardar en biblioteca (región / ciudad)
            </button>
            <label className={labelClass} htmlFor="apply-city-template">
              Restaurar esta capa desde plantilla
            </label>
            <select
              id="apply-city-template"
              value=""
              disabled={busy || cityTemplates.length === 0}
              onChange={(e) => {
                const templateId = Number(e.target.value);
                if (templateId) applyCityTemplate(templateId);
              }}
              className={inputClass}
              title="Sustituye la imagen y los pins de esta capa conservando su id"
            >
              <option value="">
                {cityTemplates.length ? 'Aplicar / restaurar plantilla…' : 'No hay plantillas guardadas'}
              </option>
              {cityTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.meta?.pins ?? 0} pins)
                </option>
              ))}
            </select>
            {notice && <p className="text-[0.7rem] text-sage">{notice}</p>}
          </div>

          <div className="space-y-3 border-b border-gold/15 p-3">
            <p className={labelClass}>Imagen de {editingMap.isRoot ? 'mundo' : 'este submapa'}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex-1 rounded-sm border border-gold/30 px-2 py-1.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
              >
                Subir imagen
              </button>
              {editingMap.imageUrl && (
                <button
                  type="button"
                  onClick={() => editor.removeImage(editingMap.id)}
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
                if (file) editor.uploadImage(editingMap.id, file);
                e.target.value = '';
              }}
            />
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim()) {
                  editor.generateImage(editingMap.id, { prompt: prompt.trim(), provider, estilo });
                }
              }}
            >
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  estilo === 'ciudad'
                    ? 'Describe la ciudad para generarla con IA…'
                    : 'Describe el mundo/región para generarlo con IA…'
                }
                className={inputClass}
              />
              <div className="flex gap-2">
                <select value={estilo} onChange={(e) => setEstilo(e.target.value)} className={inputClass}>
                  <option value="region">Región</option>
                  <option value="ciudad">Ciudad</option>
                </select>
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
                campaignId={campaignId}
                location={selected}
                maps={maps}
                worldMaps={world.maps}
                cityTemplates={cityTemplates}
                busy={busy}
                onSave={(fields) => editor.updateLocation(selected.id, fields)}
                onDelete={() => {
                  if (window.confirm(`¿Borrar la ubicación "${selected.name}"?`)) {
                    editor.deleteLocation(selected.id);
                    setSelectedId(null);
                  }
                }}
                onCreateSubmap={(submapName) => editor.createSubmap(submapName)}
                onCreateSubmapFromTemplate={(templateId) =>
                  editor.createSubmapFromTemplate(templateId, selected.id).catch(() => {})
                }
                onOpenSubmap={(mapId) => setEditingMapId(mapId)}
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
