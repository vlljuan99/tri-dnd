// Tabla central de atajos de la mesa. Vive aparte de los componentes porque un
// atajo tiene dos mitades que se desincronizan solas: la tecla que se pinta en
// el slot y la tecla que escucha el listener. Aquí solo hay una.
//
// Cubre el hotbar (Fase 3) y la cámara (Fase 4). Que las dos tablas vivan
// juntas es lo que permite comprobar de una vez que ninguna tecla está
// prometida dos veces.

/**
 * Acciones del hotbar: clave interna → tecla y etiqueta que se pinta.
 *
 * Los números empiezan por las ARMAS porque atacar es el verbo más repetido de
 * la mesa; las acciones del turno siguen a continuación. Q, E, F y R quedan
 * libres a propósito: son las de cámara (Fase 4).
 */
export const WEAPON_KEYS = ['1', '2', '3', '4'];

export const HOTBAR_KEYS = {
  correr: '5',
  esquivar: '6',
  destrabarse: '7',
  buscar: '8',
  conjuros: 'c',
  inventario: 'i',
  ficha: 'h',
  notas: 'n',
  terminarTurno: ' ',
};

/**
 * Cámara. Manos en el teclado como en cualquier juego con vista táctica: girar
 * el tablero, encuadrar lo tuyo y graduar la inclinación sin ir al dock.
 * Una acción puede tener varias teclas (en un teclado español "+" exige Mayús,
 * así que "=" vale igual).
 */
export const CAMERA_KEYS = {
  rotarIzquierda: 'q',
  rotarDerecha: 'e',
  centrar: 'f',
  inclinarMas: 'r',
  inclinarMenos: 't',
  acercar: ['+', '='],
  alejar: ['-'],
};

/** Tecla del arma en la posición `index` del hotbar, o null si ya no hay. */
export function weaponKey(index) {
  return WEAPON_KEYS[index] ?? null;
}

/** Cómo se escribe cada tecla en la interfaz (la primera, si tiene varias). */
export function keyLabel(key) {
  const first = Array.isArray(key) ? key[0] : key;
  if (first === ' ') return 'Espacio';
  return String(first ?? '').toUpperCase();
}

/**
 * ¿El evento viene de alguien escribiendo? El chat de la mesa está siempre a
 * un tabulador de distancia: un atajo de una sola letra no puede robarle las
 * pulsaciones a quien está escribiendo un mensaje.
 */
export function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * Traduce un evento de teclado a la acción del hotbar que le corresponde, o
 * null si no toca ninguna. Los atajos con modificador (Ctrl+F del navegador,
 * Cmd+I…) se dejan pasar siempre: no son nuestros.
 *
 * @param bindings mapa acción → tecla (por defecto HOTBAR_KEYS)
 */
export function matchShortcut(event, bindings = HOTBAR_KEYS) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  if (isTypingTarget(event.target)) return null;
  const pressed = event.key === ' ' || event.key === 'Spacebar' ? ' ' : event.key?.toLowerCase();
  if (!pressed) return null;
  return (
    Object.keys(bindings).find((action) => {
      const keys = bindings[action];
      return Array.isArray(keys) ? keys.includes(pressed) : keys === pressed;
    }) ?? null
  );
}
