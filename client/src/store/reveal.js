import { create } from 'zustand';
import {
  MARGEN_ATERRIZAJE_MS,
  RESERVA_MAXIMA_MS,
  RITMO_POR_DEFECTO,
  cabeza,
  cancelar as cancelarEntrada,
  confirmar as confirmarEntrada,
  crearCola,
  empezar,
  encolar,
  enEspera,
  estaRevelada,
  normalizarRitmo,
  planDeRevelado,
  recibirTirada,
  retener as retenerEnCola,
  revelar,
  ritmoEfectivo,
  terminar,
} from '../features/dice-tray/lib/reveal.js';

// Store de la cola de revelado (Fase 4b). La lógica de orden vive pura en
// `features/dice-tray/lib/reveal.js`; aquí solo se le ponen relojes: cuándo
// empieza a rodar la siguiente, cuándo se enseña cada paso y cuándo sale.
//
// Quien tira algo propio usa `tirar` (o `tirarYEnviar` si lo valida el
// servidor); el socket mete aquí las tiradas que llegan de la mesa con
// `recibir` y pasa por `retener` todo lo que no debe adelantarse al dado.

const RITMO_KEY = 'tri-dnd:ritmo';

function leerRitmo() {
  try {
    return normalizarRitmo(window.localStorage.getItem(RITMO_KEY));
  } catch {
    return RITMO_POR_DEFECTO;
  }
}

function prefiereMenosMovimiento() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

// Promesas de «ya se ve el resultado» de cada tirada propia, y temporizadores
// por tirada. Fuera del estado: no son datos que pintar.
const promesas = new Map();
const temporizadores = new Map();

function crearPromesa(id) {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  promesas.set(id, { promise, resolve });
  return promise;
}

function resolver(id, valor = { cancelada: false }) {
  const entrada = promesas.get(id);
  if (!entrada) return;
  promesas.delete(id);
  entrada.resolve(valor);
}

function programar(id, ms, fn) {
  const timer = setTimeout(fn, Math.max(0, ms));
  const lista = temporizadores.get(id) ?? [];
  lista.push(timer);
  temporizadores.set(id, lista);
}

function limpiar(id) {
  for (const timer of temporizadores.get(id) ?? []) clearTimeout(timer);
  temporizadores.delete(id);
}

function ejecutar(liberados) {
  for (const fn of liberados) {
    try {
      fn();
    } catch (error) {
      console.error('Error al soltar un evento retenido:', error);
    }
  }
}

