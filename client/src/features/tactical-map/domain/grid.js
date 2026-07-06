export function assertValidGridSize(gridSize) {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    throw new Error('El tamaño de casilla debe ser mayor que cero');
  }
}

export function worldToGrid(position, gridSize) {
  assertValidGridSize(gridSize);
  return {
    col: Math.floor(position.x / gridSize),
    row: Math.floor(position.z / gridSize),
  };
}

export function gridToWorld(cell, gridSize) {
  assertValidGridSize(gridSize);
  return {
    x: cell.col * gridSize + gridSize / 2,
    y: 0,
    z: cell.row * gridSize + gridSize / 2,
  };
}

export function snapToGrid(position, gridSize) {
  return gridToWorld(worldToGrid(position, gridSize), gridSize);
}

export function clampGridCell(cell, map) {
  const maxCol = Math.max(0, Math.ceil(map.width / map.gridSize) - 1);
  const maxRow = Math.max(0, Math.ceil(map.height / map.gridSize) - 1);
  return {
    col: Math.min(Math.max(cell.col, 0), maxCol),
    row: Math.min(Math.max(cell.row, 0), maxRow),
  };
}

export function snapToMapGrid(position, map) {
  return gridToWorld(clampGridCell(worldToGrid(position, map.gridSize), map), map.gridSize);
}
