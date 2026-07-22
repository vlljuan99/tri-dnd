import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useWorldMap } from '../hooks/useWorldMap.js';
import LocationPanel from '../components/LocationPanel.jsx';
import RoutePanel from '../components/RoutePanel.jsx';
import WorldMapSettings from '../components/WorldMapSettings.jsx';
import { kindGlyph } from '../kinds.js';
import { routeGeometry } from '../domain/routes.js';

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
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [routeStartId, setRouteStartId] = useState(null);
  const [cityTemplates, setCityTemplates] = useState([]); // biblioteca de plantillas (v35)
  // El modo normal sirve para seleccionar y arrastrar. Colocar un pin exige
  // activar una herramienta explícita, para que navegar por el mapa no cree
  // ubicaciones por accidente.
  const [placementMode, setPlacementMode] = useState(false);
  const [workspaceView, setWorkspaceView] = useState('locations'); // locations | routes | settings
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const imageRef = useRef(null);
  const viewportRef = useRef(null);
  const dragRef = useRef(null); // { locId } mientras se arrastra un pin
  const panRef = useRef(null); // arrastre del lienzo sin crear ubicaciones

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

  // Mapa en edición: empieza en el raíz; si el mapa editado desaparece
  // (submapa borrado), vuelta al raíz
  const editingMap =
    world?.maps.find((m) => m.id === editingMapId) ??
    world?.maps.find((m) => m.id === world.rootMapId) ??
    null;

  useEffect(() => {
    if (world && editingMap && editingMapId !== editingMap.id) setEditingMapId(editingMap.id);
  }, [world, editingMap, editingMapId]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedRouteId(null);
    setRouteStartId(null);
    setPlacementMode(false);
    setWorkspaceView('locations');
    setRightPanelOpen(false);
  }, [editingMap?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const locations = editingMap?.locations ?? [];
  const routes = editingMap?.routes ?? [];
  const selected = locations.find((l) => l.id === selectedId) ?? null;
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null;
  const breadcrumb = world && editingMap ? breadcrumbFor(world, editingMap.id) : [];

  useEffect(() => {
    if (selected || selectedRoute) setRightPanelOpen(true);
  }, [selected?.id, selectedRoute?.id]);

  async function connectRouteAt(location) {
    setSelectedId(null);
    if (routeStartId == null) {
      setRouteStartId(location.id);
      setSelectedRouteId(null);
      return;
    }
    if (routeStartId === location.id) {
      setRouteStartId(null);
      return;
    }
    const result = await editor.createRoute({
      worldMapId: editingMap.id,
      fromLocationId: routeStartId,
      toLocationId: location.id,
      cost: 1,
      oneWay: false,
    });
    const updatedLayer = result?.world?.maps?.find((map) => map.id === editingMap.id);
    const created = updatedLayer?.routes?.at(-1);
    setRouteStartId(null);
    if (created) {
      setSelectedRouteId(created.id);
      setRightPanelOpen(true);
    }
  }

  // Convierte un evento de puntero a coordenadas en % sobre la imagen
  function pointToPercent(e) {
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
  }

  async function placePin(e) {
    if (!placementMode || dragRef.current) return;
    const { x, y } = pointToPercent(e);
    const result = await editor.createLocation({ mapId: editingMap.id, x, y });
    const updatedLayer = result?.world?.maps?.find((map) => map.id === editingMap.id);
    const created = updatedLayer?.locations?.at(-1);
    if (created) {
      setSelectedId(created.id);
      setRightPanelOpen(true);
    }
    setPlacementMode(false);
  }

  function onPinPointerDown(e, loc) {
    e.stopPropagation();
    if (workspaceView === 'routes') {
      connectRouteAt(loc).catch(() => {});
      return;
    }
    setSelectedId(loc.id);
    setPlacementMode(false);
    dragRef.current = { locId: loc.id, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
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

  function onMapPointerDown(e) {
    if (placementMode || e.button !== 0 || !viewportRef.current) return;
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onMapPointerMove(e) {
    if (!panRef.current || !viewportRef.current) return;
    viewportRef.current.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x);
    viewportRef.current.scrollTop = panRef.current.top - (e.clientY - panRef.current.y);
  }

  function onMapPointerUp() {
    panRef.current = null;
  }

  async function deleteSubmap() {
    if (!editingMap || editingMap.isRoot) return;
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
            to={`/campanas/${campaignId}/taller/mundo`}
            className="rounded-sm border border-gold/25 px-2.5 py-1 font-display text-sm text-gold/80 hover:border-gold hover:text-gold"
          >
            ← Taller
          </Link>
          <h1 className="font-display text-xl tracking-wide text-gold">Mapa de mundo — {campaign.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          {busy && <span className="text-xs text-bone/50">Guardando…</span>}
          <Link to={`/campanas/${campaignId}`} className="text-xs text-gold/70 underline hover:text-gold">
            Mesa
          </Link>
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
        <div className="ml-3 flex shrink-0 items-center gap-0.5 rounded-sm border border-bone/15 p-0.5">
          <button
            type="button"
            onClick={() => {
              setWorkspaceView('locations');
              setSelectedRouteId(null);
              setRouteStartId(null);
            }}
            className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
              workspaceView === 'locations' ? 'bg-gold text-night-950' : 'text-bone/60 hover:bg-bone/10 hover:text-bone'
            }`}
          >
            Ubicaciones
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspaceView('routes');
              setPlacementMode(false);
              setSelectedId(null);
            }}
            className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
              workspaceView === 'routes' ? 'bg-gold text-night-950' : 'text-bone/60 hover:bg-bone/10 hover:text-bone'
            }`}
          >
            Rutas
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspaceView('settings');
              setPlacementMode(false);
              setSelectedRouteId(null);
              setRouteStartId(null);
              setRightPanelOpen(false);
            }}
            className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
              workspaceView === 'settings' ? 'bg-gold text-night-950' : 'text-bone/60 hover:bg-bone/10 hover:text-bone'
            }`}
          >
            Configuración
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {workspaceView === 'locations' && editingMap.imageUrl && (
            <button
              type="button"
              onClick={() => setPlacementMode((active) => !active)}
              className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                placementMode
                  ? 'border-gold bg-gold text-night-950'
                  : 'border-gold/30 text-gold hover:bg-gold/10'
              }`}
            >
              {placementMode ? 'Cancelar colocación' : '+ Añadir ubicación'}
            </button>
          )}
          {workspaceView === 'locations' && selected && (
            <button
              type="button"
              onClick={() => setRightPanelOpen((open) => !open)}
              className="rounded-sm border border-bone/20 px-2.5 py-1 text-xs text-bone/65 hover:border-gold hover:text-gold"
            >
              {rightPanelOpen ? 'Ocultar ubicación' : 'Editar ubicación'}
            </button>
          )}
          {workspaceView === 'routes' && routeStartId && (
            <button
              type="button"
              onClick={() => {
                setRouteStartId(null);
                setSelectedRouteId(null);
                setRightPanelOpen(false);
              }}
              className="rounded-sm border border-gold bg-gold px-2.5 py-1 text-xs text-night-950 transition-colors"
            >
              Cancelar conexión
            </button>
          )}
          {workspaceView === 'routes' && !routeStartId && !selectedRoute && (
            <span className="rounded-sm border border-gold/20 px-2.5 py-1 text-xs text-gold/65">
              Pulsa el primer pin
            </span>
          )}
          {workspaceView === 'routes' && selectedRoute && (
            <button
              type="button"
              onClick={() => setRightPanelOpen((open) => !open)}
              className="rounded-sm border border-bone/20 px-2.5 py-1 text-xs text-bone/65 hover:border-gold hover:text-gold"
            >
              {rightPanelOpen ? 'Ocultar ruta' : 'Editar ruta'}
            </button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {workspaceView === 'settings' ? (
          <WorldMapSettings
            key={editingMap.id}
            map={editingMap}
            busy={busy}
            templates={cityTemplates}
            onUpload={editor.uploadImage}
            onRemoveImage={editor.removeImage}
            onGenerate={editor.generateImage}
            onRename={editor.renameMap}
            onDelete={deleteSubmap}
            onSaveTemplate={async (mapId) => {
              const result = await editor.saveCityTemplate(mapId);
              reloadTemplates();
              return result;
            }}
            onApplyTemplate={editor.applyCityTemplate}
            onBack={() => setWorkspaceView('locations')}
          />
        ) : (
        /* Lienzo del mundo */
        <div ref={viewportRef} className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto p-4">
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
                onPointerDown={onMapPointerDown}
                onPointerMove={onMapPointerMove}
                onPointerUp={onMapPointerUp}
                onPointerCancel={onMapPointerUp}
                className={`max-h-[calc(100vh-11rem)] w-auto rounded-md border ${
                  placementMode
                    ? 'cursor-crosshair border-gold/70 ring-2 ring-gold/15'
                    : 'cursor-grab border-gold/20 active:cursor-grabbing'
                }`}
                draggable={false}
              />
              <svg
                className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <marker id="world-editor-route-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 Z" fill="#d6b45d" />
                  </marker>
                </defs>
                {routes.map((route) => {
                  const geometry = routeGeometry(route, locations);
                  if (!geometry) return null;
                  const selectedLine = route.id === selectedRouteId;
                  return (
                    <g key={route.id}>
                      <line
                        x1={geometry.from.x}
                        y1={geometry.from.y}
                        x2={geometry.to.x}
                        y2={geometry.to.y}
                        stroke="transparent"
                        strokeWidth="12"
                        style={{ pointerEvents: workspaceView === 'routes' ? 'stroke' : 'none', cursor: 'pointer' }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRouteId(route.id);
                          setRouteStartId(null);
                          setRightPanelOpen(true);
                        }}
                      />
                      <line
                        x1={geometry.from.x}
                        y1={geometry.from.y}
                        x2={geometry.to.x}
                        y2={geometry.to.y}
                        stroke={selectedLine ? '#f2cf70' : '#b89b55'}
                        strokeWidth={selectedLine ? 3 : 2}
                        strokeDasharray={route.oneWay ? 'none' : '5 3'}
                        markerEnd={route.oneWay ? 'url(#world-editor-route-arrow)' : undefined}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </svg>
              {routes.map((route) => {
                const geometry = routeGeometry(route, locations);
                if (!geometry) return null;
                return (
                  <button
                    key={`route-label-${route.id}`}
                    type="button"
                    onClick={() => {
                      if (workspaceView !== 'routes') return;
                      setSelectedRouteId(route.id);
                      setRouteStartId(null);
                      setRightPanelOpen(true);
                    }}
                    style={{ left: `${geometry.midX}%`, top: `${geometry.midY}%` }}
                    className={`absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 py-0.5 text-[0.6rem] shadow-md ${
                      workspaceView === 'routes' ? 'cursor-pointer' : 'pointer-events-none'
                    } ${
                      route.id === selectedRouteId
                        ? 'border-gold bg-gold text-night-950'
                        : 'border-gold/35 bg-night-950/85 text-gold/80'
                    }`}
                    title={`${route.label || 'Ruta'} · ${route.cost} jornada${route.cost === 1 ? '' : 's'}`}
                  >
                    {route.oneWay ? '→ ' : '↔ '}{route.cost}j{route.label ? ` · ${route.label}` : ''}
                  </button>
                );
              })}
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  id={`pin-${loc.id}`}
                  type="button"
                  onPointerDown={(e) => onPinPointerDown(e, loc)}
                  onDoubleClick={() => {
                    if (workspaceView === 'routes') return;
                    if (loc.targetMapId) setEditingMapId(loc.targetMapId);
                    else if (loc.mapId) navigate(`/campanas/${campaignId}/editor?mapa=${loc.mapId}`);
                  }}
                  style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                  className={`absolute z-10 -translate-x-1/2 -translate-y-full ${
                    workspaceView === 'routes' ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
                  } ${
                    loc.hidden ? 'opacity-50' : ''
                  }`}
                  title={loc.hidden ? `${loc.name} (oculta para los jugadores)` : loc.name}
                >
                  <span className="flex flex-col items-center">
                    <span
                      className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[0.65rem] font-display tracking-wide ${
                        loc.id === selectedId || loc.id === routeStartId
                          ? 'bg-gold text-night-950'
                          : 'bg-night-900/90 text-gold border border-gold/40'
                      }`}
                    >
                      {kindGlyph(loc.kind)} {loc.name}
                      {loc.hidden && ' 👁'}
                    </span>
                    <span
                      className={`h-3 w-3 rotate-45 border ${
                        loc.id === selectedId || loc.id === routeStartId
                          ? 'border-gold bg-gold'
                          : 'border-gold/60 bg-blood'
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex max-w-md flex-col items-center gap-3 rounded-md border border-dashed border-gold/20 bg-night-900/35 p-8 text-center text-bone/50">
              <p className="font-display text-lg">
                {editingMap.isRoot ? 'Aún no hay imagen de mundo.' : `Aún no hay imagen para "${editingMap.name}".`}
              </p>
              <p className="text-sm">Añade una imagen base para empezar a colocar ubicaciones.</p>
              <button
                type="button"
                onClick={() => setWorkspaceView('settings')}
                className="rounded-sm bg-gold px-4 py-2 font-display text-sm text-night-950 hover:bg-gold/90"
              >
                Configurar imagen →
              </button>
            </div>
          )}
          {editingMap.imageUrl && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
              <span className={placementMode || routeStartId ? 'font-medium text-gold' : 'text-bone/45'}>
                {workspaceView === 'routes'
                  ? routeStartId
                    ? `Ahora elige el destino desde ${locations.find((loc) => loc.id === routeStartId)?.name ?? 'el origen'}.`
                    : 'Pulsa dos pins para conectarlos; pulsa una línea para editar su coste y sentido.'
                  : placementMode
                  ? 'Haz clic una vez para colocar la nueva ubicación.'
                  : 'Arrastra el mapa para navegar o un pin para recolocarlo; ya no se crean pins por accidente.'}
              </span>
              <span className="text-bone/35">Doble clic abre el submapa o tablero enlazado.</span>
            </div>
          )}
        </div>
        )}

        {/* El inspector solo existe cuando hay una ubicación seleccionada. */}
        {workspaceView === 'locations' && selected && rightPanelOpen && <aside className="absolute inset-y-0 right-0 z-20 w-[min(22rem,92vw)] shrink-0 overflow-y-auto border-l border-gold/20 bg-night-900 shadow-2xl shadow-black/20 lg:static lg:z-auto lg:w-[22rem]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gold/15 bg-night-900/95 px-3 py-2 backdrop-blur">
            <div>
              <p className="font-display text-sm tracking-wide text-gold">
                Ubicación · {selected.name}
              </p>
              <p className="text-[0.65rem] text-bone/40">
                Cambios del pin seleccionado
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRightPanelOpen(false)}
              aria-label="Cerrar panel lateral"
              className="rounded-sm px-2 py-1 text-bone/50 hover:bg-bone/5 hover:text-bone"
            >
              ✕
            </button>
          </div>
          <div className="p-3">
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
          </div>
        </aside>}
        {workspaceView === 'routes' && selectedRoute && rightPanelOpen && (
          <aside className="absolute inset-y-0 right-0 z-20 w-[min(22rem,92vw)] shrink-0 overflow-y-auto border-l border-gold/20 bg-night-900 shadow-2xl shadow-black/20 lg:static lg:z-auto lg:w-[22rem]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gold/15 bg-night-900/95 px-3 py-2 backdrop-blur">
              <div>
                <p className="font-display text-sm tracking-wide text-gold">Ruta del mundo</p>
                <p className="text-[0.65rem] text-bone/40">Coste y sentido del trayecto</p>
              </div>
              <button
                type="button"
                onClick={() => setRightPanelOpen(false)}
                aria-label="Cerrar panel lateral"
                className="rounded-sm px-2 py-1 text-bone/50 hover:bg-bone/5 hover:text-bone"
              >
                ✕
              </button>
            </div>
            <div className="p-3">
              <RoutePanel
                key={selectedRoute.id}
                route={selectedRoute}
                locations={locations}
                busy={busy}
                onSave={(fields) => editor.updateRoute(selectedRoute.id, fields)}
                onReverse={() => editor.updateRoute(selectedRoute.id, { reverse: true })}
                onDelete={() => {
                  if (window.confirm('¿Borrar esta ruta?')) {
                    editor.deleteRoute(selectedRoute.id);
                    setSelectedRouteId(null);
                    setRightPanelOpen(false);
                  }
                }}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
