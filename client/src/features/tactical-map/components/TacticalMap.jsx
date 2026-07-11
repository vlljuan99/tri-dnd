import { Component, useEffect, useMemo, useState } from 'react';
import { worldToGrid, gridToWorld } from '../domain/grid.js';
import { canMoveToken } from '../domain/permissions.js';
import { cellKey } from '../domain/cells.js';
import { buildBoardWalkable, findBoardPath, reachableWithin } from '../domain/pathfinding.js';
import { useRoom } from '../../../store/socket.js';
import TacticalMapCanvas from './TacticalMapCanvas.jsx';
import AttackPanel from './AttackPanel.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import InteractPanel from './InteractPanel.jsx';
import NotesPanel from './NotesPanel.jsx';
import GameDrawer from './GameDrawer.jsx';
import PlayerHud from './PlayerHud.jsx';
import CharacterQuickView from './CharacterQuickView.jsx';
import MapControls from './MapControls.jsx';

class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-night-950 p-6 text-center text-bone">
          <div>
            <p className="font-display text-lg text-blood">No se pudo mostrar el mapa táctico.</p>
            <p className="mt-2 text-sm text-bone/70">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function TacticalMap({
  map,
  user,
  role,
  savingTokenId,
  saveError,
  onMoveToken,
  onOpenDoor,
  doorError,
  onPing,
  pings,
  onSelectFloor,
  playerView,
  onTogglePlayerView,
  editorHref,
  ownCharacterId,
  campaignId,
}) {
  const [selectedTokenId, setSelectedTokenId] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [cameraCommand, setCameraCommand] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  // Vista previa de movimiento (estilo Baldur's Gate): destino, camino y
  // coste calculados al pulsar una casilla; el token no se mueve hasta confirmar
  const [movePreview, setMovePreview] = useState(null); // { cell, cost, path, remaining } | null
  const [combatTarget, setCombatTarget] = useState(null); // token objetivo del ataque
  const [interactTarget, setInteractTarget] = useState(null); // { type: 'door' | 'token', target }
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedToken = useMemo(
    () => map.tokens.find((token) => token.id === selectedTokenId) || null,
    [map.tokens, selectedTokenId]
  );
  const selectedCell = selectedToken ? worldToGrid(selectedToken.position, map.gridSize) : null;
  const isDm = role === 'dm';

  // --- Economía de turno (Fase 8.5) ---------------------------------
  const combat = useRoom((s) => s.combat);
  const endTurn = useRoom((s) => s.endTurn);
  const toggleTurnMode = useRoom((s) => s.toggleTurnMode);
  const activeCombatant = combat.active
    ? combat.combatants.find((c) => c.id === combat.turnId) ?? null
    : null;
  // ¿El combatiente activo es un PJ de este usuario? (el DM controla todos)
  const activeToken = activeCombatant?.characterId
    ? map.tokens.find((t) => t.characterId === activeCombatant.characterId) ?? null
    : null;
  // Es realmente TU turno (para el HUD y el botón "Terminar turno"): tu
  // propio personaje, nunca el DM salvo que además sea el dueño (caso raro,
  // PJ del propio DM)
  const isOwnCharacterTurn = Boolean(activeToken && activeToken.ownerUserId === user?.id);

  // --- Barra de estado (HUD) ------------------------------------------
  // El jugador siempre ve su propio personaje (útil saber tu HP aunque no
  // sea tu turno). El DM ve al combatiente ACTIVO —enemigo o PJ—, porque es
  // quien "juega" el turno de verdad: mostrarle siempre su propio PJ (si
  // tiene uno en esta partida) confundía de quién era el turno.
  const myToken = ownCharacterId ? map.tokens.find((t) => t.characterId === ownCharacterId) ?? null : null;
  const myCombatant = combat.combatants.find((c) => c.characterId === ownCharacterId) ?? null;
  const hudCombatant = isDm ? activeCombatant ?? myCombatant : myCombatant;
  const hudCharacterId = hudCombatant?.characterId ?? null;
  const hudToken = hudCharacterId
    ? map.tokens.find((t) => t.characterId === hudCharacterId) ?? null
    : null;
  // Enemigo activo: sin ficha ni token de personaje, solo nombre + lo que
  // trae el combatiente (HP/CA/velocidad, ya filtrados para el DM en servidor)
  const hudDisplay = hudCombatant
    ? { name: hudToken?.name ?? hudCombatant.name, imageUrl: hudToken?.imageUrl }
    : null;
  // Las notas son estrictamente privadas: el botón solo aparece viendo tu
  // propio personaje, nunca el de otro aunque seas el DM
  const canSeeHudNotes = Boolean(hudCharacterId) && hudCharacterId === ownCharacterId;

  // Grid de casillas pisables del tablero (con coste por terreno difícil):
  // lo comparten el área verde de alcance y la vista previa de movimiento.
  const boardWalkable = useMemo(() => buildBoardWalkable(map), [map]);

  // Terreno difícil aplanado a coordenadas del tablero, para pintarlo
  const terrainCells = useMemo(() => {
    const cells = [];
    for (const room of map.rooms ?? []) {
      for (const [c, r] of room.terrainCells ?? []) {
        cells.push({ col: room.col + c, row: room.row + r });
      }
    }
    return cells;
  }, [map.rooms]);

  // Área de movimiento: casillas alcanzables por el combatiente activo con
  // lo que le queda de movimiento (visible para toda la mesa al seleccionar
  // su token). Misma regla que valida el servidor: coste del camino real
  // (Dijkstra con terreno difícil) dentro del presupuesto.
  const reachableCells = useMemo(() => {
    if (!combat.active || !activeCombatant?.speed || !activeToken) return [];
    if (!selectedToken || selectedToken.id !== activeToken.id) return [];
    const remaining = Math.floor(activeCombatant.speed / 5) - (activeCombatant.movedSquares ?? 0);
    if (remaining <= 0) return [];
    const origin = worldToGrid(activeToken.position, map.gridSize);
    return reachableWithin(boardWalkable, origin, remaining);
  }, [activeCombatant, activeToken, boardWalkable, combat.active, map.gridSize, selectedToken]);

  // Movimiento que le queda al token seleccionado, si se puede saber desde
  // aquí (PJ con combatiente en el tracker y modo por turnos activo)
  const selectedRemaining = useMemo(() => {
    if (!combat.active || !selectedToken?.characterId) return null;
    const combatant = combat.combatants.find((c) => c.characterId === selectedToken.characterId);
    if (!combatant?.speed) return null;
    return Math.floor(combatant.speed / 5) - (combatant.movedSquares ?? 0);
  }, [combat, selectedToken]);

  // La vista previa muere con cualquier cambio de selección o del mapa (el
  // token pudo moverse por socket, el terreno cambiar, etc.)
  useEffect(() => {
    setMovePreview(null);
  }, [selectedTokenId, map]);

  // Escape: primero cancela la vista previa, después deselecciona
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      setMovePreview((preview) => {
        if (!preview) setSelectedTokenId(null);
        return null;
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Clic en el suelo: con un token tuyo seleccionado, calcula camino y coste
  // hasta esa casilla y muestra la vista previa (el movimiento espera a la
  // confirmación); clic fuera del suelo pisable = deseleccionar.
  function handleGroundClick(point) {
    if (!selectedToken) return;
    const cell = worldToGrid(point, map.gridSize);
    const walkableTarget = boardWalkable.has(cellKey(cell.col, cell.row));
    if (!walkableTarget) {
      // "Fuera": vacío, obstáculo o más allá del tablero → deseleccionar
      setMovePreview(null);
      setSelectedTokenId(null);
      return;
    }
    if (!canMoveToken({ token: selectedToken, user, role })) {
      // Token de otro (solo lectura): pulsar el suelo lo suelta
      setMovePreview(null);
      setSelectedTokenId(null);
      return;
    }
    const origin = worldToGrid(selectedToken.position, map.gridSize);
    if (origin.col === cell.col && origin.row === cell.row) {
      setMovePreview(null);
      return;
    }
    const result = findBoardPath(boardWalkable, origin, cell);
    if (!result) {
      setMovePreview({ cell, cost: null, path: [], remaining: selectedRemaining });
      return;
    }
    setMovePreview({ cell, cost: result.cost, path: result.path, remaining: selectedRemaining });
  }

  async function confirmMove() {
    if (!movePreview || movePreview.cost === null) return;
    const target = gridToWorld(movePreview.cell, map.gridSize);
    setMovePreview(null);
    await onMoveToken(selectedTokenId, target);
  }

  // El objetivo del combate se mantiene fresco con cada refresco del mapa
  // (su HP cambia al recibir daño); si desaparece (ha caído), el panel se cierra
  useEffect(() => {
    if (!combatTarget) return;
    const fresh = map.tokens.find((t) => t.id === combatTarget.id);
    if (!fresh) setCombatTarget(null);
    else if (fresh !== combatTarget) setCombatTarget(fresh);
  }, [combatTarget, map.tokens]);

  // Con tu personaje seleccionado, pulsar un enemigo u otro PJ lo fija como
  // objetivo de ataque, y un marcador de trampa/objeto abre el popup de
  // interactuar (Fase 8.7); cualquier otro caso simplemente selecciona el token.
  function handleSelectToken(tokenId) {
    // Re-pulsar el token ya seleccionado lo deselecciona (toggle)
    if (tokenId === selectedTokenId) {
      setSelectedTokenId(null);
      setMovePreview(null);
      setCombatTarget(null);
      setInteractTarget(null);
      return;
    }
    const clicked = map.tokens.find((t) => t.id === tokenId);
    const canAttackFrom =
      selectedToken?.characterId && canMoveToken({ token: selectedToken, user, role });
    const attackable =
      clicked &&
      clicked.id !== selectedToken?.id &&
      ((clicked.serverId && clicked.type === 'enemy') ||
        (clicked.characterId && clicked.characterId !== selectedToken?.characterId));
    if (canAttackFrom && attackable) {
      setCombatTarget(clicked);
      setInventoryOpen(false);
      return;
    }
    const interactable =
      !isDm && clicked && clicked.serverId && (clicked.kind === 'trampa' || clicked.kind === 'objeto');
    if (canAttackFrom && interactable) {
      setInteractTarget({ type: 'token', target: clicked });
      setInventoryOpen(false);
      return;
    }
    setSelectedTokenId(tokenId);
    setCombatTarget(null);
    setInteractTarget(null);
    setInventoryOpen(false);
  }

  // Abrir una puerta: el DM la alterna directo (sin coste), el jugador pasa
  // por el popup de confirmación (adyacencia, turno y tirada los valida el
  // servidor al confirmar).
  function handleOpenDoor(door) {
    if (isDm) {
      onOpenDoor(door);
      return;
    }
    if (door.isOpen) return;
    setInteractTarget({ type: 'door', target: door });
  }

  function sendCameraCommand(type) {
    setCameraCommand({ type, issuedAt: Date.now() });
  }

  function toggleMeasureMode() {
    setMeasureMode((value) => {
      if (!value) {
        setSelectedTokenId(null);
        setCombatTarget(null);
        setInteractTarget(null);
      }
      setMeasurePoints([]);
      return !value;
    });
  }

  // Cada clic centra el punto en su casilla; al tercer clic empieza una
  // medición nueva desde ahí
  function addMeasurePoint(point) {
    const snap = (v) => (Math.floor(v / map.gridSize) + 0.5) * map.gridSize;
    const snapped = { x: snap(point.x), z: snap(point.z) };
    setMeasurePoints((current) => (current.length >= 2 ? [snapped] : [...current, snapped]));
  }

  function nudgeSelectedToken(dx, dz) {
    if (!selectedToken) return;
    onMoveToken(selectedToken.id, {
      x: selectedToken.position.x + dx * map.gridSize,
      y: 0,
      z: selectedToken.position.z + dz * map.gridSize,
    });
  }

  return (
    <section className="relative min-h-0 flex-1 overflow-hidden bg-night-950">
      <CanvasErrorBoundary>
        <TacticalMapCanvas
          map={map}
          user={user}
          role={role}
          selectedTokenId={selectedTokenId}
          showGrid={showGrid}
          savingTokenId={savingTokenId}
          cameraCommand={cameraCommand}
          onSelectToken={handleSelectToken}
          onGroundClick={handleGroundClick}
          onOpenDoor={handleOpenDoor}
          onPing={onPing}
          pings={pings}
          measureMode={measureMode}
          measurePoints={measurePoints}
          onMeasurePoint={addMeasurePoint}
          reachableCells={reachableCells}
          terrainCells={terrainCells}
          pathCells={movePreview?.path ?? []}
        />
      </CanvasErrorBoundary>

      <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-sm border border-gold/20 bg-night-900/90 p-3 text-bone shadow-xl backdrop-blur sm:left-4 sm:top-4">
        <p className="font-display text-sm tracking-wide text-gold">{map.name}</p>
        {combat.active && isDm && (
          <button
            type="button"
            onClick={() => toggleTurnMode()}
            title="Modo libre: moverse y actuar sin restricción de turno, sin vaciar el tracker"
            className="mt-1.5 rounded-sm border border-bone/25 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-bone/70 hover:border-gold hover:text-gold"
          >
            Modo libre
          </button>
        )}
        {!combat.active && isDm && (
          <button
            type="button"
            onClick={() => toggleTurnMode()}
            title="Activa el modo por turnos: iniciativas nuevas y movimiento/acción solo en tu turno"
            className="mt-1.5 rounded-sm border border-moss px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-bone/80 hover:bg-moss/20"
          >
            Activar modo por turnos
          </button>
        )}
        {(map.floors?.length ?? 0) > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {map.floors.map((floor) => (
              <button
                key={floor.id}
                type="button"
                onClick={() => onSelectFloor?.(floor.id)}
                aria-pressed={floor.id === map.floorId}
                className={`rounded-sm border px-2 py-0.5 font-display text-[0.65rem] uppercase tracking-widest ${
                  floor.id === map.floorId
                    ? 'border-gold bg-gold/15 text-gold'
                    : 'border-bone/20 text-bone/60 hover:border-gold/50 hover:text-gold'
                }`}
              >
                {floor.name}
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-bone/65">
          {measureMode
            ? 'Modo medir: pulsa dos casillas para ver la distancia.'
            : selectedToken
              ? `${selectedToken.name} seleccionado · casilla ${selectedCell.col}, ${selectedCell.row}${
                  selectedToken.speed
                    ? ` · velocidad ${selectedToken.speed} pies (${Math.floor(selectedToken.speed / 5)} casillas)`
                    : ''
                }${canMoveToken({ token: selectedToken, user, role }) ? '' : ' · solo lectura'}`
              : 'Selecciona un token y pulsa una casilla: verás el coste antes de mover. Puerta: clic para abrir. Doble clic: ping.'}
        </p>
        {saveError && <p className="mt-2 text-xs text-blood">{saveError}</p>}
        {doorError && <p className="mt-2 text-xs text-blood">{doorError}</p>}
      </div>

      <div className="absolute right-3 top-3 z-10 hidden max-h-[42vh] w-56 overflow-y-auto rounded-sm border border-gold/20 bg-night-900/90 p-2 shadow-xl backdrop-blur md:block">
        <p className="mb-2 px-1 font-display text-xs uppercase tracking-widest text-gold/80">Tokens</p>
        <div className="space-y-1">
          {map.tokens.map((token) => {
            const movable = canMoveToken({ token, user, role });
            return (
              <button
                key={token.id}
                type="button"
                onClick={() => handleSelectToken(token.id)}
                aria-pressed={selectedTokenId === token.id}
                className={`flex w-full flex-col gap-1.5 rounded-sm border px-2 py-2 text-left text-sm ${
                  selectedTokenId === token.id
                    ? 'border-gold bg-gold/10 text-gold'
                    : 'border-transparent text-bone hover:border-bone/20'
                }`}
              >
                <span className="truncate font-medium">{token.name}</span>
                <div className="flex items-center justify-between gap-2">
                  {Number.isInteger(token.hp) && Number.isInteger(token.hpMax) && token.hpMax > 0 ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-12 overflow-hidden rounded-sm bg-night-950">
                        <span
                          className={`block h-full ${
                            token.hp / token.hpMax > 0.5
                              ? 'bg-moss'
                              : token.hp / token.hpMax > 0.25
                                ? 'bg-ochre'
                                : 'bg-blood'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, (token.hp / token.hpMax) * 100))}%` }}
                        />
                      </span>
                      <span className="font-mono text-[0.65rem] text-bone/60">
                        {token.hp}/{token.hpMax}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[0.65rem] text-bone/40">—</span>
                  )}
                  <span className="text-[0.65rem] uppercase tracking-widest text-bone/55">
                    {token.speed ? `${Math.floor(token.speed / 5)} cas` : movable ? 'mover' : token.type}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Vista previa de movimiento (estilo Baldur's Gate): coste del camino
          y confirmación antes de mover; el servidor re-valida al confirmar */}
      {movePreview && selectedToken && (
        <div className="absolute bottom-24 left-1/2 z-20 w-[19rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-gold/30 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">
              Mover a {selectedToken.name}
            </p>
            <button
              onClick={() => setMovePreview(null)}
              aria-label="Cancelar movimiento"
              className="px-1 text-bone/60 hover:text-bone"
            >
              ✕
            </button>
          </div>
          {movePreview.cost === null ? (
            <p className="text-sm text-blood">No hay camino hasta esa casilla.</p>
          ) : (
            <>
              <p className="text-sm text-bone/80">
                Coste: <span className="font-mono text-gold">{movePreview.cost}</span> de movimiento
                {movePreview.remaining != null && (
                  <span
                    className={`ml-1 font-mono text-xs ${
                      movePreview.cost > movePreview.remaining ? 'text-blood' : 'text-bone/50'
                    }`}
                  >
                    (te quedan {movePreview.remaining})
                  </span>
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => confirmMove()}
                  disabled={movePreview.remaining != null && movePreview.cost > movePreview.remaining}
                  className="flex-1 rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
                >
                  Mover
                </button>
                <button
                  onClick={() => setMovePreview(null)}
                  className="rounded-sm border border-bone/25 px-3 py-1.5 text-sm text-bone/70 hover:bg-bone/5"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {combatTarget && selectedToken?.characterId && (
        <AttackPanel
          attacker={selectedToken}
          target={combatTarget}
          onClose={() => setCombatTarget(null)}
        />
      )}

      {interactTarget && ownCharacterId && (
        <InteractPanel
          type={interactTarget.type}
          target={interactTarget.target}
          campaignId={campaignId}
          characterId={ownCharacterId}
          combat={combat}
          onClose={() => setInteractTarget(null)}
        />
      )}

      {inventoryOpen && hudToken && (
        <InventoryPanel
          token={hudToken}
          isOwner={hudToken.ownerUserId === user?.id}
          isDm={isDm}
          combat={combat}
          onClose={() => setInventoryOpen(false)}
        />
      )}

      {notesOpen && canSeeHudNotes && (
        <NotesPanel characterId={ownCharacterId} onClose={() => setNotesOpen(false)} />
      )}

      {sheetOpen && hudCharacterId && (
        <CharacterQuickView characterId={hudCharacterId} onClose={() => setSheetOpen(false)} />
      )}

      {drawerOpen && (
        <GameDrawer
          campaignId={campaignId}
          isDm={isDm}
          userId={user?.id}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Footer de ancho completo en tres zonas fijas (como la cabecera):
          45% cámara+mesa/editor/vista, 5% movimiento, el resto tu personaje.
          Cada grupo mantiene su propia caja separada (mismo estilo que ya
          tenían); solo cambia dónde se reparte el ancho. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end gap-0 px-3 pb-3 sm:px-4 sm:pb-4">
        <MapControls
          showGrid={showGrid}
          selectedToken={selectedToken}
          isDm={isDm}
          measureMode={measureMode}
          onToggleMeasureMode={toggleMeasureMode}
          playerView={playerView}
          onTogglePlayerView={onTogglePlayerView}
          editorHref={editorHref}
          onCenter={() => sendCameraCommand('center')}
          onZoomIn={() => sendCameraCommand('zoom-in')}
          onZoomOut={() => sendCameraCommand('zoom-out')}
          onToggleGrid={() => setShowGrid((value) => !value)}
          onClearSelection={() => {
            setSelectedTokenId(null);
            setCombatTarget(null);
            setInteractTarget(null);
          }}
          onNudgeToken={nudgeSelectedToken}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
        />

        <div className="pointer-events-auto flex flex-1 items-end justify-start">
          <PlayerHud
            token={hudDisplay}
            combatant={hudCombatant}
            combatActive={combat.active}
            // El botón de terminar turno es de quien de verdad puede pulsarlo:
            // el dueño del PJ mostrado, o el DM (controla enemigos y, si hace
            // falta, PJ ausentes)
            isMyTurn={Boolean(hudCombatant) && combat.turnId === hudCombatant.id && (isDm || isOwnCharacterTurn)}
            onEndTurn={async () => {
              const resp = await endTurn();
              if (resp?.error) window.alert(resp.error);
            }}
            // Ficha/Inventario son conceptos de personaje: no existen para un
            // enemigo, solo se ofrecen si hay un characterId (aunque sea el de
            // otro PJ, se ven en solo lectura); Notas es siempre tuyo y punto
            characterId={hudCharacterId}
            canSeeNotes={canSeeHudNotes}
            onOpenSheet={() => setSheetOpen(true)}
            onOpenInventory={() => setInventoryOpen((v) => !v)}
            onOpenNotes={() => setNotesOpen((v) => !v)}
          />
        </div>
      </div>
    </section>
  );
}
