import { dadosDeTirada } from './supported.js';
import { VUELO_MS, duracionTotal } from './timing.js';

// Cola de revelado: el orden y el ritmo con que la mesa VE las tiradas.
//
// Toda tirada que te afecta —la tuya, la de otro jugador, la que tira el
// servidor por un conjuro o por la IA enemiga— entra aquí una sola vez, rueda
// cuando le toca y se revela por pasos: total, contra qué, veredicto. Lo que
// llega detrás de ella (el «−8» sobre el token, la línea del registro, la vida
// que baja) espera a que el dado caiga: si no, el número se lee antes de que
// el dado signifique nada.
//
// Nada de esto decide reglas. El servidor ya resolvió cuando la tirada llega;
// aquí solo se decide CUÁNDO se enseña. Es un módulo puro: sin temporizadores,
// sin React y sin three, para poder probar el orden sin pintar nada.

export const RITMOS = ['cinematico', 'normal', 'rapido'];
export const RITMO_POR_DEFECTO = 'normal';
export const ETIQUETAS_RITMO = {
  cinematico: 'Cinemático',
  normal: 'Normal',
  rapido: 'Rápido',
};

// Cuánto estira cada ritmo el vuelo, los pasos del revelado y el reposo final.
const FACTORES = {
  cinematico: { vuelo: 1.25, pasos: 1.6, reposo: 1.7 },
  normal: { vuelo: 1, pasos: 1, reposo: 1 },
  rapido: { vuelo: 0.7, pasos: 0.4, reposo: 0.35 },
};

// Hueco entre dos pasos del revelado (total → contra → veredicto).
export const PASO_MS = 420;
// Lo que se queda el resultado en pantalla tras el veredicto.
export const REPOSO_MS = 900;
export const REPOSO_DRAMATICO_MS = 1500;
// Un crítico o una pifia caen más despacio: el final del vuelo se alarga.
export const CAMARA_LENTA = 1.4;
// Más tiradas esperando que esto y las siguientes se revelan en «rápido» hasta
// ponerse al día: la mesa nunca va más de unos segundos por detrás.
export const COLA_MAXIMA = 2;
// Una tirada propia reservada que el servidor no confirma en este tiempo se
// descarta: nada se queda esperando para siempre.
export const RESERVA_MAXIMA_MS = 6000;
// Si la bandeja no avisa de que los dados han caído (chunk que no carga, pestaña
// en segundo plano), se da por aterrizada pasado su vuelo más este margen.
export const MARGEN_ATERRIZAJE_MS = 2500;

export function normalizarRitmo(value) {
  return RITMOS.includes(value) ? value : RITMO_POR_DEFECTO;
}

/**
 * Ritmo con el que se revela la siguiente tirada. Con `prefers-reduced-motion`
 * no hay bandeja ni pasos; con cola acumulada, se acelera.
 */
export function ritmoEfectivo(ritmo, { enEspera = 0, sinAnimacion = false } = {}) {
  if (sinAnimacion) return 'instantaneo';
  if (enEspera > COLA_MAXIMA) return 'rapido';
  return normalizarRitmo(ritmo);
}

/** Pasos que se enseñan tras caer los dados, en orden. */
export function pasosDeRevelado(roll) {
  const pasos = ['total'];
  const outcome = roll?.outcome;
  if (outcome?.contra && Number.isFinite(Number(outcome.contra.valor))) pasos.push('contra');
  if (outcome?.resultado) pasos.push('veredicto');
  return pasos;
}

export function esDramatica(roll) {
  return Boolean(roll?.crit || roll?.fumble);
}

/**
 * Plan temporal de una tirada. `aterrizajeMs` es lo que tarda en caer el último
 * dado; los pasos cuentan desde que caen (el aviso real lo da la bandeja).
 */
export function planDeRevelado(roll, ritmo) {
  const pasos = pasosDeRevelado(roll);
  if (ritmo === 'instantaneo') {
    return {
      conDados: false,
      dramatica: esDramatica(roll),
      vueloMs: 0,
      aterrizajeMs: 0,
      pasos: pasos.map((paso) => ({ paso, trasAterrizajeMs: 0 })),
      reveladoMs: 0,
      finMs: 0,
    };
  }
  const factores = FACTORES[ritmo] ?? FACTORES.normal;
  const dramatica = esDramatica(roll);
  const dados = dadosDeTirada(roll).length;
  const conDados = dados > 0;
  const vueloMs = Math.round(VUELO_MS * factores.vuelo * (dramatica ? CAMARA_LENTA : 1));
  const aterrizajeMs = conDados ? Math.round(duracionTotal(dados, vueloMs)) : 0;
  const paso = PASO_MS * factores.pasos;
  const plan = pasos.map((nombre, index) => ({ paso: nombre, trasAterrizajeMs: Math.round(index * paso) }));
  const reveladoMs = plan.at(-1).trasAterrizajeMs;
  const reposo = (dramatica ? REPOSO_DRAMATICO_MS : REPOSO_MS) * factores.reposo;
  return {
    conDados,
    dramatica,
    vueloMs,
    aterrizajeMs,
    pasos: plan,
    reveladoMs,
    finMs: Math.round(reveladoMs + reposo),
  };
}

