import { useMemo, useRef, useState } from 'react';

// Lienzo 2D del editor: plano cenital de una planta con sus salas y puertas.
// Coordenadas en casillas del lienzo de la planta (pueden ser negativas);
// aquí se convierten a píxeles restando el origen visible (bounds).
const BASE_CELL = 28;
const PADDING_CELLS = 3;

function floorBounds(rooms) {
  if (!rooms.length) {
    return { minX: -PADDING_CELLS, minY: -PADDING_CELLS, maxX: 16 + PADDING_CELLS, maxY: 10 + PADDING_CELLS };
  }
  const minX = Math.min(...rooms.map((r) => r.x)) - PADDING_CELLS;
  const minY = Math.min(...rooms.map((r) => r.y)) - PADDING_CELLS;
  const maxX = Math.max(...rooms.map((r) => r.x + r.width)) + PADDING_CELLS;
  const maxY = Math.max(...rooms.map((r) => r.y + r.height)) + PADDING_CELLS;
  return { minX, minY, maxX, maxY };
}

function DoorMarker({ door, x, y, cell, toPx, selected, onSelect }) {
  const cx = toPx.x(x) + cell / 2;
  const cy = toPx.y(y) + cell / 2;
  const isDm = door.control === 'dm';
  const stroke = selected ? '#e8c368' : isDm ? '#b33939' : '#c9a86a';
  const fill = door.isOpen ? 'transparent' : stroke;

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: 'door', id: door.id });
      }}
      className="cursor-pointer"
    >
      {door.kind === 'portal' ? (
        <circle cx={cx} cy={cy} r={cell * 0.3} fill={fill} stroke={stroke} strokeWidth={2} opacity={0.9} />
      ) : door.kind === 'escalera' ? (
        <g stroke={stroke} strokeWidth={2} opacity={0.9}>
          <rect x={cx - cell * 0.3} y={cy - cell * 0.3} width={cell * 0.6} height={cell * 0.6} fill="transparent" />
          <line x1={cx - cell * 0.3} y1={cy - cell * 0.1} x2={cx + cell * 0.3} y2={cy - cell * 0.1} />
          <line x1={cx - cell * 0.3} y1={cy + cell * 0.1} x2={cx + cell * 0.3} y2={cy + cell * 0.1} />
        </g>
      ) : (
        <rect
          x={cx - cell * 0.32}
          y={cy - cell * 0.14}
          width={cell * 0.64}
          height={cell * 0.28}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          opacity={0.9}
          rx={2}
        />
      )}
      {selected && <circle cx={cx} cy={cy} r={cell * 0.45} fill="none" stroke="#e8c368" strokeDasharray="3 3" />}
    </g>
  );
}

const TOKEN_COLORS = {
  enemigo: '#b33939',
  aliado: '#4a8bd6',
  objeto: '#c9a86a',
  trampa: '#8a5fb5',
};

