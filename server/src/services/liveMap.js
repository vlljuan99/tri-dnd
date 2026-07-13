import { getActiveMapId } from './mapLibrary.js';

// Puente entre las rutas HTTP del editor y la sala de Socket.io de cada
// campaña: cuando el mapa activo cambia (revelar sala, abrir puerta, activar
// otro mapa...), los clientes de la mesa reciben 'mapa:actualizado' y
// vuelven a pedir /mapa-activo, que ya filtra por rol en el servidor.
// Solo se emite una señal, nunca datos del mapa: así ningún socket recibe
// más de lo que su rol le permite ver.
let ioRef = null;
let combatBroadcaster = null;

export function bindIo(io) {
  ioRef = io;
}

// sockets.js registra aquí su broadcastCombat (emite a cada socket la vista
// de combate que corresponde a su rol) para que las rutas HTTP puedan
// avisar cuando el mapa mete enemigos en el tracker
export function bindCombatBroadcaster(fn) {
  combatBroadcaster = fn;
}

// sockets.js registra aquí su inserción+difusión de mensajes de chat, para
// que los servicios (eventos con disparador, Fase 19) puedan publicar
// mensajes de sistema respetando el filtrado de ocultos (solo DM y autor).
let chatPoster = null;
export function bindChatPoster(fn) {
  chatPoster = fn;
}
export function postSystemMessage(campaignId, body, { hidden = false, userId = null } = {}) {
  chatPoster?.(campaignId, { body, hidden, userId });
}

export function notifyCombat(campaignId) {
  combatBroadcaster?.(campaignId);
}

// Señal de "acaba de empezar el combate": el cartel de aviso a pantalla en la
// mesa (todos los clientes) y el mensaje de sistema en el chat. Se emite tanto
// desde el arranque manual del DM como desde el automático al descubrir
// enemigos, para que el aviso sea el mismo por cualquier vía.
export function notifyCombatStarted(campaignId) {
  ioRef?.to(`campaign:${campaignId}`).emit('combat:started');
  postSystemMessage(campaignId, 'El combate ha comenzado.');
}

export function notifyCampaignMap(campaignId) {
  ioRef?.to(`campaign:${campaignId}`).emit('mapa:actualizado');
}

// Notifica solo si el mapa tocado es el que está en la mesa
export function notifyIfActive(campaignId, mapId) {
  if (getActiveMapId(campaignId) === Number(mapId)) notifyCampaignMap(campaignId);
}

// Señal para el mapa de mundo: cuando el DM viaja o edita las ubicaciones, los
// clientes de la mesa reciben 'mundo:actualizado' y vuelven a pedir /mundo. Al
// cambiar la ubicación actual, la mesa muestra la pantalla de lore de destino.
export function notifyCampaignWorld(campaignId) {
  ioRef?.to(`campaign:${campaignId}`).emit('mundo:actualizado');
}
