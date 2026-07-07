import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import { useMapEditor } from '../hooks/useMapEditor.js';
import EditorCanvas from '../components/EditorCanvas.jsx';
import RoomPanel from '../components/RoomPanel.jsx';
import DoorPanel from '../components/DoorPanel.jsx';
import TokenPanel from '../components/TokenPanel.jsx';

const TOKEN_KINDS = [
  { key: 'enemigo', label: 'Enemigo' },
  { key: 'aliado', label: 'Aliado' },
  { key: 'objeto', label: 'Objeto' },
  { key: 'trampa', label: 'Trampa' },
];

// Plantillas de sala para combinar piezas: habitaciones, salones y pasillos
const ROOM_TEMPLATES = [
  { key: 'habitacion', label: 'Habitación 6×6', width: 6, height: 6 },
  { key: 'salon', label: 'Salón 10×8', width: 10, height: 8 },
  { key: 'pasillo-h', label: 'Pasillo 8×2', width: 8, height: 2 },
  { key: 'pasillo-v', label: 'Pasillo 2×8', width: 2, height: 8 },
  { key: 'libre', label: 'Libre (N×M)', width: null, height: null },
];

const toolButton = (active) =>
  `rounded-sm border px-3 py-1 font-display text-xs uppercase tracking-widest ${
    active ? 'border-gold bg-gold/15 text-gold' : 'border-bone/20 text-bone/60 hover:border-bone/40'
  }`;

