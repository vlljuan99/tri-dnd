import { Component, useEffect, useMemo, useState } from 'react';
import { worldToGrid } from '../domain/grid.js';
import { canMoveToken } from '../domain/permissions.js';
import { cellKey } from '../domain/cells.js';
import { useRoom } from '../../../store/socket.js';
import TacticalMapCanvas from './TacticalMapCanvas.jsx';
import AttackPanel from './AttackPanel.jsx';
import InventoryPanel from './InventoryPanel.jsx';
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
  const [combatTarget, setCombatTarget] = useState(null); // token objetivo del ataque
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

  // Área de movimiento: casillas alcanzables por el combatiente activo con
  // lo que le queda de movimiento (visible para toda la mesa al seleccionar
  // su token). Misma regla que valida el servidor: distancia Chebyshev
  // dentro del presupuesto, sobre casillas pisables (ni vacío ni obstáculo).
  const reachableCells = useMemo(() => {
    if (!combat.active || !activeCombatant?.speed || !activeToken) return [];
    if (!selectedToken || selectedToken.id !== activeToken.id) return [];
    const remaining = Math.floor(activeCombatant.speed / 5) - (activeCombatant.movedSquares ?? 0);
    if (remaining <= 0) return [];

    const blocked = new Set(map.disabledCells.map(([c, r]) => cellKey(c, r)));
    for (const room of map.rooms ?? []) {
      for (const [c, r] of room.obstacleCells ?? []) {
        blocked.add(cellKey(room.col + c, room.row + r));
      }
    }
    const origin = worldToGrid(activeToken.position, map.gridSize);
    const cols = Math.round(map.width / map.gridSize);
    const rows = Math.round(map.height / map.gridSize);
    const cells = [];
    for (let row = origin.row - remaining; row <= origin.row + remaining; row += 1) {
      for (let col = origin.col - remaining; col <= origin.col + remaining; col += 1) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        if (col === origin.col && row === origin.row) continue;
        if (blocked.has(cellKey(col, row))) continue;
        cells.push({ col, row });
      }
    }
    return cells;
  }, [activeCombatant, activeToken, combat.active, map, selectedToken]);

  // El objetivo del combate se mantiene fresco con cada refresco del mapa
  // (su HP cambia al recibir daño); si desaparece (ha caído), el panel se cierra
  useEffect(() => {
    if (!combatTarget) return;
    const fresh = map.tokens.find((t) => t.id === combatTarget.id);
    if (!fresh) setCombatTarget(null);
    else if (fresh !== combatTarget) setCombatTarget(fresh);
  }, [combatTarget, map.tokens]);

  // Con tu personaje seleccionado, pulsar un enemigo u otro PJ lo fija como
  // objetivo de ataque; cualquier otro caso simplemente selecciona el token.
  function handleSelectToken(tokenId) {
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
    setSelectedTokenId(tokenId);
    setCombatTarget(null);
    setInventoryOpen(false);
  }

  function sendCameraCommand(type) {
    setCameraCommand({ type, issuedAt: Date.now() });
  }

  function toggleMeasureMode() {
    setMeasureMode((value) => {
      if (!value) {
        setSelectedTokenId(null);
        setCombatTarget(null);
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
          onMoveToken={onMoveToken}
          onOpenDoor={onOpenDoor}
          onPing={onPing}
          pings={pings}
          measureMode={measureMode}
          measurePoints={measurePoints}
          onMeasurePoint={addMeasurePoint}
          reachableCells={reachableCells}
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
              : 'Selecciona un token y pulsa una casilla. Puerta: clic para abrir. Doble clic: ping.'}
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

      {combatTarget && selectedToken?.characterId && (
        <AttackPanel
          attacker={selectedToken}
          target={combatTarget}
          onClose={() => setCombatTarget(null)}
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

      {/* HUD y controles apilados en flujo normal (no cada uno con su propio
          "absolute bottom-X"): así nunca se solapan, tengan la altura que tengan */}
      <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-1.5 sm:inset-x-4 sm:bottom-4">
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
          }}
          onNudgeToken={nudgeSelectedToken}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
        />
      </div>
    </section>
  );
}
