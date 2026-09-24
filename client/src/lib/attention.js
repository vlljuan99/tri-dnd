// «¡Tu turno!» aunque estés en otra ventana (Fase 3, añadido): con la voz en
// Discord, la pestaña de la mesa suele estar detrás y el turno se pierde. Si
// la pestaña no está visible, el título parpadea hasta que vuelves, y hay una
// notificación del navegador si la has activado (se pide con un botón, nunca
// al entrar).

const AVISO_KEY = 'tri-dnd:aviso-turno';
export const TITULO_TURNO = '⚔ ¡Tu turno! · TriDnD';

/** El título que toca en cada tic del parpadeo. */
export function tituloParpadeo(original, tic) {
  return tic % 2 === 0 ? TITULO_TURNO : original;
}

export function notificacionesActivadas() {
  try {
    return (
      window.localStorage.getItem(AVISO_KEY) === '1' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    );
  } catch {
    return false;
  }
}

/** Pide permiso y recuerda la preferencia. Devuelve si quedó activado. */
export async function activarNotificaciones(activo) {
  try {
    if (!activo) {
      window.localStorage.setItem(AVISO_KEY, '0');
      return false;
    }
    if (typeof Notification === 'undefined') return false;
    const permiso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    const ok = permiso === 'granted';
    window.localStorage.setItem(AVISO_KEY, ok ? '1' : '0');
    return ok;
  } catch {
    return false;
  }
}

/**
 * Llama la atención sobre tu turno si la pestaña está oculta. Devuelve la
 * función que lo cancela (al volver a la pestaña se cancela solo).
 */
export function avisarTurno({ nombre = null } = {}) {
  if (typeof document === 'undefined' || !document.hidden) return () => {};
  const original = document.title;
  let tic = 0;
  const timer = setInterval(() => {
    document.title = tituloParpadeo(original, tic);
    tic += 1;
  }, 1000);
  document.title = TITULO_TURNO;
  let notificacion = null;
  if (notificacionesActivadas()) {
    try {
      notificacion = new Notification('¡Tu turno!', {
        body: nombre ? `${nombre} puede actuar.` : 'Es hora de actuar.',
        tag: 'tridnd-turno',
      });
    } catch {
      notificacion = null;
    }
  }
  function parar() {
    clearInterval(timer);
    document.title = original;
    notificacion?.close?.();
    document.removeEventListener('visibilitychange', alVolver);
  }
  function alVolver() {
    if (!document.hidden) parar();
  }
  document.addEventListener('visibilitychange', alVolver);
  return parar;
}
