import { DICE_TYPES, rollPool } from './dice.js';

// /r 1d20+4, /r 2d6 + 1d4 - 2 y una etiqueta opcional tras la formula.
export function parseRollCommand(text) {
  const command = /^\/r\s+(.+)$/i.exec(String(text).trim());
  if (!command) return null;

  const compact = command[1].replace(/\s+/g, ' ').trim();
  const formulaMatch = /^((?:\d{1,2}d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d{1,2}d(?:4|6|8|10|12|20|100))*)(?:\s*[+-]\s*\d{1,3})?)(?:\s+(.+))?$/i.exec(compact);
  if (!formulaMatch) return { error: 'Usa una f\u00f3rmula como /r 1d20+4 o /r 2d6+1d4-2.' };

  const formula = formulaMatch[1].replace(/\s+/g, '');
  const label = formulaMatch[2]?.trim().slice(0, 80) || 'Tirada de chat';
  const pool = Object.fromEntries(DICE_TYPES.map((die) => [die, 0]));
  let modifier = 0;
  for (const token of formula.match(/[+-]?[^+-]+/g) ?? []) {
    const sign = token.startsWith('-') ? -1 : 1;
    const value = token.replace(/^[+-]/, '');
    const die = /^(\d{1,2})d(4|6|8|10|12|20|100)$/i.exec(value);
    if (die) {
      if (sign < 0) return { error: 'No se pueden restar dados; resta solo un modificador fijo.' };
      const key = `d${die[2]}`;
      pool[key] += Number(die[1]);
      if (pool[key] > 40) return { error: 'La tirada admite como m\u00e1ximo 40 dados de cada tipo.' };
    } else {
      modifier += sign * Number(value);
    }
  }
  if (!Number.isInteger(modifier) || Math.abs(modifier) > 999) {
    return { error: 'El modificador debe estar entre -999 y +999.' };
  }
  return { pool, modifier, label };
}

export function rollChatCommand(text) {
  const parsed = parseRollCommand(text);
  if (!parsed || parsed.error) return parsed;
  return { roll: rollPool(parsed.pool, { modifier: parsed.modifier, label: parsed.label }) };
}


/**
 * Narración del DM (Fase 4d): «/n El viento aúlla en el desfiladero.» se
 * envía como narración y la mesa la ve como subtítulo. null si no es /n.
 */
export function narrationCommand(text) {
  const match = /^\/n(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  const body = (match[1] ?? '').trim();
  if (!body) return { error: 'Escribe qué narras: /n El viento aúlla en el desfiladero.' };
  return { text: body };
}

/**
 * Susurro (Fase 4, añadido): «/s Aria El posadero miente». El servidor decide
 * a quién va (el nombre más largo de un miembro o de su PJ que encabece el
 * texto): aquí solo se reconoce el comando.
 */
export function whisperCommand(text) {
  const match = /^\/s(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  const body = (match[1] ?? '').trim();
  if (!body) return { error: 'Escribe a quién y qué: /s Aria El posadero miente.' };
  return { text: body };
}
