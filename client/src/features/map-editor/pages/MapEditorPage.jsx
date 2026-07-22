import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../../api.js';
import BestiaryBrowser from '../../../components/BestiaryBrowser.jsx';
import SrdPicker from '../../../components/SrdPicker.jsx';
import { useMapEditor } from '../hooks/useMapEditor.js';
import { buildObjectMarkerLoot } from '../lib/objectMarker.js';
import { applyWallStroke } from '../lib/wallBrush.js';
import { readMapCreationIntent } from '../lib/mapCreationIntent.js';
import EditorCanvas from '../components/EditorCanvas.jsx';
import RoomPanel from '../components/RoomPanel.jsx';
import DoorPanel from '../components/DoorPanel.jsx';
import TokenPanel from '../components/TokenPanel.jsx';
import MapSettingsSection from '../components/MapSettingsSection.jsx';

const TOKEN_KINDS = [
  { key: 'enemigo', label: 'Enemigo' },
  { key: 'aliado', label: 'Aliado / PNJ' },
  { key: 'objeto', label: 'Objeto' },
  { key: 'trampa', label: 'Trampa' },
];

// Marcadores que pueden enlazarse a una ficha de personaje del DM (kind='boss'):
// un enemigo importante o un PNJ aliado toman su avatar y sus stats.
const CHARACTER_LINKABLE = new Set(['enemigo', 'aliado']);

// Plantillas de sala para combinar piezas: habitaciones, salones y pasillos
const ROOM_TEMPLATES = [
  { key: 'habitacion', label: 'Habitación 6×6', width: 6, height: 6 },
  { key: 'salon', label: 'Salón 10×8', width: 10, height: 8 },
  { key: 'pasillo-h', label: 'Pasillo 8×2', width: 8, height: 2 },
  { key: 'pasillo-v', label: 'Pasillo 2×8', width: 2, height: 8 },
  { key: 'libre', label: 'Libre (N×M)', width: null, height: null },
];

const toolButton = (active) =>
  `shrink-0 rounded-sm border px-3 py-1 font-display text-xs uppercase tracking-widest ${
    active ? 'border-gold bg-gold/15 text-gold' : 'border-bone/20 text-bone/60 hover:border-bone/40'
  }`;

// Las diez herramientas agrupadas en tres capas de trabajo, que son tres
// momentos de la cabeza del DM: dibujar la planta (Estructura), poblarla
// (Contenido) y darle propiedades a las casillas (Ambiente). Mientras una
// herramienta está activa, el lienzo atenúa las otras dos capas.
const TOOL_LAYERS = [
  {
    id: 'estructura',
    label: 'Estructura',
    tools: [
      { mode: 'add-room', label: 'Añadir sala' },
      { mode: 'door', label: 'Puertas' },
      { mode: 'wall', label: 'Paredes' },
    ],
  },
  {
    id: 'contenido',
    label: 'Contenido',
    tools: [
      { mode: 'token', label: 'Marcadores' },
      { mode: 'obstacle', label: 'Obstáculos' },
      { mode: 'spawn', label: 'Aparición' },
    ],
  },
  {
    id: 'ambiente',
    label: 'Ambiente',
    tools: [
      { mode: 'light', label: 'Luces' },
      { mode: 'elevation', label: 'Elevación' },
      { mode: 'terrain', label: 'Terreno' },
    ],
  },
];

const layerTabButton = (active) =>
  `shrink-0 rounded-sm px-3 py-1 font-display text-xs uppercase tracking-widest ${
    active ? 'bg-gold text-night-950' : 'text-bone/55 hover:bg-bone/10 hover:text-bone'
  }`;