// --- Identidad de una tirada ------------------------------------------------

function valoresDe(roll) {
  return (roll?.groups ?? [])
    .map((group) => `${group.die}:${(group.results ?? []).map((r) => (r.rolls ?? []).join('/')).join(',')}`)
    .join(';');
}

/**
 * ¿Son la misma tirada? La propia viaja con un `uid` y el servidor la devuelve
 * tal cual; las que se recomponen por el camino (daño combinado de varios
 * tipos) se reconocen por etiqueta, total y dados.
 */
export function mismaTirada(a, b) {
  if (!a || !b) return false;
  if (a.uid && b.uid) return a.uid === b.uid;
  return (
    String(a.label ?? '') === String(b.label ?? '') &&
    Number(a.total) === Number(b.total) &&
    valoresDe(a) === valoresDe(b)
  );
}

// --- La cola ------------------------------------------------------------------
//
// Estados de una entrada:
//   reservada → tirada propia a la espera de que el servidor la acepte
//   lista     → esperando turno
//   rodando   → los dados están en el aire o revelándose por pasos
//   revelada  → veredicto a la vista, en reposo hasta que sale de la cola
//
// Las entradas solo se revelan en orden: la cabeza rueda y las demás esperan.

const RECIENTES_MAXIMO = 24;

export function crearCola() {
  return { entradas: [], siguienteId: 1, recientes: [] };
}

function pendiente(entrada) {
  return entrada.estado !== 'revelada';
}

/** Mete una tirada al final. Las propias pueden entrar reservadas. */
export function encolar(cola, { roll, autor = null, local = false, reservada = false, oculta = false }) {
  const id = cola.siguienteId;
  const entrada = {
    id,
    roll,
    autor,
    local,
    oculta: Boolean(oculta),
    estado: reservada ? 'reservada' : 'lista',
    retenidos: [],
  };
  return {
    cola: { ...cola, entradas: [...cola.entradas, entrada], siguienteId: id + 1 },
    id,
  };
}

/**
 * Llega por la mesa una tirada. Si es el eco de una propia ya en la cola (o
 * que acaba de salir), no se vuelve a tirar: se toma la versión del servidor,
 * que es la que trae el veredicto, y la reservada queda confirmada.
 */
export function recibirTirada(cola, { roll, autor = null, oculta = false }) {
  const propia = cola.entradas.find((entrada) => entrada.local && mismaTirada(entrada.roll, roll));
  if (propia) {
    const entradas = cola.entradas.map((entrada) =>
      entrada === propia
        ? {
            ...entrada,
            // El eco trae lo que el servidor añadió (veredicto, crítico forzado)
            roll: { ...entrada.roll, ...roll },
            estado: entrada.estado === 'reservada' ? 'lista' : entrada.estado,
          }
        : entrada
    );
    return { cola: { ...cola, entradas }, id: propia.id, duplicada: true };
  }
  if (cola.recientes.some((reciente) => mismaTirada(reciente, roll))) {
    return { cola, id: null, duplicada: true };
  }
  const { cola: siguiente, id } = encolar(cola, { roll, autor, oculta });
  return { cola: siguiente, id, duplicada: false };
}

/** La que se ve ahora: la primera de la cola, esté rodando o en reposo. */
export function cabeza(cola) {
  return cola.entradas[0] ?? null;
}

/** Cuántas tiradas esperan detrás de la cabeza sin haberse revelado. */
export function enEspera(cola) {
  return cola.entradas.slice(1).filter(pendiente).length;
}

/**
 * A qué tirada se ata algo que acaba de llegar: la última aún sin revelar.
 * null si no hay ninguna (entonces se enseña ya).
 */
export function destinoDeRetencion(cola) {
  for (let index = cola.entradas.length - 1; index >= 0; index -= 1) {
    if (pendiente(cola.entradas[index])) return cola.entradas[index].id;
  }
  return null;
}

/** Ata un elemento a la última tirada pendiente, o dice que va inmediato. */
export function retener(cola, elemento) {
  const destino = destinoDeRetencion(cola);
  if (destino == null) return { cola, inmediato: true };
  const entradas = cola.entradas.map((entrada) =>
    entrada.id === destino ? { ...entrada, retenidos: [...entrada.retenidos, elemento] } : entrada
  );
  return { cola: { ...cola, entradas }, inmediato: false };
}

function actualizar(cola, id, cambio) {
  return { ...cola, entradas: cola.entradas.map((entrada) => (entrada.id === id ? { ...entrada, ...cambio } : entrada)) };
}

/** La cabeza lista empieza a rodar. */
export function empezar(cola, id) {
  const primera = cabeza(cola);
  if (!primera || primera.id !== id || primera.estado !== 'lista') return cola;
  return actualizar(cola, id, { estado: 'rodando' });
}

/**
 * Confirma una reservada sin esperar al eco (el servidor ya respondió «ok»).
 * `parche` completa la tirada con lo que trajo la respuesta (su veredicto),
 * para las que no vuelven por la mesa, como una prueba de cerradura.
 */
