import { dadosDeTirada } from './supported.js';

// Cuándo hay que hacer rodar la bandeja por una tirada que llega de la mesa.
//
// Las tiradas ajenas viajan como mensajes de chat de tipo 'roll'. Se leen del
// store de la sala en vez de engancharse al socket para no tocar
// `store/socket.js`, y la decisión vive aquí, separada y probable.
//
// Ojo con las ocultas del DM: el servidor ya filtra en origen y solo llegan a
// quien puede verlas, así que si un mensaje está aquí, se puede enseñar. No se
// vuelve a decidir nada de privacidad en el cliente.

/**
 * Última tirada ajena que merece rodar, o null.
 *
 * - `selfId`: para no repetir las tiradas propias, que ya ruedan al lanzarlas.
 * - `sinceId`: id del último mensaje visto al montar. Evita que al entrar en la
 *   mesa se pongan a rodar de golpe las tiradas del historial.
 */
export function pickIncomingRoll(messages, { selfId, sinceId = 0 } = {}) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== 'roll') continue;
    if (!(Number(message.id) > Number(sinceId))) break; // ya visto: nada nuevo
    if (message.author?.id && selfId && message.author.id === selfId) continue;
    if (!dadosDeTirada(message.body).length) continue; // nada que enseñar
    return { id: message.id, roll: message.body, authorName: message.author?.name ?? null };
  }
  return null;
}

/** Id del mensaje más reciente, para arrancar sin arrastrar el historial. */
export function latestMessageId(messages) {
  let latest = 0;
  for (const message of messages ?? []) {
    const id = Number(message?.id);
    if (Number.isFinite(id) && id > latest) latest = id;
  }
  return latest;
}
