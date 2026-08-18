import { db } from '../db.js';
import { spawnRoomEnemies } from './mapLibrary.js';
import { getSkirmishPreset } from './skirmishPresets.js';
import { instantiateMap } from './templates.js';

// Sembrado de una escaramuza a partir de un snapshot de mapa: sirve tanto para
// los escenarios de fábrica (services/skirmishPresets.js) como para las
// plantillas propias del DM. La partida queda lista para jugar: tablero
// activo, salas de inicio abiertas y los enemigos a la vista ya en el tracker
// de iniciativa con su tirada hecha.
//
// Las plantillas propias pueden seguir naciendo sin PJ ni turno activo; los
// presets oficiales reciben el PJ durante la misma transacción y arrancan.

/**
 * Crea el mapa de la escaramuza en la campaña y la deja lista para jugar.
 * Devuelve `{ mapId, revealedRoomIds, enemies }`.
 */
export function seedSkirmishMap(
  campaignId,
  userId,
  mapData,
  { name, enemyAi = false, soloPartySize = null } = {}
) {
  const mapId = instantiateMap(campaignId, userId, mapData, name);

  // `instantiateMap` crea toda sala sin revelar (lo correcto para una
  // plantilla que el DM estampa en su dungeon). Una escaramuza sí abre las
  // salas de partida: se identifican por posición, porque las filas se
  // insertaron en el mismo orden que trae el snapshot.
  const floors = db
    .prepare('SELECT id FROM map_floors WHERE map_id = ? ORDER BY position, id')
    .all(mapId);
  const revealedRoomIds = [];
  floors.forEach((floor, floorIndex) => {
    const rooms = db.prepare('SELECT id FROM map_rooms WHERE floor_id = ? ORDER BY id').all(floor.id);
    (mapData.floors?.[floorIndex]?.rooms ?? []).forEach((room, roomIndex) => {
      if (room.revealed && rooms[roomIndex]) revealedRoomIds.push(rooms[roomIndex].id);
    });
  });

  // Los mapas conservan todos sus encuentros de diseño, pero una prueba con
  // un único PJ no puede recibir la misma economía de acciones que un grupo.
  // Dejamos dos rivales por estancia (el primero y el último, que suele ser el
  // líder) y retiramos el resto únicamente de esta instancia solitaria.
  if (soloPartySize === 1) {
    for (const floor of floors) {
      const rooms = db.prepare('SELECT id FROM map_rooms WHERE floor_id = ? ORDER BY id').all(floor.id);
      for (const room of rooms) {
        const enemies = db
          .prepare("SELECT id FROM map_tokens WHERE room_id = ? AND kind = 'enemigo' ORDER BY id")
          .all(room.id);
        if (enemies.length <= 2) continue;
        const kept = new Set([enemies[0].id, enemies.at(-1).id]);
        const removed = enemies.filter((enemy) => !kept.has(enemy.id)).map((enemy) => enemy.id);
        db.prepare(`DELETE FROM map_tokens WHERE id IN (${removed.map(() => '?').join(', ')})`).run(...removed);
      }
    }
  }
  // Un snapshot sin ninguna sala marcada (p. ej. una plantilla vieja) abriría
  // un tablero completamente a oscuras: en ese caso se revela la primera.
  if (!revealedRoomIds.length && floors.length) {
    const first = db.prepare('SELECT id FROM map_rooms WHERE floor_id = ? ORDER BY id LIMIT 1').get(floors[0].id);
    if (first) revealedRoomIds.push(first.id);
  }
  if (revealedRoomIds.length) {
    db.prepare(
      `UPDATE map_rooms SET revealed = 1 WHERE id IN (${revealedRoomIds.map(() => '?').join(', ')})`
    ).run(...revealedRoomIds);
  }

  db.prepare(
    'UPDATE game_tables SET active_map_id = ?, enemy_ai_enabled = ? WHERE campaign_id = ?'
  ).run(mapId, enemyAi ? 1 : 0, campaignId);
  // Las iniciativas quedan preparadas, pero todavía no existe un turno
  // activo: la escaramuza nace sin PJ y no debe avanzar entre enemigos solos.
  // «Añadir grupo» o activar el modo por turnos iniciará el orden después.
  const enemies = spawnRoomEnemies(campaignId, revealedRoomIds, { startCombat: false });
  return { mapId, revealedRoomIds, enemies };
}

/** Nivel inicial que declara un escenario: el extremo bajo de «3-4», o 1. */
export function suggestedLevelFloor(suggested) {
  const match = /\d+/.exec(String(suggested ?? ''));
  const level = match ? Number(match[0]) : 1;
  return Math.max(1, Math.min(20, level));
}

/**
 * Snapshot de mapa a instanciar y ajustes de la campaña, a partir de lo que
 * pidió el cliente: un escenario de fábrica (`presetId`) o una plantilla de
 * escaramuza propia (`templateId`). Devuelve `{ error }` si no vale.
 */
export function resolveSkirmishSource({ presetId, template }) {
  if (presetId) {
    const preset = getSkirmishPreset(presetId);
    if (!preset) return { error: 'Ese escenario predefinido no existe' };
    return {
      mapData: preset.map,
      name: preset.name,
      maxPlayers: preset.players,
      enemyAi: preset.enemyAi === true,
      soloMode: preset.soloMode === true,
      briefing: preset.briefing,
      objectives: preset.objectives,
      // Fase D: el escenario declara su nivel recomendado como texto
      // («3-4»); la mesa se monta con el extremo bajo como nivel inicial. Un
      // PJ que ya existe entra con el suyo y no se recalcula.
      startingLevel: suggestedLevelFloor(preset.suggestedLevel),
    };
  }
  if (template) {
    return {
      mapData: template.data,
      name: template.row.name,
      maxPlayers: null,
      enemyAi: false,
      soloMode: false,
    };
  }
  return {};
}
