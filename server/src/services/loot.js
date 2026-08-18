import { db } from '../db.js';
import { buildMeta } from './srdShape.js';
import { inventoryItemFromEntry, validateInventory } from '../rules/equipment.js';
import { CUSTOM_PREFIX, isCustomIndex, customIdFromIndex } from './customLibrary.js';

// Botín (Fase 20): tabla de recompensas por enemigo. Al caer, se tira cada
// entrada por su probabilidad y lo que toca queda en un marcador 'objeto'
// saqueable en su casilla; un personaje adyacente lo pasa a su inventario.
//
// Fase E de la rebanada vertical: este módulo es la ÚNICA puerta de entrada de
// objetos al inventario desde el mundo. La transferencia es transaccional (el
// objeto sale del contenedor y entra en la ficha en la misma operación, nunca
// se duplica ni se pierde) y el objeto llega con sus datos de combate
// resueltos desde el compendio, listo para equiparse.

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

// Entrada del compendio (SRD o biblioteca propia) que hay detrás de una línea
// de botín, con el mismo `meta` que recibe el cliente. Devuelve null para el
// botín escrito a mano por el DM ("una bolsa de monedas"), que no tiene ficha.
function compendiumEntry(entry) {
  const index = entry.index;
  if (entry.source === 'text' || !index) return null;
  if (isCustomIndex(index)) {
    const id = customIdFromIndex(index);
    const row = id != null && db.prepare('SELECT * FROM custom_items WHERE id = ?').get(id);
    if (!row) return null;
    const data = JSON.parse(row.data || '{}');
    return { index: `${CUSTOM_PREFIX}${row.id}`, name: row.name, meta: buildMeta('equipment', data) };
  }
  const row = db.prepare("SELECT * FROM srd_entries WHERE category = 'equipment' AND idx = ?").get(index);
  if (!row) return null;
  const data = JSON.parse(row.data || '{}');
  return { index: row.idx, name: row.name_es || row.name_en, meta: buildMeta('equipment', data) };
}

/**
 * Objeto de inventario a partir de una línea de botín. Si la línea apunta al
 * compendio, el objeto llega con sus datos de arma/armadura (daño, propiedades,
 * CA…) y se puede equipar sin volver a buscarlo; si es texto libre del DM,
 * entra como objeto suelto de la mochila.
 */
export function inventoryItemFromLoot(entry) {
  const found = compendiumEntry(entry);
  const qty = Math.max(1, Math.min(999, Number(entry.qty) || 1));
  if (!found) {
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `loot-${Date.now()}-${Math.random()}`,
      srdIndex: entry.source === 'text' ? null : entry.index ?? null,
      name: entry.name,
      qty,
      slot: null,
      weapon: null,
      armor: null,
    };
  }
  // El nombre del compendio manda sobre el que guardó el marcador: puede
  // haberse traducido desde entonces.
  return inventoryItemFromEntry(found, qty);
}

/**
 * Pasa el botín de un marcador al inventario de un personaje, en una sola
 * transacción: se relee el marcador dentro de ella, se escribe el inventario
 * y se borra el marcador a la vez. Dos saqueos del mismo cofre no pueden
 * duplicar nada — el segundo encuentra el marcador ya vacío.
 *
 * Devuelve `{ ok, error, looted }`. Es la única forma de meter un objeto del
 * mundo en una ficha: nadie más escribe `characters.inventory` desde el mapa.
 */
export function lootMarkerInto(tokenId, characterId) {
  return db.transaction(() => {
    const token = db.prepare('SELECT * FROM map_tokens WHERE id = ?').get(tokenId);
    if (!token) return { ok: false, error: 'Ahí ya no hay nada que saquear', looted: [] };
    const loot = JSON.parse(token.loot || '[]');
    if (!Array.isArray(loot) || !loot.length) {
      return { ok: false, error: 'Ahí no hay nada que saquear', looted: [] };
    }

    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!character) return { ok: false, error: 'Personaje no válido', looted: [] };

    const inventory = JSON.parse(character.inventory || '[]');
    const items = loot.map((entry) => inventoryItemFromLoot(entry));
    const next = [...inventory, ...items];
    if (!validateInventory(next)) {
      return { ok: false, error: 'No te cabe: tu inventario está lleno', looted: [] };
    }

    db.prepare("UPDATE characters SET inventory = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(next),
      character.id
    );
    db.prepare('DELETE FROM map_tokens WHERE id = ?').run(token.id);
    return {
      ok: true,
      error: null,
      looted: items.map(({ name, qty, weapon, armor }) => ({ name, qty, equipable: Boolean(weapon || armor) })),
    };
  })();
}