export const useReveal = create((set, get) => ({
  cola: crearCola(),
  ritmo: leerRitmo(),
  // 'mesa' en el tablero (los dados caen en la franja baja para no tapar el
  // objetivo) o 'centro' en el resto de pantallas.
  escenario: 'centro',
  // La tirada que se está enseñando: { id, plan, paso, aterrizada }
  activa: null,

  setRitmo(ritmo) {
    const limpio = normalizarRitmo(ritmo);
    try {
      window.localStorage.setItem(RITMO_KEY, limpio);
    } catch {
      // Sin almacenamiento (ventana privada): el ritmo dura lo que la pestaña
    }
    set({ ritmo: limpio });
  },

  setEscenario(escenario) {
    set({ escenario: escenario === 'mesa' ? 'mesa' : 'centro' });
  },

  /**
   * Una tirada propia a la cola. Con `esperarEco` queda reservada hasta que el
   * servidor la devuelva (o `empezar()`), y `cancelar()` la retira si la rechaza.
   */
  tirar(roll, { autor = null, esperarEco = false, oculta = false } = {}) {
    const { cola, id } = encolar(get().cola, { roll, autor, local: true, reservada: esperarEco, oculta });
    set({ cola });
    const revelada = crearPromesa(id);
    if (esperarEco) programar(id, RESERVA_MAXIMA_MS, () => get().caducarReserva(id));
    get().avanzar();
    return {
      id,
      revelada,
      empezar: (parche = null) => get().confirmar(id, parche),
      cancelar: () => get().cancelar(id),
    };
  },

  /** Mensaje de chat de tipo 'roll' recién llegado por el socket. */
  recibir(message) {
    if (message?.type !== 'roll' || !message.body || typeof message.body !== 'object') return;
    const { cola } = recibirTirada(get().cola, {
      roll: message.body,
      autor: message.author?.name ?? null,
      oculta: Boolean(message.hidden),
    });
    set({ cola });
    get().avanzar();
  },

  /** Ejecuta `fn` cuando se revele la última tirada pendiente (o ya). */
  retener(fn) {
    const { cola, inmediato } = retenerEnCola(get().cola, fn);
    if (inmediato) {
      fn();
      return;
    }
    set({ cola });
  },

  confirmar(id, parche = null) {
    set({ cola: confirmarEntrada(get().cola, id, parche) });
    get().avanzar();
  },

  caducarReserva(id) {
    const entrada = get().cola.entradas.find((item) => item.id === id);
    if (entrada?.estado === 'reservada') get().cancelar(id);
  },

  cancelar(id) {
    const { cola, liberados } = cancelarEntrada(get().cola, id);
    limpiar(id);
    const activa = get().activa?.id === id ? null : get().activa;
    set({ cola, activa });
    resolver(id, { cancelada: true });
    ejecutar(liberados);
    get().avanzar();
  },

  /** La bandeja avisa de que el último dado ha caído. */
  aterrizado(id) {
    const { activa } = get();
    if (!activa || activa.id !== id || activa.aterrizada) return;
    set({ activa: { ...activa, aterrizada: true, paso: 0 } });
    const { plan } = activa;
    plan.pasos.forEach((paso, index) => {
      if (index === 0) return;
      programar(id, paso.trasAterrizajeMs, () => {
        const actual = get().activa;
        if (actual?.id === id) set({ activa: { ...actual, paso: index } });
      });
    });
    programar(id, plan.reveladoMs, () => get().revelarActiva(id));
    programar(id, plan.finMs, () => get().terminarActiva(id));
  },

  revelarActiva(id) {
    const { cola, liberados } = revelar(get().cola, id);
    set({ cola });
    resolver(id);
    ejecutar(liberados);
  },

  terminarActiva(id) {
    limpiar(id);
    if (!estaRevelada(get().cola, id)) get().revelarActiva(id);
    set({ cola: terminar(get().cola, id), activa: get().activa?.id === id ? null : get().activa });
    get().avanzar();
  },

  /** Si la cabeza está lista y nadie rueda, que empiece. */
  avanzar() {
    const { cola, activa } = get();
    const primera = cabeza(cola);
    if (!primera || activa?.id === primera.id || primera.estado !== 'lista') return;
    const ritmo = ritmoEfectivo(get().ritmo, {
      enEspera: enEspera(cola),
      sinAnimacion: prefiereMenosMovimiento(),
    });
    const plan = planDeRevelado(primera.roll, ritmo);
    set({ cola: empezar(cola, primera.id), activa: { id: primera.id, plan, paso: -1, aterrizada: false } });
    if (!plan.conDados) {
      get().aterrizado(primera.id);
    } else {
      // Red de seguridad: si la bandeja no carga o la pestaña está oculta y no
      // pinta, el resultado se enseña igual pasado el vuelo.
      programar(primera.id, plan.aterrizajeMs + MARGEN_ATERRIZAJE_MS, () => get().aterrizado(primera.id));
    }
  },
}));

/** ¿Hay alguna tirada propia en el aire? (los paneles se apartan) */
export function hayTiradaPropia(state) {
  return state.cola.entradas.some((entrada) => entrada.local && entrada.estado !== 'revelada');
}

/** Atajo para retener sin suscribirse al store. */
export function trasElDado(fn) {
  useReveal.getState().retener(fn);
}

/**
 * Tirada propia que valida el servidor: rueda al aceptarla, se retira si la
 * rechaza, y la respuesta se devuelve cuando el dado ya se ha revelado.
 */
export async function tirarYEnviar(roll, enviar, { autor = null, parcheDeRespuesta = null } = {}) {
  const handle = useReveal.getState().tirar(roll, { autor, esperarEco: true });
  let resp;
  try {
    resp = await enviar(roll);
  } catch (error) {
    handle.cancelar();
    throw error;
  }
  if (!resp || resp.error) {
    handle.cancelar();
    return resp;
  }
  // Las que no vuelven por la mesa traen su veredicto en la respuesta
  handle.empezar(parcheDeRespuesta ? parcheDeRespuesta(resp) : null);
  await handle.revelada;
  return resp;
}