export default function EditorCanvas({
  floor,
  doors,
  tokens = [],
  selection,
  mode,
  doorDraft,
  busy,
  onSelect,
  onPlaceRoom,
  onDoorCellClick,
  onTokenCellClick,
  onMoveRoom,
  onMoveToken,
}) {
  const [zoom, setZoom] = useState(1);
  // { type: 'room'|'token', id, startX, startY, origX, origY, dx, dy, moved }
  const [drag, setDrag] = useState(null);
  const svgRef = useRef(null);
  const cell = BASE_CELL * zoom;

  const rooms = floor?.rooms ?? [];
  const bounds = useMemo(() => floorBounds(rooms), [rooms]);
  const cols = bounds.maxX - bounds.minX;
  const rows = bounds.maxY - bounds.minY;
  const toPx = {
    x: (cx) => (cx - bounds.minX) * cell,
    y: (cy) => (cy - bounds.minY) * cell,
  };
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  function eventCell(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / cell) + bounds.minX,
      y: Math.floor((e.clientY - rect.top) / cell) + bounds.minY,
    };
  }

  function roomAt(cellPos) {
    return rooms.find(
      (r) =>
        cellPos.x >= r.x &&
        cellPos.x < r.x + r.width &&
        cellPos.y >= r.y &&
        cellPos.y < r.y + r.height &&
        !r.disabledCells.some(([c, w]) => c === cellPos.x - r.x && w === cellPos.y - r.y)
    );
  }

  function handleCanvasClick(e) {
    if (busy || drag?.moved) return;
    const cellPos = eventCell(e);
    const room = roomAt(cellPos);

    if (mode === 'add-room') {
      onPlaceRoom(cellPos);
    } else if (mode === 'door') {
      if (room) onDoorCellClick({ roomId: room.id, x: cellPos.x, y: cellPos.y });
    } else if (mode === 'token') {
      if (room) onTokenCellClick({ roomId: room.id, x: cellPos.x, y: cellPos.y });
    } else if (!room) {
      onSelect(null);
    }
  }

  function startDrag(e, type, id, origX, origY) {
    onSelect({ type, id });
    svgRef.current.setPointerCapture?.(e.pointerId);
    setDrag({ type, id, startX: e.clientX, startY: e.clientY, origX, origY, dx: 0, dy: 0, moved: false });
  }

  function handleRoomPointerDown(e, room) {
    if (mode !== 'select' || busy) return;
    e.stopPropagation();
    startDrag(e, 'room', room.id, room.x, room.y);
  }

  function handleTokenPointerDown(e, token) {
    if (mode !== 'select' || busy) return;
    e.stopPropagation();
    startDrag(e, 'token', token.id, token.x, token.y);
  }

  function handlePointerMove(e) {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.startX) / cell);
    const dy = Math.round((e.clientY - drag.startY) / cell);
    if (dx !== drag.dx || dy !== drag.dy) {
      setDrag({ ...drag, dx, dy, moved: drag.moved || dx !== 0 || dy !== 0 });
    }
  }

  function handlePointerUp() {
    if (!drag) return;
    if (drag.moved && (drag.dx !== 0 || drag.dy !== 0)) {
      const next = { x: drag.origX + drag.dx, y: drag.origY + drag.dy };
      if (drag.type === 'room') onMoveRoom(drag.id, next);
      else onMoveToken(drag.id, next);
    }
    setDrag(null);
  }

  function roomScreenPos(room) {
    const isDragging = drag?.type === 'room' && drag.id === room.id;
    const rx = isDragging ? room.x + drag.dx : room.x;
    const ry = isDragging ? room.y + drag.dy : room.y;
    return { left: toPx.x(rx), top: toPx.y(ry) };
  }

  function tokenScreenCenter(token) {
    const isDragging = drag?.type === 'token' && drag.id === token.id;
    const tx = isDragging ? token.x + drag.dx : token.x;
    const ty = isDragging ? token.y + drag.dy : token.y;
    return { cx: toPx.x(tx) + cell / 2, cy: toPx.y(ty) + cell / 2 };
  }

  const gridLines = [];
  for (let c = 0; c <= cols; c += 1) {
    gridLines.push(<line key={`v${c}`} x1={c * cell} y1={0} x2={c * cell} y2={rows * cell} />);
  }
  for (let r = 0; r <= rows; r += 1) {
    gridLines.push(<line key={`h${r}`} x1={0} y1={r * cell} x2={cols * cell} y2={r * cell} />);
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-auto bg-night-950">
      <svg
        ref={svgRef}
        width={cols * cell}
        height={rows * cell}
        onClick={handleCanvasClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={
          mode === 'add-room' || mode === 'token'
            ? 'cursor-copy'
            : mode === 'door'
              ? 'cursor-crosshair'
              : 'cursor-default'
        }
      >
        <g stroke="#e8dfc9" strokeOpacity={0.07}>{gridLines}</g>

        {rooms.map((room) => {
          const pos = roomScreenPos(room);
          const w = room.width * cell;
          const h = room.height * cell;
          const isSelected = selection?.type === 'room' && selection.id === room.id;
          return (
            <g key={room.id} onPointerDown={(e) => handleRoomPointerDown(e, room)} className="cursor-move">
              {room.backgroundUrl ? (
                <image
                  href={room.backgroundUrl}
                  x={pos.left}
                  y={pos.top}
                  width={w}
                  height={h}
                  preserveAspectRatio="none"
                  opacity={room.revealed ? 1 : 0.45}
                />
              ) : (
                <rect
                  x={pos.left}
                  y={pos.top}
                  width={w}
                  height={h}
                  fill={room.revealed ? '#3a3128' : '#241f1a'}
                />
              )}
              {room.disabledCells.map(([c, r]) => (
                <rect
                  key={`${c},${r}`}
                  x={pos.left + c * cell}
                  y={pos.top + r * cell}
                  width={cell}
                  height={cell}
                  fill="#14110f"
                  fillOpacity={0.92}
                />
              ))}
              <rect
                x={pos.left}
                y={pos.top}
                width={w}
                height={h}
                fill="none"
                stroke={isSelected ? '#e8c368' : room.revealed ? '#c9a86a' : '#6b5d4a'}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeDasharray={room.revealed ? undefined : '5 4'}
              />
              <text
                x={pos.left + 6}
                y={pos.top + 16}
                fill={room.revealed ? '#e8dfc9' : '#8a7c66'}
                fontSize={12}
                className="pointer-events-none select-none font-display"
              >
                {room.name}
                {!room.revealed && ' · oculta'}
              </text>
            </g>
          );
        })}

        {/* Línea entre los dos extremos de cada puerta cuya salas estén en esta planta */}
        {doors.map((door) => {
          const from = roomById.get(door.fromRoomId);
          const to = roomById.get(door.toRoomId);
          if (!from || !to) return null;
          return (
            <line
              key={`link-${door.id}`}
              x1={toPx.x(door.fromX) + cell / 2}
              y1={toPx.y(door.fromY) + cell / 2}
              x2={toPx.x(door.toX) + cell / 2}
              y2={toPx.y(door.toY) + cell / 2}
              stroke="#c9a86a"
              strokeOpacity={0.35}
              strokeDasharray="4 4"
            />
          );
        })}
        {doors.map((door) => {
          const markers = [];
          if (roomById.has(door.fromRoomId)) {
            markers.push(
              <DoorMarker
                key={`from-${door.id}`}
                door={door}
                x={door.fromX}
                y={door.fromY}
                cell={cell}
                toPx={toPx}
                selected={selection?.type === 'door' && selection.id === door.id}
                onSelect={onSelect}
              />
            );
          }
          if (roomById.has(door.toRoomId)) {
            markers.push(
              <DoorMarker
                key={`to-${door.id}`}
                door={door}
                x={door.toX}
                y={door.toY}
                cell={cell}
                toPx={toPx}
                selected={selection?.type === 'door' && selection.id === door.id}
                onSelect={onSelect}
              />
            );
          }
          return markers;
        })}

        {/* Marcadores preparados: enemigos, aliados, objetos y trampas */}
        {tokens.map((token) => {
          const { cx, cy } = tokenScreenCenter(token);
          const color = TOKEN_COLORS[token.kind] ?? TOKEN_COLORS.enemigo;
          const isSelected = selection?.type === 'token' && selection.id === token.id;
          return (
            <g
              key={`token-${token.id}`}
              onPointerDown={(e) => handleTokenPointerDown(e, token)}
              className={mode === 'select' ? 'cursor-move' : 'pointer-events-none'}
              opacity={token.hidden ? 0.55 : 1}
            >
              <circle
                cx={cx}
                cy={cy}
                r={cell * 0.34}
                fill={color}
                stroke={isSelected ? '#e8c368' : '#14110f'}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeDasharray={token.hidden ? '3 3' : undefined}
              />
              <text
                x={cx}
                y={cy + cell * 0.13}
                textAnchor="middle"
                fill="#f2ead8"
                fontSize={cell * 0.36}
                className="pointer-events-none select-none font-display"
              >
                {token.name.charAt(0).toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Primer extremo de una puerta a medio crear */}
        {doorDraft && roomById.has(doorDraft.roomId) && (
          <circle
            cx={toPx.x(doorDraft.x) + cell / 2}
            cy={toPx.y(doorDraft.y) + cell / 2}
            r={cell * 0.35}
            fill="none"
            stroke="#e8c368"
            strokeWidth={2}
            strokeDasharray="4 3"
            className="animate-pulse"
          />
        )}
      </svg>

      <div className="absolute bottom-3 right-3 flex gap-1 rounded-sm border border-gold/20 bg-night-900/90 p-1">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 4) / 4))}
          className="h-8 w-8 rounded-sm text-gold hover:bg-gold/10"
          aria-label="Alejar"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.25) * 4) / 4))}
          className="h-8 w-8 rounded-sm text-gold hover:bg-gold/10"
          aria-label="Acercar"
        >
          +
        </button>
      </div>
    </div>
  );
}
