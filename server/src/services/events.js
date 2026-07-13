import { db } from '../db.js';
import { postSystemMessage } from './liveMap.js';

// Eventos con disparador (Fases 18/19): el DM cuelga eventos de su
// biblioteca en la campaña, una sala o un marcador; cuando el disparador se
// cumple, la mesa recibe un mensaje de sistema (oculto solo-DM si el evento
// lo marca). El doble disparo se evita con fired (revelar, una sola vez) y
// last_fired_round (rondas, una vez por ronda que toque).

function eventBody(link) {
  const detail = link.effect || link.description;
  return detail ? `⚑ ${link.event_name}: ${detail}` : `⚑ ${link.event_name}`;
}

function fire(campaignId, link) {
  postSystemMessage(campaignId, eventBody(link), { hidden: Boolean(link.event_hidden) });
}

// Al revelarse salas del mapa activo: eventos 'revelar' colgados de esas
// salas que aún no han saltado. Devuelve cuántos disparó.
export function fireRevealEvents(campaignId, roomIds) {
  if (!roomIds?.length) return 0;
  const placeholders = roomIds.map(() => '?').join(', ');
  const links = db
    .prepare(
      `SELECT l.id, e.name AS event_name, e.effect, e.description, e.hidden AS event_hidden
       FROM event_links l JOIN dm_events e ON e.id = l.event_id
       WHERE l.campaign_id = ? AND l.target_type = 'sala' AND l.target_id IN (${placeholders})
         AND e.trigger_kind = 'revelar' AND l.fired = 0`
    )
    .all(campaignId, ...roomIds);
  for (const link of links) {
    db.prepare('UPDATE event_links SET fired = 1 WHERE id = ?').run(link.id);
    fire(campaignId, link);
  }
  return links.length;
}

// Al viajar el grupo a una ubicación del mundo: eventos de camino colgados de
// ese pin. Comparten trigger_kind 'revelar' con las salas ("al revelarse la
// sala / llegar a la ubicación"), un solo uso vía fired, rearmables.
export function fireTravelEvents(campaignId, locationId) {
  const links = db
    .prepare(
      `SELECT l.id, e.name AS event_name, e.effect, e.description, e.hidden AS event_hidden
       FROM event_links l JOIN dm_events e ON e.id = l.event_id
       WHERE l.campaign_id = ? AND l.target_type = 'ubicacion' AND l.target_id = ?
         AND e.trigger_kind = 'revelar' AND l.fired = 0`
    )
    .all(campaignId, locationId);
  for (const link of links) {
    db.prepare('UPDATE event_links SET fired = 1 WHERE id = ?').run(link.id);
    fire(campaignId, link);
  }
  return links.length;
}

// Al empezar una ronda nueva: eventos 'rondas' cuya cadencia toca
// (ronda % cada === 0). Los colgados de una sala solo si está revelada; los
// de un marcador solo si sigue en el tablero y visible; los de la campaña
// siempre. Devuelve cuántos disparó.
export function fireRoundEvents(campaignId, round) {
  const links = db
    .prepare(
      `SELECT l.id, l.target_type, l.target_id, l.last_fired_round,
              e.name AS event_name, e.effect, e.description, e.hidden AS event_hidden, e.trigger_every
       FROM event_links l JOIN dm_events e ON e.id = l.event_id
       WHERE l.campaign_id = ? AND e.trigger_kind = 'rondas'
         AND e.trigger_every >= 1`
    )
    .all(campaignId);
  let firedCount = 0;
  for (const link of links) {
    if (round % link.trigger_every !== 0) continue;
    if (link.last_fired_round === round) continue;
    if (link.target_type === 'sala') {
      const room = db.prepare('SELECT revealed FROM map_rooms WHERE id = ?').get(link.target_id);
      if (!room?.revealed) continue;
    } else if (link.target_type === 'marcador') {
      const token = db.prepare('SELECT hidden FROM map_tokens WHERE id = ?').get(link.target_id);
      if (!token || token.hidden) continue;
    } else if (link.target_type === 'ubicacion') {
      // Solo si el grupo sigue en esa ubicación del mundo
      const table = db.prepare('SELECT current_location_id FROM game_tables WHERE campaign_id = ?').get(campaignId);
      if (table?.current_location_id !== link.target_id) continue;
    }
    db.prepare('UPDATE event_links SET last_fired_round = ? WHERE id = ?').run(round, link.id);
    fire(campaignId, link);
    firedCount += 1;
  }
  return firedCount;
}
