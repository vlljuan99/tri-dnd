import { db } from '../db.js';

// Botín (Fase 20): tabla de recompensas por enemigo. Al caer, se tira cada
// entrada por su probabilidad y lo que toca queda en un marcador 'objeto'
// saqueable en su casilla; un personaje adyacente lo pasa a su inventario.

// Tira la tabla de botín: cada entrada cae según su probabilidad (1-100).
// Devuelve las entradas que caen, normalizadas.
export function rollLoot(loot) {
  if (!Array.isArray(loot)) return [];
  const dropped = [];
  for (const entry of loot) {
    const chance = Number.isFinite(entry?.chance) ? entry.chance : 100;
    if (Math.random() * 100 < chance) {
      dropped.push({
        name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : 'Objeto',
        source: entry.source === 'srd' || entry.source === 'custom' ? entry.source : 'text',
        index: entry.index ?? null,
        qty: Math.max(1, Math.min(999, Number(entry.qty) || 1)),
      });
    }
  }
  return dropped;
}

// Deja un marcador 'objeto' visible y saqueable con el botín caído en la
// casilla del enemigo derrotado. Devuelve el id del marcador o null.
export function dropLootMarker(deadToken, rolled) {
  if (!rolled.length) return null;
  const info = db
    .prepare(
      "INSERT INTO map_tokens (room_id, kind, name, x, y, hidden, loot) VALUES (?, 'objeto', ?, ?, ?, 0, ?)"
    )
    .run(deadToken.room_id, `Botín de ${deadToken.name}`.slice(0, 60), deadToken.x, deadToken.y, JSON.stringify(rolled));
  return info.lastInsertRowid;
}

// Pasa el botín de un marcador al inventario de un personaje y borra el
// marcador. Devuelve las entradas transferidas. El item guarda srdIndex si
// venía del compendio/biblioteca, para poder consultarlo desde la ficha.
export function lootMarkerInto(token, character) {
  const loot = JSON.parse(token.loot || '[]');
  if (!Array.isArray(loot) || !loot.length) return [];
  const inventory = JSON.parse(character.inventory || '[]');
  for (const entry of loot) {
    inventory.push({
      id: (globalThis.crypto?.randomUUID?.() ?? `loot-${Date.now()}-${Math.random()}`),
      srdIndex: entry.source === 'text' ? null : entry.index ?? null,
      name: entry.name,
      qty: Math.max(1, Number(entry.qty) || 1),
      equipped: false,
      weapon: null,
    });
  }
  db.prepare("UPDATE characters SET inventory = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(inventory),
    character.id
  );
  db.prepare('DELETE FROM map_tokens WHERE id = ?').run(token.id);
  return loot;
}
