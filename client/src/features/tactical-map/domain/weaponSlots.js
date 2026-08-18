import { abilityModifier, proficiencyBonus, weaponAttackBonus, weaponDamageModifier } from '../../../lib/dnd.js';
import { rangeValidation, weaponGeometry } from './combatGeometry.js';
import { cellsWithinSight } from './vision.js';

// Las armas del personaje tal y como las necesita el hotbar: para elegirlas de
// un vistazo hace falta saber, sin abrir nada, qué alcance tienen y si el
// objetivo cae dentro. Antes esto solo existía dentro del panel de ataque, que
// únicamente se abre DESPUÉS de pulsar a un enemigo: el jugador tenía que
// adivinar el gesto para descubrir cómo se ataca.

const UNARMED_GEOMETRY = { ranged: false, reach: 1, normalRange: null, longRange: null, thrown: false };

/** Golpe desarmado de 5e: ataque FUE + competencia, daño fijo 1 + FUE. */
export function unarmedSlot(character) {
  const str = abilityModifier(character?.abilities?.str ?? 10);
  return {
    id: 'desarmado',
    name: 'Golpe desarmado',
    unarmed: true,
    thrown: false,
    geometry: UNARMED_GEOMETRY,
    attackBonus: str + proficiencyBonus(character?.level ?? 1),
    damageLabel: `${Math.max(1, 1 + str)} contundente`,
  };
}

function damageLabel(character, item) {
  const modifier = weaponDamageModifier(character, item.weapon);
  const sign = modifier >= 0 ? '+' : '−';
  return modifier ? `${item.weapon.damageDice} ${sign} ${Math.abs(modifier)}` : item.weapon.damageDice;
}

/** ¿Es un arma que el personaje lleva en la mano ahora mismo? */
export function isWielded(item) {
  return Boolean(item?.weapon) && (item.slot === 'mano-principal' || item.slot === 'mano-secundaria');
}

/**
 * Armas empuñadas + el golpe desarmado, en el orden en que se pintan en el
 * hotbar. Un arma arrojadiza aparece una sola vez: el modo de lanzarla se
 * elige en el panel, no ocupa un slot aparte. Lo que está en la mochila no
 * entra: el hotbar enseña con qué puedes atacar YA.
 */
export function weaponSlots(character) {
  if (!character) return [];
  const equipped = (character.inventory ?? []).filter(isWielded);
  return [
    ...equipped.map((item) => ({
      id: item.id,
      name: item.name,
      weapon: item.weapon,
      unarmed: false,
      thrown: Boolean(item.weapon?.properties?.includes('thrown')),
      geometry: weaponGeometry(item.weapon),
      attackBonus: weaponAttackBonus(character, item),
      damageLabel: damageLabel(character, item),
    })),
    unarmedSlot(character),
  ];
}

/** "Cuerpo a cuerpo · 5 pies" / "A distancia · 80/320 pies", para el tooltip. */
export function rangeLabel(geometry) {
  if (!geometry?.ranged) return `Cuerpo a cuerpo · ${(geometry?.reach ?? 1) * 5} pies`;
  const normal = (geometry.normalRange ?? 0) * 5;
  const long = (geometry.longRange ?? geometry.normalRange ?? 0) * 5;
  return long > normal ? `A distancia · ${normal}/${long} pies` : `A distancia · ${normal} pies`;
}

/**
 * Qué pasa si disparas AHORA a un objetivo a `distance` casillas. Es el mismo
 * criterio que valida `rangeValidation` (y el servidor detrás), traducido a
 * algo que se puede pintar: un color y una frase.
 *
 * @returns { state: 'alcance' | 'larga' | 'fuera' | 'sin-vision', label, canAttack }
 */
export function targetRangeState(distance, geometry, { lineOfSight = true } = {}) {
  if (!Number.isFinite(distance)) return { state: 'fuera', label: 'Sin objetivo', canAttack: false };
  if (!lineOfSight) return { state: 'sin-vision', label: 'Sin línea de visión', canAttack: false };
  const range = rangeValidation(distance, geometry ?? UNARMED_GEOMETRY);
  if (!range.ok) {
    return {
      state: 'fuera',
      label: geometry?.ranged ? range.error : `${range.error} · acércate`,
      canAttack: false,
    };
  }
  if (range.longRange) {
    return { state: 'larga', label: 'Distancia larga: desventaja', canAttack: true };
  }
  return {
    state: 'alcance',
    label: geometry?.ranged ? 'Dentro de alcance' : 'Cuerpo a cuerpo',
    canAttack: true,
  };
}

/**
 * Hasta dónde llega el arma que empuñas, pintado como el alcance de andar pero
 * con la línea de tiro: una columna, un muro o un hueco recortan el área y
 * dejan su sombra detrás, así que el contorno enseña de un vistazo qué esquina
 * te cubre y desde dónde no tienes tiro.
 *
 * Devuelve dos anillos porque no valen lo mismo: `normal` es tu alcance sin
 * penalización y `long` la distancia larga, que dispara con desventaja.
 *
 * @returns { normal: [{col,row}], long: [{col,row}] }
 */
export function weaponRangeCells(map, origin, geometry) {
  if (!map || !origin || !geometry) return { normal: [], long: [] };
  const reach = geometry.ranged
    ? Math.max(0, geometry.normalRange ?? 0)
    : Math.max(1, geometry.reach ?? 1);
  const outer = geometry.ranged ? Math.max(reach, geometry.longRange ?? reach) : reach;
  if (outer <= 0) return { normal: [], long: [] };

  const normal = [];
  const long = [];
  for (const cell of cellsWithinSight(map, origin, outer)) {
    if (cell.col === origin.col && cell.row === origin.row) continue;
    const distance = Math.max(Math.abs(cell.col - origin.col), Math.abs(cell.row - origin.row));
    if (distance <= reach) normal.push(cell);
    else long.push(cell);
  }
  return { normal, long };
}
