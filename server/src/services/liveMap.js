import { getActiveMapId } from './mapLibrary.js';

// Puente entre las rutas HTTP del editor y la sala de Socket.io de cada
// campaña: cuando el mapa activo cambia (revelar sala, abrir puerta, activar
// otro mapa...), los clientes de la mesa reciben 'mapa:actualizado' y
// vuelven a pedir /mapa-activo, que ya filtra por rol en el servidor.
// Solo se emite una señal, nunca datos del mapa: así ningún socket recibe
// más de lo que su rol le permite ver.
let ioRef = null;
let combatBroadcaster = null;
let campaignMemberEvicter = null;

export function bindIo(io) {
  ioRef = io;
}

// sockets.js registra aquí su broadcastCombat (emite a cada socket la vista
// de combate que corresponde a su rol) para que las rutas HTTP puedan
// avisar cuando el mapa mete enemigos en el tracker
export function bindCombatBroadcaster(fn) {
  combatBroadcaster = fn;
}

// Las rutas HTTP de administración pueden retirar a un jugador mientras su
// socket sigue unido a la sala. El callback vive en sockets.js, donde existe
// el conocimiento de presencia necesario para sacarlo y recalcular la lista
// online sin enviarle ninguna actualización posterior.
export function bindCampaignMemberEvicter(fn) {
  campaignMemberEvicter = fn;
}

export function evictCampaignMember(campaignId, userId) {
  campaignMemberEvicter?.(Number(campaignId), Number(userId));
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

// Lo mismo para tiradas (Fase 4c): una salvación contra una zona de peligro o
// una prueba pedida por el DM se publica como tirada, para que ruede en todas
// las pantallas en vez de quedarse en una línea de texto.
let rollPoster = null;
export function bindRollPoster(fn) {
  rollPoster = fn;
}
export function postRollMessage(campaignId, roll, { hidden = false, userId = null } = {}) {
  rollPoster?.(campaignId, { roll, hidden, userId });
}

// Una trampa se dispara (Fase 4c): «¡clic!» y el tablero se oscurece un
// instante en todas las pantallas. Solo nombre y afectado, que ya se narran.
export function notifyTrapTriggered(campaignId, trap) {
  ioRef?.to(`campaign:${campaignId}`).emit('trampa:activada', trap);
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

// Presentación de jefe (Fase 4d): cada vez que el mapa cambia (sala revelada,
// marcador que deja de estar oculto) sockets.js comprueba si hay un jefe que
// acaba de quedar a la vista.
let bossIntroChecker = null;
export function bindBossIntroChecker(fn) {
  bossIntroChecker = fn;
}

export function notifyCampaignMap(campaignId) {
  ioRef?.to(`campaign:${campaignId}`).emit('mapa:actualizado');
  if (bossIntroChecker) {
    setImmediate(() => {
      try {
        bossIntroChecker(campaignId);
      } catch (error) {
        console.error('[jefes] no se pudo comprobar la presentación:', error);
      }
    });
  }
}

// El DM ha concedido un nivel (Fase D): el aviso es público —el grupo entero
// sube— y solo lleva el número, nunca las fichas. Cada cliente vuelve a pedir
// la suya para saber si le toca subir.
export function notifyCampaignLevel(campaignId, grantedLevel) {
  ioRef?.to(`campaign:${campaignId}`).emit('campana:nivel', { grantedLevel });
}

// Eventos visuales efímeros: nunca contienen estadísticas privadas, solo el
// objetivo público y el número ya narrado en mesa.
export function notifyCombatVisual(campaignId, visual) {
  ioRef?.to(`campaign:${campaignId}`).emit('combat:visual', visual);
}

export function notifyBestiary(campaignId) {
  ioRef?.to(`campaign:${campaignId}`).emit('bestiario:actualizado');
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

// Animación efímera de un trayecto por una arista. La actualización persistida
// llega después por `mundo:actualizado` y vuelve a pasar por el filtro por rol.
export function notifyWorldTravel(campaignId, travel) {
  ioRef?.to(`campaign:${campaignId}`).emit('mundo:viaje', travel);
}
