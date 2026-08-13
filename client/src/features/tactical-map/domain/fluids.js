export const FLUID_TYPES = [
  { key: 'agua', label: 'Agua', color: '#2386b8' },
  { key: 'lava', label: 'Lava', color: '#e34f18' },
  { key: 'niebla', label: 'Niebla tóxica', color: '#78a84b' },
  { key: 'veneno', label: 'Veneno / cieno', color: '#51652e' },
  { key: 'arcana', label: 'Agua arcana', color: '#74d8ff' },
];

export const FLUID_TYPE_KEYS = new Set(FLUID_TYPES.map((type) => type.key));

export const RECOMMENDED_FLUID_EFFECTS = Object.freeze({
  agua: Object.freeze({ movementCost: 2, damageDice: '', damageType: null, saveAbility: null, saveDc: 12, condition: null, visionRadius: null }),
  lava: Object.freeze({ movementCost: 2, damageDice: '2d6', damageType: 'fire', saveAbility: null, saveDc: 12, condition: null, visionRadius: null }),
  niebla: Object.freeze({ movementCost: 1, damageDice: '1d4', damageType: 'poison', saveAbility: 'con', saveDc: 12, condition: 'envenenado', visionRadius: 2 }),
  veneno: Object.freeze({ movementCost: 2, damageDice: '1d6', damageType: 'poison', saveAbility: 'con', saveDc: 12, condition: 'envenenado', visionRadius: null }),
  arcana: Object.freeze({ movementCost: 1, damageDice: '1d6', damageType: 'force', saveAbility: 'wis', saveDc: 12, condition: null, visionRadius: null }),
});

export function normalizeFluidEffects(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    FLUID_TYPES.map(({ key }) => [key, { ...RECOMMENDED_FLUID_EFFECTS[key], ...(source[key] ?? {}) }])
  );
}

export function fluidTypeAtBoardCell(map, col, row) {
  for (const room of map?.rooms ?? []) {
    const localCol = col - room.col;
    const localRow = row - room.row;
    if (localCol < 0 || localRow < 0 || localCol >= room.width || localRow >= room.height) continue;
    const type = (room.fluidCells ?? []).find(([c, r]) => c === localCol && r === localRow)?.[2];
    if (type) return type;
  }
  return null;
}

export function fluidTypesAlongBoardPath(map, path) {
  const types = [];
  for (const cell of path ?? []) {
    const type = fluidTypeAtBoardCell(map, cell.col, cell.row);
    if (type && !types.includes(type)) types.push(type);
  }
  return types;
}

export function fluidEffectSummary(type, effect) {
  const pieces = [];
  if ((effect?.movementCost ?? 1) > 1) pieces.push(`coste ${effect.movementCost}`);
  if (effect?.damageDice) pieces.push(`${effect.damageDice} de daño`);
  if (effect?.saveAbility) pieces.push(`salvación ${effect.saveAbility.toUpperCase()} CD ${effect.saveDc}`);
  if (effect?.condition) pieces.push(effect.condition);
  if (effect?.visionRadius) pieces.push(`visión ${effect.visionRadius}`);
  return pieces.length ? pieces.join(', ') : `${type}: sin efecto mecánico`;
}

// Un clic sustituye cualquier fluido previo de la casilla. Repetir el mismo
// tipo lo borra, igual que los demás pinceles de capas del editor.
export function paintFluidCell(cells, col, row, type, { erase = false } = {}) {
  const rest = (cells ?? []).filter(([cellCol, cellRow]) => cellCol !== col || cellRow !== row);
  const current = (cells ?? []).find(([cellCol, cellRow]) => cellCol === col && cellRow === row);
  if (erase || current?.[2] === type || !FLUID_TYPE_KEYS.has(type)) return rest;
  return [...rest, [col, row, type]];
}