export default function MapEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignId = Number(id);
  const {
    requestedMapId,
    createMapIntent,
    requestedMapName,
    requestedLocationId,
    returnToWorld,
  } = readMapCreationIntent(searchParams);
  const [campaign, setCampaign] = useState(null);
  const [campaignError, setCampaignError] = useState('');

  const editor = useMapEditor(campaignId, { initialMapId: requestedMapId });
  const { map, maps, busy, error } = editor;

  const [activeFloorId, setActiveFloorId] = useState(null);
  const [selection, setSelection] = useState(null); // { type: 'room'|'door', id }
  const [mode, setMode] = useState('select'); // select | add-room | door | token
  const [activeLayer, setActiveLayer] = useState('estructura'); // estructura | contenido | ambiente
  const [template, setTemplate] = useState(ROOM_TEMPLATES[0]);
  const [customSize, setCustomSize] = useState({ width: 4, height: 4 });
  const [doorDraft, setDoorDraft] = useState(null); // { roomId, x, y }
  // Colocado de puerta: 'edge' = puerta normal sobre una arista (un clic, como
  // el pincel de paredes); 'link' = escalera/portal entre salas o plantas
  // distintas (dos clics)
  const [doorPlacement, setDoorPlacement] = useState('edge');
  const [newMapName, setNewMapName] = useState(createMapIntent ? requestedMapName : '');
  const [tokenKind, setTokenKind] = useState('enemigo');
  const [tokenName, setTokenName] = useState('');
  const [terrainCost, setTerrainCost] = useState(2); // coste del pincel de terreno difícil
  const [elevationLevel, setElevationLevel] = useState(1); // nivel del pincel de elevación
  const [tokenMonster, setTokenMonster] = useState(null); // { index, name } del compendio
  const [showMonsterPicker, setShowMonsterPicker] = useState(false);
  const [tokenItem, setTokenItem] = useState(null); // equipo SRD o de la biblioteca propia
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [bosses, setBosses] = useState([]); // personajes kind='boss' del DM
  const [tokenBossId, setTokenBossId] = useState('');
  const [tokenTemplateId, setTokenTemplateId] = useState(''); // plantilla de enemigo configurado
  const [templates, setTemplates] = useState([]); // biblioteca de plantillas del DM (v35)
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [showEmptyMapGuide, setShowEmptyMapGuide] = useState(true);
  const uvttInputRef = useRef(null);
  const createIntentHandledRef = useRef(false);

  useEffect(() => {
    api('/characters')
      .then(({ characters }) => setBosses(characters.filter((c) => c.kind === 'boss')))
      .catch(() => {});
  }, []);

  const reloadTemplates = () => {
    api('/plantillas').then(({ templates: rows }) => setTemplates(rows)).catch(() => {});
  };
  useEffect(reloadTemplates, []);

  const mapTemplates = templates.filter((t) => t.kind === 'mapa');
  const roomTemplates = templates.filter((t) => t.kind === 'sala');
  const enemyTemplates = templates.filter((t) => t.kind === 'enemigo');

  // Aviso efímero («Guardado en la biblioteca») tras guardar una plantilla
  function flash(text) {
    setNotice(text);
    setTimeout(() => setNotice(''), 4000);
  }

  async function saveTemplateOf(kind, saver) {
    try {
      const { template: saved } = await saver();
      flash(`«${saved.name}» guardado en tu biblioteca (${kind}).`);
      reloadTemplates();
    } catch (e) {
      flash(e.message || 'No se pudo guardar la plantilla');
    }
  }

  useEffect(() => {
    api(`/campaigns/${campaignId}`)
      .then(({ campaign: loaded }) => setCampaign(loaded))
      .catch((e) => setCampaignError(e.message));
  }, [campaignId]);

  // Una ubicación del mundo sin tableros ofrece una CTA explícita. Al llegar
  // desde ella creamos el primer tablero, lo enlazamos y dejamos al DM dentro
  // del lienzo; la cabecera conserva el camino de vuelta al mundo.
  useEffect(() => {
    if (
      campaign?.role !== 'dm' ||
      !createMapIntent ||
      maps === null ||
      createIntentHandledRef.current
    ) {
      return;
    }

    createIntentHandledRef.current = true;
    editor
      .createMap(requestedMapName)
      .then(async (created) => {
        if (requestedLocationId) {
          await api(`/campaigns/${campaignId}/mundo/ubicaciones/${requestedLocationId}`, {
            method: 'PATCH',
            body: { mapId: created.id },
          });
          flash(`Tablero «${created.name}» creado y enlazado a la ubicación.`);
        }
        const nextParams = new URLSearchParams({ mapa: String(created.id) });
        if (returnToWorld) nextParams.set('volver', 'mundo');
        navigate(`/campanas/${campaignId}/editor?${nextParams.toString()}`, { replace: true });
      })
      .catch(() => {
        createIntentHandledRef.current = false;
      });
    // El objeto editor se recrea en cada render; las dependencias primitivas
    // describen por completo cuándo debe consumirse esta intención una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.role, maps, createMapIntent, requestedMapName, requestedLocationId, returnToWorld, campaignId, navigate]);

  // Planta activa: la primera del mapa al cargarlo o si la actual desapareció
  useEffect(() => {
    if (!map) return;
    if (!map.floors.some((f) => f.id === activeFloorId)) {
      setActiveFloorId(map.floors[0]?.id ?? null);
    }
  }, [map, activeFloorId]);

  // Al cambiar de mapa se limpia la selección y la puerta a medias
  useEffect(() => {
    setSelection(null);
    setDoorDraft(null);
    setSettingsOpen(false);
    setRightPanelOpen(false);
    setShowEmptyMapGuide(true);
  }, [editor.selectedMapId]);

  useEffect(() => {
    if (selection) setRightPanelOpen(true);
  }, [selection?.type, selection?.id]);

  const activeFloor = map?.floors.find((f) => f.id === activeFloorId) ?? null;
  const allRooms = useMemo(() => (map ? map.floors.flatMap((f) => f.rooms) : []), [map]);
  const floorTokens = useMemo(() => {
    if (!map || !activeFloor) return [];
    const floorRoomIds = new Set(activeFloor.rooms.map((r) => r.id));
    return (map.tokens ?? []).filter((t) => floorRoomIds.has(t.roomId));
  }, [map, activeFloor]);
  const selectedRoom =
    selection?.type === 'room' ? allRooms.find((r) => r.id === selection.id) ?? null : null;
  const selectedDoor =
    selection?.type === 'door' ? map?.doors.find((d) => d.id === selection.id) ?? null : null;
  const selectedToken =
    selection?.type === 'token' ? (map?.tokens ?? []).find((t) => t.id === selection.id) ?? null : null;
  const selectedElement = selectedRoom ?? selectedDoor ?? selectedToken;

  function templateSize() {
    return template.key === 'libre' ? customSize : { width: template.width, height: template.height };
  }

  async function placeRoom(cellPos) {
    if (!activeFloor) return;
    // Sala de la biblioteca de plantillas: se estampa entera (capas, suelo y
    // marcadores) con su esquina en la casilla clicada
    if (template.templateId) {
      const { room } = await editor.addRoomFromTemplate(activeFloor.id, {
        templateId: template.templateId,
        x: cellPos.x,
        y: cellPos.y,
      });
      setSelection({ type: 'room', id: room.id });
      setMode('select');
      return;
    }
    const { width, height } = templateSize();
    if (!Number.isInteger(width) || !Number.isInteger(height)) return;
    const { room } = await editor.addRoom(activeFloor.id, {
      x: cellPos.x,
      y: cellPos.y,
      width,
      height,
      name: template.key === 'libre' ? 'Sala sin nombre' : template.label.split(' ')[0],
    });
    setSelection({ type: 'room', id: room.id });
    setMode('select');
  }

  async function placeToken(target) {
    // Plantilla de enemigo configurado: se coloca con su variante y botín
    if (tokenKind === 'enemigo' && tokenTemplateId) {
      const { token } = await editor.addTokenFromTemplate(target.roomId, {
        templateId: Number(tokenTemplateId),
        x: target.x,
        y: target.y,
      });
      setSelection({ type: 'token', id: token.id });
      return;
    }
    const boss = CHARACTER_LINKABLE.has(tokenKind) ? bosses.find((b) => b.id === Number(tokenBossId)) : null;
    const name =
      tokenName.trim() ||
      boss?.name ||
      (CHARACTER_LINKABLE.has(tokenKind) && tokenMonster?.name) ||
      (tokenKind === 'objeto' && tokenItem?.name) ||
      TOKEN_KINDS.find((k) => k.key === tokenKind)?.label ||
      'Marcador';
    const { token } = await editor.addToken(target.roomId, {
      kind: tokenKind,
      name,
      x: target.x,
      y: target.y,
      monsterIndex: CHARACTER_LINKABLE.has(tokenKind) && !boss ? tokenMonster?.index : undefined,
      characterId: boss?.id,
      // Reutiliza el formato de botín existente: los objetos elegidos desde
      // el selector se pueden saquear y las plantillas ya conservan `loot`.
      loot: tokenKind === 'objeto' ? buildObjectMarkerLoot(tokenItem) : undefined,
    });
    setSelection({ type: 'token', id: token.id });
    setMode('select');
  }

  // Pinta o borra un obstáculo en la casilla pulsada de la sala
  async function toggleObstacle(target) {
    const room = allRooms.find((r) => r.id === target.roomId);
    if (!room) return;
    const rel = [target.x - room.x, target.y - room.y];
    const exists = (room.obstacleCells ?? []).some(([c, r]) => c === rel[0] && r === rel[1]);
    const next = exists
      ? room.obstacleCells.filter(([c, r]) => !(c === rel[0] && r === rel[1]))
      : [...(room.obstacleCells ?? []), rel];
    await editor.patchRoom(room.id, { obstacleCells: next });
  }

  // Pinta o borra terreno difícil en la casilla pulsada: entrar en ella
  // cuesta `terrainCost` puntos de movimiento en vez de 1 (el coste lo
  // valida el servidor con el camino real al mover)
  async function toggleTerrain(target) {
    const room = allRooms.find((r) => r.id === target.roomId);
    if (!room) return;
    const rel = [target.x - room.x, target.y - room.y];
    const exists = (room.terrainCells ?? []).some(([c, r]) => c === rel[0] && r === rel[1]);
    const next = exists
      ? room.terrainCells.filter(([c, r]) => !(c === rel[0] && r === rel[1]))
      : [...(room.terrainCells ?? []), [rel[0], rel[1], terrainCost]];
    await editor.patchRoom(room.id, { terrainCells: next });
  }

  // Persiste de una vez todas las aristas recorridas por el pincel. La
  // operación se fija al empezar: sobre un muro borra; sobre un hueco pinta.
  async function saveWallStroke(stroke) {
    if (!activeFloor) return;
    const updates = applyWallStroke(activeFloor.rooms, stroke.targets, stroke.operation);
    if (updates.length) await editor.patchWalls(updates);
  }

  // Pinta el nivel de elevación en la casilla pulsada: si ya tiene ese mismo
  // nivel lo quita (vuelve a 0), si no lo pone/sustituye. El nivel 0 no se
  // guarda (es el suelo base).
  async function toggleElevation(target) {
    const room = allRooms.find((r) => r.id === target.roomId);
    if (!room) return;
    const rel = [target.x - room.x, target.y - room.y];
    const current = (room.elevationCells ?? []).find(([c, r]) => c === rel[0] && r === rel[1]);
    const rest = (room.elevationCells ?? []).filter(([c, r]) => !(c === rel[0] && r === rel[1]));
    const next = current && current[2] === elevationLevel ? rest : [...rest, [rel[0], rel[1], elevationLevel]];
    await editor.patchRoom(room.id, { elevationCells: next });
  }

  // Pone o quita una fuente de luz manual (brasero, vela...) en la casilla
  async function toggleLight(target) {
    const room = allRooms.find((r) => r.id === target.roomId);
    if (!room) return;
    const rel = [target.x - room.x, target.y - room.y];
    const exists = (room.lightCells ?? []).some(([c, r]) => c === rel[0] && r === rel[1]);
    const next = exists
      ? room.lightCells.filter(([c, r]) => !(c === rel[0] && r === rel[1]))
      : [...(room.lightCells ?? []), rel];
    await editor.patchRoom(room.id, { lightCells: next });
  }

  // Pinta o borra un punto de aparición en la casilla pulsada de la sala
  // (Fase 8.8): sustituye al spawn automático (primera casilla libre) como
  // origen de aparición de los personajes, que sigue de respaldo si no se marca ninguno.
  async function toggleSpawn(target) {
    const room = allRooms.find((r) => r.id === target.roomId);
    if (!room) return;
    const rel = [target.x - room.x, target.y - room.y];
    const exists = (room.spawnCells ?? []).some(([c, r]) => c === rel[0] && r === rel[1]);
    const next = exists
      ? room.spawnCells.filter(([c, r]) => !(c === rel[0] && r === rel[1]))
      : [...(room.spawnCells ?? []), rel];
    await editor.patchRoom(room.id, { spawnCells: next });
  }

  // Activa una herramienta conservando el matiz de cada una: elegir una de
  // colocado limpia la selección, y solo la de puertas conserva la puerta a
  // medio crear.
  function activateTool(nextMode) {
    setSettingsOpen(false);
    setMode(nextMode);
    if (nextMode !== 'select') setSelection(null);
    if (nextMode !== 'door') setDoorDraft(null);
  }

  function switchLayer(layerId) {
    setSettingsOpen(false);
    setActiveLayer(layerId);
    const layer = TOOL_LAYERS.find((candidate) => candidate.id === layerId);
    if (!layer.tools.some((tool) => tool.mode === mode)) {
      setMode('select');
      setDoorDraft(null);
    }
  }

  function openSettings() {
    setSettingsOpen(true);
    setMode('select');
    setSelection(null);
    setDoorDraft(null);
    setRightPanelOpen(false);
  }

  // Sala de la planta activa que contiene una casilla activa (no desactivada)
  function roomAtCell(x, y) {
    if (!activeFloor) return null;
    return (
      activeFloor.rooms.find(
        (r) =>
          x >= r.x &&
          x < r.x + r.width &&
          y >= r.y &&
          y < r.y + r.height &&
          !(r.disabledCells ?? []).some(([c, w]) => c === x - r.x && w === y - r.y)
      ) ?? null
    );
  }

  // Puerta normal sobre la arista pulsada (pincel tipo pared): conecta la
  // casilla clicada con su vecina al otro lado del borde. Ambas han de ser
  // transitables (una puerta al vacío no lleva a ninguna parte). Si ya hay
  // una puerta en esa arista, se selecciona en vez de duplicarla.
  async function doorEdgeClick({ x, y, side }) {
    const NEIGHBOR = { n: [0, -1], s: [0, 1], o: [-1, 0], e: [1, 0] };
    const [dx, dy] = NEIGHBOR[side];
    const bx = x + dx;
    const by = y + dy;
    const roomA = roomAtCell(x, y);
    const roomB = roomAtCell(bx, by);
    if (!roomA || !roomB) {
      editor.setError('La puerta debe ir entre dos casillas transitables, no en el borde exterior de la sala.');
      return;
    }
    const existing = (map?.doors ?? []).find(
      (d) =>
        d.kind === 'puerta' &&
        ((d.fromX === x && d.fromY === y && d.toX === bx && d.toY === by) ||
          (d.fromX === bx && d.fromY === by && d.toX === x && d.toY === y))
    );
    if (existing) {
      setSelection({ type: 'door', id: existing.id });
      return;
    }
    const { door } = await editor.addDoor({
      fromRoomId: roomA.id,
      toRoomId: roomB.id,
      fromX: x,
      fromY: y,
      toX: bx,
      toY: by,
      kind: 'puerta',
    });
    setSelection({ type: 'door', id: door.id });
  }

  // Escalera/portal (dos clics): enlaza dos salas distintas, incluso de otra
  // planta. En la misma planta es un portal (teletransporte); entre plantas,
  // una escalera. Las puertas normales van con el pincel de arista.
  async function doorCellClick(end) {
    if (!doorDraft) {
      setDoorDraft(end);
      return;
    }
    if (doorDraft.roomId === end.roomId) {
      // Repetir sala: se mueve el primer extremo
      setDoorDraft(end);
      return;
    }
    const fromFloor = allRooms.find((r) => r.id === doorDraft.roomId)?.floorId;
    const toFloor = allRooms.find((r) => r.id === end.roomId)?.floorId;
    const { door } = await editor.addDoor({
      fromRoomId: doorDraft.roomId,
      toRoomId: end.roomId,
      fromX: doorDraft.x,
      fromY: doorDraft.y,
      toX: end.x,
      toY: end.y,
      kind: fromFloor === toFloor ? 'portal' : 'escalera',
    });
    setDoorDraft(null);
    setSelection({ type: 'door', id: door.id });
    setMode('select');
  }

  if (campaignError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">{campaignError}</p>
        <Link to="/" className="text-gold underline">Volver al hub</Link>
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="flex h-full items-center justify-center bg-night-950 text-bone">
        <p className="font-display text-lg text-gold">Cargando editor…</p>
      </div>
    );
  }
  if (campaign.role !== 'dm') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-950 text-bone">
        <p className="font-display text-xl text-blood">Solo el DM puede entrar al editor de mapas.</p>
        <Link to={`/campanas/${campaignId}`} className="text-gold underline">Volver a la mesa</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to={returnToWorld ? `/campanas/${campaignId}/mundo` : `/campanas/${campaignId}/taller/mapas`}
            className="font-display text-sm text-gold/70 hover:text-gold"
          >
            {returnToWorld ? '← Mapa de mundo' : '← Taller'}
          </Link>
          <h1 className="font-display text-xl tracking-wide text-gold">Editor de mapas</h1>
          <span className="text-sm text-bone/60">{campaign.name}</span>
          <Link to={`/campanas/${campaignId}`} className="text-xs text-bone/50 underline hover:text-gold">
            Mesa
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {error && <p className="text-sm text-blood">{error}</p>}
          {selectedElement && !settingsOpen && (
            <button
              type="button"
              onClick={() => setRightPanelOpen((open) => !open)}
              className="rounded-sm border border-gold/25 px-2.5 py-1 text-xs text-gold/80 hover:border-gold hover:bg-gold/10"
            >
              {rightPanelOpen ? 'Ocultar inspector' : 'Editar selección'}
            </button>
          )}
        </div>
      </header>

      <input
        ref={uvttInputRef}
        type="file"
        accept=".dd2vtt,.uvtt,.df2vtt,.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) editor.importUvtt(file).catch(() => {});
          event.target.value = '';
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* Biblioteca de mapas */}
        {maps?.length > 0 && <aside className="hidden w-60 shrink-0 flex-col border-r border-gold/15 bg-night-900/60 md:flex">
          <p className="px-3 pb-1 pt-3 font-display text-xs uppercase tracking-widest text-gold/80">
            Mapas de la campaña
          </p>
          <form
            className="flex gap-1 px-3 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newMapName.trim()) return;
              editor.createMap(newMapName.trim());
              setNewMapName('');
            }}
          >
            <input
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
              placeholder="Nuevo mapa…"
              className="min-w-0 flex-1 rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-sm text-bone focus:border-gold focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !newMapName.trim()}
              className="rounded-sm border border-gold/30 px-2 text-gold hover:bg-gold/10 disabled:opacity-40"
            >
              +
            </button>
          </form>
          <div className="px-3 pb-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => uvttInputRef.current?.click()}
              className="w-full rounded-sm border border-gold/25 px-2 py-1 text-xs text-gold/90 hover:bg-gold/10 disabled:opacity-40"
              title="Importa un mapa exportado de Dungeondraft u otro editor: imagen, cuadrícula y muros"
            >
              Importar UVTT (.dd2vtt)
            </button>
            {mapTemplates.length > 0 && (
              <select
                value=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value) editor.createMapFromTemplate(Number(e.target.value)).catch(() => {});
                  e.target.value = '';
                }}
                className="mt-1 w-full rounded-sm border border-gold/25 bg-night-950 px-2 py-1 text-xs text-gold/90 focus:border-gold focus:outline-none disabled:opacity-40"
                title="Crea un mapa nuevo a partir de una plantilla de tu biblioteca"
              >
                <option value="">+ Desde plantilla…</option>
                {mapTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.meta?.floors ?? '?'}p · {t.meta?.rooms ?? '?'}s)
                  </option>
                ))}
              </select>
            )}
            {notice && <p className="mt-1 text-[0.65rem] text-sage">{notice}</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {maps === null ? (
              <p className="px-1 text-sm text-bone/50">Cargando…</p>
            ) : maps.length === 0 ? (
              <p className="px-1 text-sm italic text-bone/50">
                Sin mapas todavía. Crea el primero arriba.
              </p>
            ) : (
              maps.map((m) => (
                <div
                  key={m.id}
                  className={`mb-1 rounded-sm border p-2 ${
                    m.id === editor.selectedMapId
                      ? 'border-gold/50 bg-gold/10'
                      : 'border-transparent hover:border-bone/20'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => editor.setSelectedMapId(m.id)}
                    className="block w-full truncate text-left font-display text-sm text-bone hover:text-gold"
                  >
                    {m.name}
                  </button>
                  <p className="mt-0.5 text-[0.65rem] text-bone/50">
                    {m.floorCount} planta{m.floorCount === 1 ? '' : 's'} · {m.roomCount} sala
                    {m.roomCount === 1 ? '' : 's'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {m.isActive ? (
                      <span className="text-[0.65rem] font-medium uppercase tracking-widest text-sage">
                        ● En la mesa
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => editor.activateMap(m.id)}
                        className="text-[0.65rem] uppercase tracking-widest text-gold/70 hover:text-gold disabled:opacity-40"
                      >
                        Llevar a la mesa
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => saveTemplateOf('mapa', () => editor.saveMapTemplate(m.id))}
                      className="text-[0.65rem] uppercase tracking-widest text-gold/70 hover:text-gold disabled:opacity-40"
                      title="Guarda este mapa entero en tu biblioteca de plantillas, reutilizable en cualquier campaña"
                    >
                      Guardar plantilla
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`¿Borrar el mapa "${m.name}" con todas sus salas?`)) {
                          editor.deleteMap(m.id);
                        }
                      }}
                      className="ml-auto text-[0.65rem] uppercase tracking-widest text-blood/70 hover:text-blood disabled:opacity-40"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>}

        {/* Lienzo y herramientas */}
        <main className="flex min-w-0 flex-1 flex-col">
          {map ? (
            <>
              <div className="shrink-0 border-b border-gold/15 bg-night-900/40">
              <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-gold/10 px-3 py-1.5 [scrollbar-width:thin]">
                <select
                  value={editor.selectedMapId ?? ''}
                  onChange={(event) => editor.setSelectedMapId(Number(event.target.value))}
                  className="max-w-44 rounded-sm border border-gold/25 bg-night-950 px-2 py-1 text-xs text-gold md:hidden"
                  aria-label="Mapa en edición"
                >
                  {maps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {/* Plantas */}
                <div className="flex items-center gap-1">
                  {map.floors.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setActiveFloorId(f.id)}
                      onDoubleClick={() => {
                        const name = window.prompt('Nombre de la planta', f.name);
                        if (name?.trim()) editor.renameFloor(f.id, name.trim());
                      }}
                      className={toolButton(f.id === activeFloorId)}
                      title="Doble clic para renombrar"
                    >
                      {f.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => editor.addFloor()}
                    className="rounded-sm border border-bone/20 px-2 py-1 text-xs text-bone/60 hover:border-gold hover:text-gold disabled:opacity-40"
                    title="Añadir planta"
                  >
                    + planta
                  </button>
                  {map.floors.length > 1 && activeFloor && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`¿Borrar "${activeFloor.name}" y todas sus salas?`)) {
                          editor.deleteFloor(activeFloor.id);
                        }
                      }}
                      className="rounded-sm border border-blood/30 px-2 py-1 text-xs text-blood/70 hover:text-blood disabled:opacity-40"
                    >
                      Borrar planta
                    </button>
                  )}
                </div>

                <span className="mx-1 h-5 w-px bg-gold/15" />

                {/* Capas de trabajo */}
                <button type="button" onClick={() => activateTool('select')} className={toolButton(mode === 'select' && !settingsOpen)}>
                  Seleccionar
                </button>
                <span className="mx-1 h-5 w-px bg-gold/15" />
                <div className="flex shrink-0 items-center gap-0.5 rounded-sm border border-bone/15 p-0.5">
                  {TOOL_LAYERS.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => switchLayer(layer.id)}
                      className={layerTabButton(activeLayer === layer.id && !settingsOpen)}
                    >
                      {layer.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={openSettings}
                    className={layerTabButton(settingsOpen)}
                  >
                    Ajustes
                  </button>
                </div>
              </div>

              {/* Herramientas de la capa activa y controles contextuales */}
              {!settingsOpen && <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap px-3 py-1.5 [scrollbar-width:thin]">
                {TOOL_LAYERS.find((layer) => layer.id === activeLayer).tools.map((tool) => (
                  <button
                    key={tool.mode}
                    type="button"
                    onClick={() => activateTool(mode === tool.mode ? 'select' : tool.mode)}
                    className={toolButton(mode === tool.mode)}
                  >
                    {tool.label}
                  </button>
                ))}
                {mode === 'select' && (
                  <span className="text-xs italic text-bone/40">
                    elige una herramienta, o pulsa una pieza del plano para editarla
                  </span>
                )}

                {mode === 'add-room' && (
                  <>
                    <select
                      value={template.key}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith('tpl:')) {
                          const saved = roomTemplates.find((t) => `tpl:${t.id}` === value);
                          if (saved) {
                            setTemplate({ key: value, templateId: saved.id, label: saved.name });
                          }
                        } else {
                          setTemplate(ROOM_TEMPLATES.find((t) => t.key === value));
                        }
                      }}
                      className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                    >
                      {ROOM_TEMPLATES.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                      {roomTemplates.length > 0 && (
                        <optgroup label="De tu biblioteca">
                          {roomTemplates.map((t) => (
                            <option key={t.id} value={`tpl:${t.id}`}>
                              {t.name} ({t.meta?.width}×{t.meta?.height})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {template.key === 'libre' && (
                      <span className="flex items-center gap-1 text-xs text-bone/60">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={customSize.width}
                          onChange={(e) => setCustomSize((s) => ({ ...s, width: Number.parseInt(e.target.value, 10) || 1 }))}
                          className="w-14 rounded-sm border border-gold/20 bg-night-950 px-1 py-1 text-xs text-bone"
                          aria-label="Ancho"
                        />
                        ×
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={customSize.height}
                          onChange={(e) => setCustomSize((s) => ({ ...s, height: Number.parseInt(e.target.value, 10) || 1 }))}
                          className="w-14 rounded-sm border border-gold/20 bg-night-950 px-1 py-1 text-xs text-bone"
                          aria-label="Alto"
                        />
                      </span>
                    )}
                    <span className="text-xs italic text-bone/50">clic en el plano para colocar</span>
                  </>
                )}
                {mode === 'door' && (
                  <>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => { setDoorPlacement('edge'); setDoorDraft(null); }}
                        className={`rounded-sm border px-2 py-1 text-xs ${
                          doorPlacement === 'edge'
                            ? 'border-gold bg-gold/15 text-gold'
                            : 'border-bone/20 text-bone/70 hover:border-bone/40'
                        }`}
                      >
                        En muro
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDoorPlacement('link'); setDoorDraft(null); }}
                        className={`rounded-sm border px-2 py-1 text-xs ${
                          doorPlacement === 'link'
                            ? 'border-gold bg-gold/15 text-gold'
                            : 'border-bone/20 text-bone/70 hover:border-bone/40'
                        }`}
                      >
                        Escalera/Portal
                      </button>
                    </div>
                    <span className="text-xs italic text-bone/50">
                      {doorPlacement === 'edge'
                        ? 'clic cerca del borde de una casilla para poner una puerta en ese muro (cerrada bloquea, abierta deja pasar y ver)'
                        : doorDraft
                          ? 'ahora pulsa la casilla de destino en otra sala (puedes cambiar de planta)'
                          : 'pulsa la casilla de origen dentro de una sala'}
                    </span>
                  </>
                )}
                {mode === 'obstacle' && (
                  <span className="text-xs italic text-bone/50">
                    clic en una casilla de una sala para poner o quitar un obstáculo (no se puede pisar)
                  </span>
                )}
                {mode === 'light' && (
                  <span className="text-xs italic text-bone/50">
                    clic en una casilla para poner o quitar una fuente de luz (brasero, vela…); las antorchas
                    automáticas de pared se configuran en «Ajustes»
                  </span>
                )}
                {mode === 'elevation' && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-bone/60">
                      Nivel
                      <select
                        value={elevationLevel}
                        onChange={(e) => setElevationLevel(Number(e.target.value))}
                        className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                      >
                        {[-3, -2, -1, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n > 0 ? `+${n}` : n} ({n * 5} pies)
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="text-xs italic text-bone/50">
                      clic para pintar el nivel (positivo = plataforma, negativo = foso); mismo nivel para quitarlo. Subir cuesta movimiento extra
                    </span>
                  </>
                )}
                {mode === 'wall' && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-bone/60">
                      Color
                      <input
                        type="color"
                        value={map.wallColor ?? '#9b8555'}
                        onChange={(e) => editor.patchMap(map.id, { wallColor: e.target.value }).catch(() => {})}
                        className="h-7 w-9 cursor-pointer rounded-sm border border-gold/20 bg-night-950 p-0.5"
                        title="Color de las paredes de este mapa"
                      />
                    </label>
                    <span className="text-xs italic text-bone/50">
                      pulsa cerca de un borde y arrastra para pintar paredes; empieza sobre una pared para borrarlas. Un clic pinta una sola
                    </span>
                  </>
                )}
                {mode === 'terrain' && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-bone/60">
                      Coste de movimiento
                      <select
                        value={terrainCost}
                        onChange={(e) => setTerrainCost(Number(e.target.value))}
                        className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                      >
                        {[2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>×{n}</option>
                        ))}
                      </select>
                    </label>
                    <span className="text-xs italic text-bone/50">
                      clic para pintar o quitar terreno difícil (entrar cuesta ese movimiento en vez de 1)
                    </span>
                  </>
                )}
                {mode === 'spawn' && (
                  <span className="text-xs italic text-bone/50">
                    clic en una casilla de una sala para marcarla como punto de aparición (sustituye al spawn automático)
                  </span>
                )}
                {mode === 'token' && (
                  <>
                    <select
                      value={tokenKind}
                      onChange={(e) => {
                        setTokenKind(e.target.value);
                        setTokenMonster(null);
                        setTokenBossId('');
                        setTokenTemplateId('');
                        setTokenItem(null);
                      }}
                      className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                    >
                      {TOKEN_KINDS.map((k) => (
                        <option key={k.key} value={k.key}>{k.label}</option>
                      ))}
                    </select>
                    <input
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      placeholder="Nombre (Esqueleto, Cofre…)"
                      className="w-44 rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone placeholder:text-bone/35 focus:border-gold focus:outline-none"
                    />
                    {CHARACTER_LINKABLE.has(tokenKind) && !tokenTemplateId && (
                      <button
                        type="button"
                        onClick={() => setShowMonsterPicker(true)}
                        className="rounded-sm border border-gold/30 px-2 py-1 text-xs text-gold hover:bg-gold/10"
                      >
                        {tokenMonster ? `SRD: ${tokenMonster.name}` : 'Bestiario o personaje…'}
                      </button>
                    )}
                    {tokenKind === 'objeto' && (
                      <button
                        type="button"
                        onClick={() => setShowItemPicker(true)}
                        className="max-w-52 truncate rounded-sm border border-gold/30 px-2 py-1 text-xs text-gold hover:bg-gold/10"
                        title={
                          tokenItem
                            ? `${tokenItem.name}: se colocará como objeto saqueable`
                            : 'Busca en el compendio SRD y en tu biblioteca de objetos'
                        }
                      >
                        {tokenItem ? `Objeto: ${tokenItem.name}` : 'Elegir objeto…'}
                      </button>
                    )}
                    {tokenKind === 'enemigo' && enemyTemplates.length > 0 && !tokenMonster && !tokenBossId && (
                      <select
                        value={tokenTemplateId}
                        onChange={(e) => setTokenTemplateId(e.target.value)}
                        className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                        title="Enemigo configurado de tu biblioteca (variante y botín incluidos)"
                      >
                        <option value="">— o una plantilla tuya —</option>
                        {enemyTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    )}
                    {tokenMonster && CHARACTER_LINKABLE.has(tokenKind) && (
                      <button
                        type="button"
                        onClick={() => setTokenMonster(null)}
                        aria-label="Quitar monstruo del compendio"
                        className="text-xs text-bone/50 hover:text-blood"
                      >
                        ✕
                      </button>
                    )}
                    {tokenKind === 'objeto' && tokenItem && (
                      <button
                        type="button"
                        onClick={() => setTokenItem(null)}
                        aria-label="Quitar objeto seleccionado"
                        title="Dejar el marcador como objeto informativo, sin botín"
                        className="text-xs text-bone/50 hover:text-blood"
                      >
                        ✕
                      </button>
                    )}
                    {CHARACTER_LINKABLE.has(tokenKind) && bosses.length > 0 && !tokenMonster && (
                      <select
                        value={tokenBossId}
                        onChange={(e) => setTokenBossId(e.target.value)}
                        className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                      >
                        <option value="">
                          {tokenKind === 'aliado' ? '— o enlazar una ficha tuya —' : '— o una criatura creada —'}
                        </option>
                        {bosses.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    )}
                    <span className="text-xs italic text-bone/50">clic en una sala para colocarlo</span>
                  </>
                )}
              </div>}
              </div>

              {settingsOpen ? (
                <MapSettingsSection
                  map={map}
                  busy={busy}
                  onRename={(mapId, name) => editor.renameMap(mapId, name).catch(() => {})}
                  onPatch={(mapId, fields) => editor.patchMap(mapId, fields).catch(() => {})}
                  onActivate={(mapId) => editor.activateMap(mapId).catch(() => {})}
                  onBack={() => setSettingsOpen(false)}
                />
              ) : (
                <div className="relative flex min-h-0 flex-1">
                  <EditorCanvas
                    floor={activeFloor}
                    doors={map.doors}
                    tokens={floorTokens}
                    selection={selection}
                    mode={mode}
                    activeLayer={activeLayer}
                    doorDraft={doorDraft}
                    doorPlacement={doorPlacement}
                    wallColor={map.wallColor}
                    busy={busy}
                    onSelect={(nextSelection) => {
                      setSelection(nextSelection);
                      if (nextSelection) setRightPanelOpen(true);
                    }}
                    onPlaceRoom={(cellPos) => placeRoom(cellPos).catch(() => {})}
                    onDoorCellClick={(end) => doorCellClick(end).catch(() => {})}
                    onDoorEdgeClick={(edge) => doorEdgeClick(edge).catch(() => {})}
                    onTokenCellClick={(target) => placeToken(target).catch(() => {})}
                    onObstacleCellClick={(target) => toggleObstacle(target).catch(() => {})}
                    onTerrainCellClick={(target) => toggleTerrain(target).catch(() => {})}
                    onSpawnCellClick={(target) => toggleSpawn(target).catch(() => {})}
                    onWallStroke={saveWallStroke}
                    onElevationCellClick={(target) => toggleElevation(target).catch(() => {})}
                    onLightCellClick={(target) => toggleLight(target).catch(() => {})}
                    onMoveRoom={(roomId, pos) => editor.patchRoom(roomId, pos).catch(() => {})}
                    onMoveToken={(tokenId, pos) => editor.patchToken(tokenId, pos).catch(() => {})}
                  />
                  {allRooms.length === 0 && showEmptyMapGuide && mode === 'select' && (
                    <div className="absolute left-1/2 top-5 z-10 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 rounded-md border border-gold/30 bg-night-900/95 p-4 text-center shadow-xl shadow-black/30 backdrop-blur">
                      <button
                        type="button"
                        onClick={() => setShowEmptyMapGuide(false)}
                        aria-label="Cerrar ayuda inicial"
                        className="absolute right-2 top-1.5 px-1 text-bone/40 hover:text-bone"
                      >
                        ✕
                      </button>
                      <p className="font-display text-base text-gold">Empieza por la primera sala</p>
                      <p className="mt-1 text-xs text-bone/55">Elige su forma y colócala en cualquier casilla de la rejilla.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveLayer('estructura');
                          activateTool('add-room');
                          setShowEmptyMapGuide(false);
                        }}
                        className="mt-3 rounded-sm bg-gold px-4 py-2 font-display text-sm text-night-950 hover:bg-gold/90"
                      >
                        + Añadir la primera sala
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
              {maps === null ? (
                <p className="font-display text-lg text-gold">Cargando mapas…</p>
              ) : maps.length > 0 ? (
                <p className="max-w-sm text-center text-bone/60">Selecciona un mapa de la biblioteca para editarlo.</p>
              ) : (
                <div className="w-full max-w-xl rounded-lg border border-gold/20 bg-night-900/55 p-6 text-center shadow-xl shadow-black/15">
                  <p className="text-[0.65rem] uppercase tracking-[0.22em] text-gold/55">Primer paso</p>
                  <h2 className="mt-2 font-display text-2xl text-gold">
                    {createMapIntent ? `Creando «${requestedMapName}»` : 'Crea tu primer tablero'}
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-bone/55">
                    Empieza en blanco, importa un UVTT o reutiliza una plantilla. Después podrás añadir salas y llevarlo a la mesa.
                  </p>
                  {createMapIntent && busy ? (
                    <p className="mt-5 text-sm text-sage">Creando y enlazando el tablero a la ubicación…</p>
                  ) : (
                    <>
                      <form
                        className="mx-auto mt-5 flex max-w-md flex-col gap-2 sm:flex-row"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const name = newMapName.trim();
                          if (!name) return;
                          editor.createMap(name).catch(() => {});
                          setNewMapName('');
                        }}
                      >
                        <input
                          autoFocus
                          value={newMapName}
                          maxLength={80}
                          onChange={(event) => setNewMapName(event.target.value)}
                          placeholder="Cripta inferior, Taberna del puerto…"
                          className="min-w-0 flex-1 rounded-sm border border-gold/25 bg-night-950 px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={busy || !newMapName.trim()}
                          className="rounded-sm bg-gold px-4 py-2 font-display text-sm text-night-950 hover:bg-gold/90 disabled:opacity-40"
                        >
                          Crear y empezar →
                        </button>
                      </form>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => uvttInputRef.current?.click()}
                          className="rounded-sm border border-gold/30 px-3 py-2 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
                        >
                          Importar UVTT
                        </button>
                        {mapTemplates.length > 0 && (
                          <select
                            value=""
                            disabled={busy}
                            onChange={(event) => {
                              if (event.target.value) editor.createMapFromTemplate(Number(event.target.value)).catch(() => {});
                              event.target.value = '';
                            }}
                            className="rounded-sm border border-gold/30 bg-night-950 px-3 py-2 text-xs text-gold focus:border-gold focus:outline-none"
                          >
                            <option value="">Crear desde plantilla…</option>
                            {mapTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Panel derecho contextual */}
        {selectedElement && rightPanelOpen && !settingsOpen && <aside className="absolute inset-y-0 right-0 z-20 w-[min(20rem,92vw)] shrink-0 overflow-y-auto border-l border-gold/15 bg-night-900/95 shadow-2xl shadow-black/25 xl:static xl:z-auto xl:w-80 xl:bg-night-900/70">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gold/15 bg-night-900/95 px-3 py-2 backdrop-blur">
            <div className="min-w-0">
              <p className="truncate font-display text-sm tracking-wide text-gold">
                {selectedRoom
                  ? `Sala · ${selectedRoom.name}`
                  : selectedDoor
                    ? 'Puerta / conexión'
                    : selectedToken
                      ? `${selectedToken.kind === 'objeto' ? 'Objeto' : selectedToken.kind} · ${selectedToken.name}`
                      : ''}
              </p>
              <p className="text-[0.65rem] text-bone/40">Cambios del elemento seleccionado</p>
            </div>
            <button
              type="button"
              onClick={() => setRightPanelOpen(false)}
              aria-label="Cerrar inspector"
              className="rounded-sm px-2 py-1 text-bone/50 hover:bg-bone/5 hover:text-bone"
            >
              ✕
            </button>
          </div>
          {selectedRoom ? (
            <RoomPanel
              room={selectedRoom}
              busy={busy}
              onPatch={(roomId, fields) => editor.patchRoom(roomId, fields).catch(() => {})}
              onDelete={(roomId) => {
                setSelection(null);
                editor.deleteRoom(roomId).catch(() => {});
              }}
              onSaveTemplate={(roomId) => saveTemplateOf('sala', () => editor.saveRoomTemplate(roomId))}
              onUploadImage={(roomId, file) => editor.uploadRoomImage(roomId, file).catch(() => {})}
              onGenerateImage={(roomId, opts) => editor.generateRoomImage(roomId, opts).catch(() => {})}
              onRemoveImage={(roomId) => editor.removeRoomImage(roomId).catch(() => {})}
            />
          ) : selectedDoor ? (
            <DoorPanel
              door={selectedDoor}
              rooms={allRooms}
              busy={busy}
              onPatch={(doorId, fields) => editor.patchDoor(doorId, fields).catch(() => {})}
              onDelete={(doorId) => {
                setSelection(null);
                editor.deleteDoor(doorId).catch(() => {});
              }}
            />
          ) : (
            <TokenPanel
              token={selectedToken}
              roomName={allRooms.find((r) => r.id === selectedToken.roomId)?.name || 'Sala'}
              busy={busy}
              onPatch={(tokenId, fields) => editor.patchToken(tokenId, fields).catch(() => {})}
              onSaveTemplate={(tokenId) => saveTemplateOf('enemigo', () => editor.saveTokenTemplate(tokenId))}
              onDelete={(tokenId) => {
                setSelection(null);
                editor.deleteToken(tokenId).catch(() => {});
              }}
            />
          )}
        </aside>}
      </div>

      {showMonsterPicker && (
        <BestiaryBrowser
          creationCategory={tokenKind === 'aliado' ? 'pnj' : 'enemigo'}
          onBossesChanged={setBosses}
          onPick={(pick) => {
            if (pick.type === 'boss') {
              setTokenBossId(String(pick.id));
              setTokenMonster(null);
            } else {
              setTokenMonster({ index: pick.index, name: pick.name });
              setTokenBossId('');
            }
            if (!tokenName.trim()) setTokenName(pick.name);
            setShowMonsterPicker(false);
          }}
          onClose={() => setShowMonsterPicker(false)}
        />
      )}
      {showItemPicker && (
        <SrdPicker
          title="Elegir objeto para el marcador"
          category="equipment"
          onPick={(entry) => {
            setTokenItem({
              index: entry.index,
              name: entry.name,
              custom: Boolean(entry.custom),
            });
            setTokenName(entry.name);
            setShowItemPicker(false);
          }}
          onClose={() => setShowItemPicker(false)}
          renderMeta={(entry) => entry.meta?.damage?.dice ?? ''}
        />
      )}
    </div>
  );
}