export function confirmar(cola, id, parche = null) {
  const entrada = cola.entradas.find((item) => item.id === id);
  if (!entrada || entrada.estado !== 'reservada') return cola;
  return actualizar(cola, id, { estado: 'lista', roll: parche ? { ...entrada.roll, ...parche } : entrada.roll });
}

/** Veredicto a la vista: devuelve lo retenido para soltarlo. */
export function revelar(cola, id) {
  const entrada = cola.entradas.find((item) => item.id === id);
  if (!entrada || !pendiente(entrada)) return { cola, liberados: [] };
  const recientes = entrada.local ? [...cola.recientes, entrada.roll].slice(-RECIENTES_MAXIMO) : cola.recientes;
  return {
    cola: { ...actualizar(cola, id, { estado: 'revelada', retenidos: [] }), recientes },
    liberados: entrada.retenidos,
  };
}

/** Sale de la cola tras su reposo. */
export function terminar(cola, id) {
  return { ...cola, entradas: cola.entradas.filter((entrada) => entrada.id !== id) };
}

/**
 * Descarta una tirada que no llegó a valer (el servidor rechazó el ataque).
 * Lo que tuviera retenido pasa a la anterior pendiente para no adelantarse a
 * ella; si no hay, se suelta ya.
 */
export function cancelar(cola, id) {
  const index = cola.entradas.findIndex((entrada) => entrada.id === id);
  if (index < 0) return { cola, liberados: [] };
  const entrada = cola.entradas[index];
  const recientes = entrada.local ? [...cola.recientes, entrada.roll].slice(-RECIENTES_MAXIMO) : cola.recientes;
  let anterior = -1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (pendiente(cola.entradas[cursor])) {
      anterior = cursor;
      break;
    }
  }
  const entradas = cola.entradas.filter((item) => item.id !== id);
  if (anterior < 0) return { cola: { ...cola, entradas, recientes }, liberados: entrada.retenidos };
  const destino = cola.entradas[anterior].id;
  return {
    cola: {
      ...cola,
      recientes,
      entradas: entradas.map((item) =>
        item.id === destino ? { ...item, retenidos: [...item.retenidos, ...entrada.retenidos] } : item
      ),
    },
    liberados: [],
  };
}

/** ¿Ya se ve el resultado de esta tirada? (o ya no está en la cola) */
export function estaRevelada(cola, id) {
  if (id == null) return true;
  return !cola.entradas.some((entrada) => entrada.id === id && pendiente(entrada));
}

// --- Textos del veredicto -----------------------------------------------------

const VEREDICTOS = {
  impacta: { texto: '¡Impacta!', tono: 'exito' },
  falla: { texto: 'Falla', tono: 'fallo' },
  critico: { texto: '¡Crítico!', tono: 'critico' },
  pifia: { texto: 'Pifia', tono: 'pifia' },
  supera: { texto: '¡Supera!', tono: 'exito' },
  'no-supera': { texto: 'No supera', tono: 'fallo' },
  exito: { texto: 'Éxito', tono: 'exito' },
  fallo: { texto: 'Fallo', tono: 'fallo' },
};

export function veredictoDe(outcome) {
  if (!outcome?.resultado) return null;
  return VEREDICTOS[outcome.resultado] ?? { texto: String(outcome.resultado), tono: 'fallo' };
}

/**
 * Margen tras resolver: «por 4», «por los pelos». Solo si la tirada trae el
 * objetivo ya revelado (CA o CD); un crítico o una pifia no tienen margen
 * porque los decide el dado, no la suma.
 */
export function textoDelMargen(roll) {
  const outcome = roll?.outcome;
  if (!outcome?.contra) return null;
  const total = Number(roll.total);
  const valor = Number(outcome.contra.valor);
  if (!Number.isFinite(total) || !Number.isFinite(valor)) return null;
  if (outcome.resultado === 'impacta' || outcome.resultado === 'supera') {
    const sobra = total - valor;
    return sobra <= 0 ? 'por los pelos' : `por ${sobra}`;
  }
  if (outcome.resultado === 'falla' || outcome.resultado === 'no-supera') {
    const falta = valor - total;
    return falta <= 2 ? 'por los pelos' : `por ${falta}`;
  }
  return null;
}

/** «contra CA 15», «contra CD 13». */
export function textoContra(outcome) {
  if (!outcome?.contra) return null;
  return `contra ${outcome.contra.etiqueta ?? 'CD'} ${outcome.contra.valor}`;
}

/** Los d20 que cuentan y el modificador, para enseñar «14 + 5». */
export function desgloseCorto(roll) {
  const naturales = [];
  for (const group of roll?.groups ?? []) {
    for (const result of group.results ?? []) naturales.push(result.kept);
  }
  const modificador = Number(roll?.modifier) || 0;
  const dados = naturales.length > 6 ? `${naturales.length} dados` : naturales.join(' + ');
  if (!dados) return modificador ? String(modificador) : '';
  if (!modificador) return dados;
  return `${dados} ${modificador > 0 ? '+' : '−'} ${Math.abs(modificador)}`;
}
