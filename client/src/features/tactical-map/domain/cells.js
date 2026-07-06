export function cellKey(col, row) {
  return `${col},${row}`;
}

export function disabledCellsToSet(disabledCells) {
  return new Set((disabledCells ?? []).map(([col, row]) => cellKey(col, row)));
}

export function toggleDisabledCell(disabledCells, col, row) {
  const set = disabledCellsToSet(disabledCells);
  const key = cellKey(col, row);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set].map((entry) => entry.split(',').map(Number));
}

export function gridDimensions(map) {
  return {
    cols: Math.ceil(map.width / map.gridSize),
    rows: Math.ceil(map.height / map.gridSize),
  };
}

export function allCells(map) {
  const { cols, rows } = gridDimensions(map);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) cells.push([col, row]);
  }
  return cells;
}