export default function MapEditorPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const [campaign, setCampaign] = useState(null);
  const [campaignError, setCampaignError] = useState('');

  const editor = useMapEditor(campaignId);
  const { map, maps, busy, error } = editor;

  const [activeFloorId, setActiveFloorId] = useState(null);
  const [selection, setSelection] = useState(null); // { type: 'room'|'door', id }
  const [mode, setMode] = useState('select'); // select | add-room | door | token
  const [template, setTemplate] = useState(ROOM_TEMPLATES[0]);
  const [customSize, setCustomSize] = useState({ width: 4, height: 4 });
  const [doorDraft, setDoorDraft] = useState(null); // { roomId, x, y }
  const [newMapName, setNewMapName] = useState('');
  const [tokenKind, setTokenKind] = useState('enemigo');
  const [tokenName, setTokenName] = useState('');

  useEffect(() => {
    api(`/campaigns/${campaignId}`)
      .then(({ campaign: loaded }) => setCampaign(loaded))
      .catch((e) => setCampaignError(e.message));
  }, [campaignId]);

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
  }, [editor.selectedMapId]);

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

  function templateSize() {
    return template.key === 'libre' ? customSize : { width: template.width, height: template.height };
  }

  async function placeRoom(cellPos) {
    const { width, height } = templateSize();
    if (!activeFloor || !Number.isInteger(width) || !Number.isInteger(height)) return;
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
    const name = tokenName.trim() || TOKEN_KINDS.find((k) => k.key === tokenKind)?.label || 'Marcador';
    const { token } = await editor.addToken(target.roomId, {
      kind: tokenKind,
      name,
      x: target.x,
      y: target.y,
    });
    setSelection({ type: 'token', id: token.id });
    setMode('select');
  }

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
      kind: fromFloor === toFloor ? 'puerta' : 'escalera',
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
        <p className="font-display text-xl text-blood">Solo el DM puede entrar al editor de campaña.</p>
        <Link to={`/campanas/${campaignId}`} className="text-gold underline">Volver a la mesa</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-night-950 text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/20 bg-night-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to={`/campanas/${campaignId}`} className="font-display text-sm text-gold/70 hover:text-gold">
            ← Mesa
          </Link>
          <h1 className="font-display text-xl tracking-wide text-gold">Editor de campaña</h1>
          <span className="text-sm text-bone/60">{campaign.name}</span>
        </div>
        {error && <p className="text-sm text-blood">{error}</p>}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Biblioteca de mapas */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-gold/15 bg-night-900/60">
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
                  <div className="mt-1 flex items-center gap-2">
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
        </aside>

        {/* Lienzo y herramientas */}
        <main className="flex min-w-0 flex-1 flex-col">
          {map ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-gold/15 bg-night-900/40 px-3 py-2">
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

                {/* Modos */}
                <button type="button" onClick={() => { setMode('select'); setDoorDraft(null); }} className={toolButton(mode === 'select')}>
                  Seleccionar
                </button>
                <button type="button" onClick={() => { setMode('add-room'); setSelection(null); setDoorDraft(null); }} className={toolButton(mode === 'add-room')}>
                  Añadir sala
                </button>
                <button type="button" onClick={() => { setMode('door'); setSelection(null); }} className={toolButton(mode === 'door')}>
                  Puerta
                </button>
                <button type="button" onClick={() => { setMode('token'); setSelection(null); setDoorDraft(null); }} className={toolButton(mode === 'token')}>
                  Marcador
                </button>

                {mode === 'add-room' && (
                  <>
                    <select
                      value={template.key}
                      onChange={(e) => setTemplate(ROOM_TEMPLATES.find((t) => t.key === e.target.value))}
                      className="rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-xs text-bone focus:border-gold focus:outline-none"
                    >
                      {ROOM_TEMPLATES.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
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
                  <span className="text-xs italic text-bone/50">
                    {doorDraft
                      ? 'ahora pulsa la casilla de destino en otra sala (puedes cambiar de planta)'
                      : 'pulsa la casilla de origen dentro de una sala'}
                  </span>
                )}
                {mode === 'token' && (
                  <>
                    <select
                      value={tokenKind}
                      onChange={(e) => setTokenKind(e.target.value)}
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
                    <span className="text-xs italic text-bone/50">clic en una sala para colocarlo</span>
                  </>
                )}
              </div>

              <EditorCanvas
                floor={activeFloor}
                doors={map.doors}
                tokens={floorTokens}
                selection={selection}
                mode={mode}
                doorDraft={doorDraft}
                busy={busy}
                onSelect={setSelection}
                onPlaceRoom={(cellPos) => placeRoom(cellPos).catch(() => {})}
                onDoorCellClick={(end) => doorCellClick(end).catch(() => {})}
                onTokenCellClick={(target) => placeToken(target).catch(() => {})}
                onMoveRoom={(roomId, pos) => editor.patchRoom(roomId, pos).catch(() => {})}
                onMoveToken={(tokenId, pos) => editor.patchToken(tokenId, pos).catch(() => {})}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <p className="max-w-sm text-bone/60">
                {maps?.length
                  ? 'Selecciona un mapa de la biblioteca para editarlo.'
                  : 'Crea tu primer mapa: podrás componerlo con salas, pasillos y salones conectados por puertas, y llevarlo a la mesa cuando esté listo.'}
              </p>
            </div>
          )}
        </main>

        {/* Panel derecho contextual */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-gold/15 bg-night-900/60">
          {selectedRoom ? (
            <RoomPanel
              room={selectedRoom}
              busy={busy}
              onPatch={(roomId, fields) => editor.patchRoom(roomId, fields).catch(() => {})}
              onDelete={(roomId) => {
                setSelection(null);
                editor.deleteRoom(roomId).catch(() => {});
              }}
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
          ) : selectedToken ? (
            <TokenPanel
              token={selectedToken}
              roomName={allRooms.find((r) => r.id === selectedToken.roomId)?.name || 'Sala'}
              busy={busy}
              onPatch={(tokenId, fields) => editor.patchToken(tokenId, fields).catch(() => {})}
              onDelete={(tokenId) => {
                setSelection(null);
                editor.deleteToken(tokenId).catch(() => {});
              }}
            />
          ) : map ? (
            <div className="space-y-3 p-3 text-sm text-bone/60">
              <div>
                <p className="text-[0.65rem] uppercase tracking-widest text-bone/50">Mapa</p>
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt('Nombre del mapa', map.name);
                    if (name?.trim()) editor.renameMap(map.id, name.trim());
                  }}
                  className="font-display text-base text-gold hover:underline"
                  title="Renombrar"
                >
                  {map.name}
                </button>
                {map.isActive && (
                  <p className="mt-1 text-[0.65rem] uppercase tracking-widest text-sage">● En la mesa</p>
                )}
              </div>
              <ul className="list-inside list-disc space-y-1 text-xs">
                <li>Arrastra una sala para recolocarla; combina pasillos y salones pegándolos.</li>
                <li>Las salas <span className="text-bone">ocultas</span> (borde discontinuo) no existen para los jugadores hasta que las reveles.</li>
                <li>Una puerta con control del DM (roja) solo se abre desde aquí o desde la mesa.</li>
                <li>Escaleras y portales conectan plantas distintas.</li>
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
