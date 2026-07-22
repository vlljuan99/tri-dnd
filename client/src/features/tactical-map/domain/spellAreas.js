import { feetToSquares, gridDistance, spellRangeSquares } from './combatGeometry.js';

const AREA_TYPES = {
  sphere: 'sphere', esfera: 'sphere', radius: 'sphere',
  cone: 'cone', cono: 'cone',
  cube: 'cube', cubo: 'cube', square: 'cube', cuadrado: 'cube',
  cylinder: 'cylinder', cilindro: 'cylinder',
  line: 'line', línea: 'line', linea: 'line',
};

export function spellArea(data) {
  const raw = data?.area_of_effect ?? data?.area;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const typeName = Object.keys(AREA_TYPES).find((name) => new RegExp(name, 'i').test(raw));
    const feet = /(\d+)\s*(?:feet|foot|ft|pies?)/i.exec(raw)?.[1];
    if (!typeName || !feet) return null;
    return { type: AREA_TYPES[typeName], size: feetToSquares(feet, 1), width: 1 };
  }
  const type = AREA_TYPES[String(raw.type ?? raw.shape ?? '').toLowerCase()];
  const sizeFeet = Number(raw.size ?? raw.radius ?? raw.length);
  if (!type || !Number.isFinite(sizeFeet) || sizeFeet <= 0) return null;
  return {
    type,
    size: Math.min(60, feetToSquares(sizeFeet, 1)),
    width: Math.max(1, Math.min(20, feetToSquares(raw.width ?? 5, 1))),
  };
}

function direction(origin, aim) {
  const dx = aim.x - origin.x;
  const dy = aim.y - origin.y;
  const length = Math.hypot(dx, dy);
  return length ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
}

export function spellAreaCells({ origin, aim = origin, area, self = false }) {
  if (!area) return [{ x: aim.x, y: aim.y }];
  const cells = [];
  const directionVector = direction(origin, aim);
  const center = self && area.type === 'cube'
    ? {
        x: origin.x + Math.round(directionVector.x * Math.ceil(area.size / 2)),
        y: origin.y + Math.round(directionVector.y * Math.ceil(area.size / 2)),
      }
    : aim;
  const radius = area.type === 'cube' ? Math.max(0, Math.floor((area.size - 1) / 2)) : area.size;
  const limit = area.type === 'cube' ? Math.ceil((area.size - 1) / 2) : area.size;
  const loopCenter = area.type === 'cone' || area.type === 'line' ? origin : center;
  for (let y = loopCenter.y - limit; y <= loopCenter.y + limit; y += 1) {
    for (let x = loopCenter.x - limit; x <= loopCenter.x + limit; x += 1) {
      const cell = { x, y };
      if (area.type === 'sphere' || area.type === 'cylinder') {
        if (Math.hypot(x - center.x, y - center.y) <= area.size) cells.push(cell);
        continue;
      }
      if (area.type === 'cube') {
        const minX = center.x - radius;
        const minY = center.y - radius;
        if (x >= minX && x < minX + area.size && y >= minY && y < minY + area.size) cells.push(cell);
        continue;
      }
      const relative = { x: x - origin.x, y: y - origin.y };
      const forward = relative.x * directionVector.x + relative.y * directionVector.y;
      const side = Math.abs(relative.x * directionVector.y - relative.y * directionVector.x);
      if (forward <= 0 || forward > area.size) continue;
      if (area.type === 'cone' && side <= forward) cells.push(cell);
      if (area.type === 'line' && side <= area.width / 2) cells.push(cell);
    }
  }
  return cells;
}

export function spellAimValidation(data, origin, aim, hasSight = true) {
  const area = spellArea(data);
  const range = spellRangeSquares(data);
  const directionalSelf = range === 0 && (area?.type === 'cone' || area?.type === 'line' || area?.type === 'cube');
  if (range === 0 && !directionalSelf && (aim.x !== origin.x || aim.y !== origin.y)) {
    return { ok: false, error: 'Este conjuro está centrado en quien lo lanza' };
  }
  if (Number.isInteger(range) && range > 0 && gridDistance(origin, aim) > range) {
    return { ok: false, error: `Fuera de alcance: máximo ${range * 5} pies` };
  }
  if (!hasSight && range !== 0) return { ok: false, error: 'No hay línea de visión' };
  return { ok: true, area, range };
}
