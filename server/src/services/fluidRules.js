import { DAMAGE_TYPES } from './damageResolution.js';
import { parseDiceNotation } from './serverDice.js';

export const FLUID_TYPES = ['agua', 'lava', 'niebla', 'veneno', 'arcana'];

// Reglas deliberadamente sencillas: sirven al instante y el DM puede
// afinarlas por mapa sin tener que configurar cada casilla por separado.
export const RECOMMENDED_FLUID_EFFECTS = Object.freeze({
  agua: Object.freeze({
    movementCost: 2,
    damageDice: '',
    damageType: null,
    saveAbility: null,
    saveDc: 12,
    condition: null,
    visionRadius: null,
  }),
  lava: Object.freeze({
    movementCost: 2,
    damageDice: '2d6',
    damageType: 'fire',
    saveAbility: null,
    saveDc: 12,
    condition: null,
    visionRadius: null,
  }),
  niebla: Object.freeze({
    movementCost: 1,
    damageDice: '1d4',
    damageType: 'poison',
    saveAbility: 'con',
    saveDc: 12,
    condition: 'envenenado',
    visionRadius: 2,
  }),
  veneno: Object.freeze({
    movementCost: 2,
    damageDice: '1d6',
    damageType: 'poison',
    saveAbility: 'con',
    saveDc: 12,
    condition: 'envenenado',
    visionRadius: null,
  }),
  arcana: Object.freeze({
    movementCost: 1,
    damageDice: '1d6',
    damageType: 'force',
    saveAbility: 'wis',
    saveDc: 12,
    condition: null,
    visionRadius: null,
  }),
});

const EFFECT_KEYS = new Set([
  'movementCost',
  'damageDice',
  'damageType',
  'saveAbility',
  'saveDc',
  'condition',
  'visionRadius',
]);
const ABILITIES = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const CONDITIONS = new Set([
  'envenenado', 'derribado', 'agarrado', 'aturdido', 'cegado', 'ensordecido',
  'asustado', 'hechizado', 'paralizado', 'petrificado', 'apresado', 'invisible',
  'inconsciente',
]);

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeFluidEffects(value) {
  const source = parseObject(value);
  return Object.fromEntries(
    FLUID_TYPES.map((type) => [
      type,
      { ...RECOMMENDED_FLUID_EFFECTS[type], ...(parseObject(source[type])) },
    ])
  );
}

function validateEffectValue(key, value) {
  if (key === 'movementCost') {
    return Number.isInteger(value) && value >= 1 && value <= 10
      ? null
      : 'El coste de movimiento debe estar entre 1 y 10';
  }
  if (key === 'damageDice') {
    return value === '' || (typeof value === 'string' && Boolean(parseDiceNotation(value)))
      ? null
      : 'El daño debe usar una fórmula como 1d6 o quedar vacío';
  }
  if (key === 'damageType') {
    return value === null || DAMAGE_TYPES.has(value) ? null : 'Tipo de daño no válido';
  }
  if (key === 'saveAbility') {
    return value === null || ABILITIES.has(value) ? null : 'Salvación no válida';
  }
  if (key === 'saveDc') {
    return Number.isInteger(value) && value >= 1 && value <= 30
      ? null
      : 'La CD debe estar entre 1 y 30';
  }
  if (key === 'condition') {
    return value === null || CONDITIONS.has(value) ? null : 'Condición no válida';
  }
  if (key === 'visionRadius') {
    return value === null || (Number.isInteger(value) && value >= 1 && value <= 30)
      ? null
      : 'El radio de visión debe estar entre 1 y 30 casillas';
  }
  return 'Ajuste de fluido no válido';
}

// El PATCH de un mapa acepta solo los tipos y propiedades presentes; el
// resto conserva sus valores. Esto hace baratos los controles del editor.
export function mergeFluidEffects(currentValue, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: 'La configuración de fluidos no es válida' };
  }
  const next = normalizeFluidEffects(currentValue);
  for (const [type, partial] of Object.entries(patch)) {
    if (!FLUID_TYPES.includes(type) || !partial || typeof partial !== 'object' || Array.isArray(partial)) {
      return { error: 'Tipo de fluido no válido' };
    }
    for (const [key, value] of Object.entries(partial)) {
      if (!EFFECT_KEYS.has(key)) return { error: 'Ajuste de fluido no válido' };
      const error = validateEffectValue(key, value);
      if (error) return { error };
      next[type][key] = typeof value === 'string' ? value.trim() : value;
    }
  }
  return { effects: next };
}

export function fluidMovementCost(effects, type) {
  return normalizeFluidEffects(effects)[type]?.movementCost ?? 1;
}

export function fluidTypeAtRoomPosition(room, x, y) {
  const col = x - room.x;
  const row = y - room.y;
  if (col < 0 || row < 0 || col >= room.width || row >= room.height) return null;
  let cells = [];
  try {
    cells = JSON.parse(room.fluid_cells || '[]');
  } catch {
    cells = [];
  }
  return cells.find(([c, r]) => c === col && r === row)?.[2] ?? null;
}
