import { getActiveMapId } from './mapLibrary.js';

// Puente entre las rutas HTTP del editor y la sala de Socket.io de cada
// campaña: cuando el mapa activo cambia (revelar sala, abrir puerta, activar
// otro mapa...), los clientes de la mesa reciben 'mapa:actualizado' y
// vuelven a pedir /mapa-activo, que ya filtra por rol en el servidor.
// Solo se emite una señal, nunca datos del mapa: así ningún socket recibe
// más de lo que su rol le permite ver.
let ioRef = null;

export function bindIo(io) {
  ioRef = io;
}

export function notifyCampaignMap(campaignId) {
  ioRef?.to(`campaign:${campaignId}`).emit('mapa:actualizado');
}

// Notifica solo si el mapa tocado es el que está en la mesa
export function notifyIfActive(campaignId, mapId) {
  if (getActiveMapId(campaignId) === Number(mapId)) notifyCampaignMap(campaignId);
}
