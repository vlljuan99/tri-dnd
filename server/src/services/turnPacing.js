// Ritmo del turno automático. La IA enemiga resolvía el turno entero en un
// solo bloque sincrónico: el jugador veía el token teletransportarse y, en el
// mismo instante, tres tiradas y tres mensajes de daño cayendo en el chat. No
// se podía SEGUIR lo que pasaba, solo leerlo después.
//
// Este módulo no decide nada de reglas ni toca SQLite: solo dice cuánto dura
// cada "tiempo" del turno y ofrece la espera. Así los tiempos se pueden probar
// sin arrancar una mesa y se pueden desactivar por completo en los tests.
//
// El ritmo NO es una regla del juego: si estas esperas se van a cero, el turno
// se resuelve exactamente igual y con los mismos resultados. Es presentación.

// Duración base de cada tiempo, en milisegundos, con el ritmo sin escalar.
export const BEATS = {
  // El enemigo "coge aire" antes de moverse: da tiempo a leer de quién es el
  // turno en la iniciativa antes de que empiece a pasar algo en el tablero.
  telegrafia: 450,
  // Recorrido: se cobra por casilla del camino, con un techo para que un
  // enemigo muy rápido al otro lado del mapa no congele la mesa.
  porCasilla: 130,
  caminataMax: 1600,
  // Respiro al llegar al destino, antes de que levante el arma.
  trasMovimiento: 260,
  // Multiataque: tres golpes son tres golpes, no una ráfaga simultánea.
  entreAtaques: 720,
  // Que el último impacto se vea antes de cerrar el turno.
  trasAtaque: 560,
  antesDeCerrar: 380,
};

const TEST_FACTOR = 0;
const DEFAULT_FACTOR = 1;

/**
 * Factor por el que se multiplican todos los tiempos.
 *
 * - En tests (`NODE_ENV=test`) el ritmo se apaga: los turnos se resuelven de
 *   golpe, como antes, para que las pruebas de integración no dependan de
 *   relojes ni se vuelvan lentas.
 * - `TRIDND_TURN_PACE` permite ajustarlo a mano (0 lo apaga, 0.5 lo acelera al
 *   doble, 2 lo hace más pausado) y tiene prioridad sobre lo anterior, para
 *   poder mirar los tiempos en una prueba concreta si hace falta.
 */
export function paceFactor(env = process.env) {
  const raw = env?.TRIDND_TURN_PACE;
  if (raw != null && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  if (env?.NODE_ENV === 'test') return TEST_FACTOR;
  return DEFAULT_FACTOR;
}

/**
 * Duración de un tiempo concreto, ya escalada. `caminata` es el único que
 * depende del recorrido: recibe las casillas del camino en `cells`.
 *
 * Lanza si el nombre no existe: un tiempo mal escrito debe romper la prueba,
 * no desaparecer en silencio dejando el turno otra vez de golpe.
 */
export function beatMs(name, { cells = 0, factor = DEFAULT_FACTOR } = {}) {
  const scale = Math.max(0, factor);
  if (name === 'caminata') {
    const cellCount = Math.max(0, Math.floor(cells));
    return Math.round(Math.min(cellCount * BEATS.porCasilla, BEATS.caminataMax) * scale);
  }
  if (!Object.prototype.hasOwnProperty.call(BEATS, name)) {
    throw new Error(`Tiempo de turno desconocido: ${name}`);
  }
  return Math.round(BEATS[name] * scale);
}

/**
 * Marcador de ritmo para una secuencia de turno. `wait` resuelve al instante
 * cuando el ritmo está apagado, sin pasar por el temporizador.
 */
export function createPacer(env = process.env) {
  const factor = paceFactor(env);
  return {
    factor,
    ms: (name, options = {}) => beatMs(name, { ...options, factor }),
    // El temporizador NO se desreferencia (`unref`): un temporizador sin
    // referencia deja morir el bucle de eventos con la promesa a medias, y
    // entonces `await pacer.wait(...)` no resuelve nunca. Como mucho son 1,6 s
    // de espera, así que retener el proceso ese rato no es problema; una
    // secuencia de turno colgada sí lo sería.
    wait(name, options = {}) {
      const ms = beatMs(name, { ...options, factor });
      if (ms <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    },
  };
}
