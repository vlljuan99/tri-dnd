// Tiempos del vuelo de los dados, sin three.js.
//
// Viven aparte de `tumble.js` porque la cola de revelado (`reveal.js`) los
// necesita para planificar cada tirada y se carga en el bundle principal: si
// los importara de `tumble.js`, three entero viajaría a la pantalla de acceso.

// Un dado que rueda menos de medio segundo no pesa; uno que rueda dos segundos
// aburre a la cuarta tirada de la sesión.
export const VUELO_MS = 1150;
// Cada dado sale un poco después que el anterior: el repiqueteo se lee en
// secuencia en vez de como un golpe único.
export const RETARDO_ENTRE_DADOS_MS = 90;
// Con muchos dados el retardo acumulado se comprime para que una tirada de 8d6
// no dure el triple que una de 2d6.
export const RETARDO_MAXIMO_MS = 520;

export function retardoDe(index, count) {
  if (count <= 1) return 0;
  const total = Math.min(RETARDO_ENTRE_DADOS_MS * (count - 1), RETARDO_MAXIMO_MS);
  return (total * index) / (count - 1);
}

/** Duración total de una tanda: el último dado en salir más su vuelo. */
export function duracionTotal(count, vueloMs = VUELO_MS) {
  return retardoDe(Math.max(0, count - 1), count) + vueloMs;
}
