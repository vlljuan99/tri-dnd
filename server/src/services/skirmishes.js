import { db } from '../db.js';
import { spawnRoomEnemies } from './mapLibrary.js';
import { getSkirmishPreset } from './skirmishPresets.js';
import { instantiateMap } from './templates.js';

// Sembrado de una escaramuza a partir de un snapshot de mapa: sirve tanto para
// los escenarios de fábrica (services/skirmishPresets.js) como para las
// plantillas propias del DM. La partida queda lista para dirigir: tablero
// activo, salas de inicio abiertas y los enemigos a la vista ya en el tracker
// de iniciativa con su tirada hecha.
//
// Lo que NO se hace es arrancar el combate: cuando se crea la escaramuza
// todavía no hay ningún personaje jugador en la mesa, así que un combate
// abierto solo tendría enemigos jugando turnos entre ellos. El DM pulsa
// «Añadir grupo» cuando llegan los suyos y empieza.

/**
 * Crea el mapa de la escaramuza en la campaña y la deja lista para jugar.
 * Devuelve `{ mapId, revealedRoomIds, enemies }`.
 */
export function seedSkirmishMap(campaignId, userId, mapData, { name } = {}) {
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

  db.prepare('UPDATE game_tables SET active_map_id = ? WHERE campaign_id = ?').run(mapId, campaignId);
  // Las iniciativas quedan preparadas, pero todavía no existe un turno
  // activo: la escaramuza nace sin PJ y no debe avanzar entre enemigos solos.
  // «Añadir grupo» o activar el modo por turnos iniciará el orden después.
  const enemies = spawnRoomEnemies(campaignId, revealedRoomIds, { startCombat: false });
  return { mapId, revealedRoomIds, enemies };
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
    return { mapData: preset.map, name: preset.name, maxPlayers: preset.players };
  }
  if (template) {
    return { mapData: template.data, name: template.row.name, maxPlayers: null };
  }
  return {};
}
