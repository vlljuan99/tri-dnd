import { Component, useMemo, useState } from 'react';
import { worldToGrid } from '../domain/grid.js';
import { canMoveToken } from '../domain/permissions.js';
import TacticalMapCanvas from './TacticalMapCanvas.jsx';
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
  backToCampaignHref,
  editorHref,
}) {
  const [selectedTokenId, setSelectedTokenId] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [cameraCommand, setCameraCommand] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const selectedToken = useMemo(
    () => map.tokens.find((token) => token.id === selectedTokenId) || null,
    [map.tokens, selectedTokenId]
  );
  const selectedCell = selectedToken ? worldToGrid(selectedToken.position, map.gridSize) : null;
  const isDm = role === 'dm';

  function sendCameraCommand(type) {
    setCameraCommand({ type, issuedAt: Date.now() });
  }

  function toggleMeasureMode() {
    setMeasureMode((value) => {
      if (!value) setSelectedTokenId(null);
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
          onSelectToken={setSelectedTokenId}
          onMoveToken={onMoveToken}
          onOpenDoor={onOpenDoor}
          onPing={onPing}
          pings={pings}
          measureMode={measureMode}
          measurePoints={measurePoints}
          onMeasurePoint={addMeasurePoint}
        />
      </CanvasErrorBoundary>

      <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-sm border border-gold/20 bg-night-900/90 p-3 text-bone shadow-xl backdrop-blur sm:left-4 sm:top-4">
        <p className="font-display text-sm tracking-wide text-gold">{map.name}</p>
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
                onClick={() => setSelectedTokenId(token.id)}
                aria-pressed={selectedTokenId === token.id}
                className={`flex w-full items-center justify-between gap-2 rounded-sm border px-2 py-2 text-left text-sm ${
                  selectedTokenId === token.id
                    ? 'border-gold bg-gold/10 text-gold'
                    : 'border-transparent text-bone hover:border-bone/20'
                }`}
              >
                <span className="truncate">{token.name}</span>
                <span className="shrink-0 text-[0.65rem] uppercase tracking-widest text-bone/55">
                  {token.speed ? `${Math.floor(token.speed / 5)} casillas · ` : ''}
                  {movable ? 'mover' : token.type}
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
        onClearSelection={() => setSelectedTokenId(null)}
        onNudgeToken={nudgeSelectedToken}
        backToCampaignHref={backToCampaignHref}
      />
    </section>
  );
}
