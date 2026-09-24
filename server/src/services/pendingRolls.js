// Tiradas pendientes (Fase 4c): en los momentos que importan a un PJ —su
// salvación, su iniciativa, lo que pide el DM— el jugador pulsa y tira.
//
// El SERVIDOR sigue tirando. Lo que cambia es el cuándo: la tirada espera a que
// el dueño del PJ pulse «Tirar» (o a que venza el plazo, y entonces se tira
// sola). Así el dado nace de un gesto del jugador sin que el cliente pueda
// elegir el número, y ninguna resolución queda colgada: el plazo lo impone el
// servidor, no el navegador.
//
// Este módulo no sabe de sockets ni de SQLite. Quien pide una tirada le pasa
// cómo construirla (`tirar`) y qué hacer con ella al salir (`alTirar`); los
// avisos a la mesa los engancha sockets.js con `configurar`. Las pendientes
// viven en memoria: si el servidor se reinicia, la acción en vuelo se pierde
// con él (ver el informe de la fase).

export const PLAZO_TIRADA_MS = 8000;

export const TIPOS_TIRADA = ['salvacion', 'iniciativa', 'concentracion', 'prueba', 'habilidad'];

export function createPendingRolls({
  plazoMs = PLAZO_TIRADA_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
} = {}) {
  const pendientes = new Map();
  let siguienteId = 1;
  let avisos = {
    creada: () => {},
    resuelta: () => {},
    debeTirarSola: () => false,
  };

  function configurar(handlers = {}) {
    avisos = { ...avisos, ...handlers };
  }

  // Lo que ve un cliente de una pendiente: nunca la CD si no está revelada.
  function publica(entrada) {
    return {
      id: entrada.id,
      campaignId: entrada.campaignId,
      characterId: entrada.characterId,
      ownerUserId: entrada.ownerUserId,
      tipo: entrada.tipo,
      etiqueta: entrada.etiqueta,
      nombre: entrada.nombre,
      caracteristica: entrada.caracteristica,
      habilidad: entrada.habilidad,
      origen: entrada.origen,
      grupoId: entrada.grupoId,
      cd: entrada.revelarCd ? entrada.cd : null,
      plazo: entrada.plazo,
    };
  }

  function cerrar(id, { automatica, motivo }) {
    const entrada = pendientes.get(id);
    if (!entrada) return null;
    pendientes.delete(id);
    if (entrada.timer) clearTimer(entrada.timer);
    let roll = null;
    let exito = null;
    try {
      roll = entrada.tirar({ automatica, motivo });
      exito = entrada.evaluar ? entrada.evaluar(roll) : null;
      entrada.alTirar?.(roll, { automatica, motivo });
    } catch (error) {
      console.error('[tiradas] no se pudo resolver una tirada pendiente:', error);
    }
    // El total y el éxito viajan al aviso: el panel del DM los enseña al momento
    avisos.resuelta(publica(entrada), { automatica, motivo, total: roll?.total ?? null, exito });
    entrada.resolve({ roll, automatica, motivo, cancelada: false });
    return entrada;
  }

  /**
   * Pide una tirada al dueño de un PJ. Devuelve una promesa que se cumple con
   * `{ roll, automatica, motivo }` cuando se tira (por el jugador, por el DM o
   * por plazo). Si el jugador no puede o no quiere esperar (preferencia de
   * tirar solo, desconectado), se tira al instante sin avisar a nadie.
   */
  function solicitar({
    campaignId,
    characterId = null,
    ownerUserId = null,
    tipo,
    etiqueta,
    nombre = null,
    caracteristica = null,
    habilidad = null,
    cd = null,
    revelarCd = false,
    origen = null,
    grupoId = null,
    tirar,
    alTirar = null,
    evaluar = null,
    plazo = plazoMs,
  }) {
    if (typeof tirar !== 'function') throw new Error('Una tirada pendiente necesita saber cómo tirarse');
    return new Promise((resolve) => {
      const id = siguienteId;
      siguienteId += 1;
      const entrada = {
        id,
        campaignId: Number(campaignId),
        characterId,
        ownerUserId,
        tipo,
        etiqueta,
        nombre,
        caracteristica,
        habilidad,
        cd,
        revelarCd: Boolean(revelarCd),
        origen,
        grupoId,
        tirar,
        alTirar,
        evaluar,
        resolve,
        creada: now(),
        plazo: now() + plazo,
        timer: null,
      };
      pendientes.set(id, entrada);
      if (ownerUserId == null || avisos.debeTirarSola(publica(entrada))) {
        cerrar(id, { automatica: true, motivo: 'sin-espera' });
        return;
      }
      entrada.timer = setTimer(() => cerrar(id, { automatica: true, motivo: 'plazo' }), plazo);
      avisos.creada(publica(entrada));
    });
  }

  /** El dueño pulsa «Tirar»; el DM puede adelantar cualquiera («Tirar ya»). */
  function resolver(id, { userId, isDm = false } = {}) {
    const entrada = pendientes.get(Number(id));
    if (!entrada) return { error: 'Esa tirada ya no está pendiente' };
    const propia = entrada.ownerUserId != null && entrada.ownerUserId === userId;
    if (!propia && !isDm) return { error: 'Esa tirada no es tuya' };
    cerrar(entrada.id, { automatica: !propia, motivo: propia ? 'jugador' : 'dm' });
    return { ok: true };
  }

  /** El DM tira ya por todas (o por las indicadas) de una campaña. */
  function forzar(campaignId, { ids = null } = {}) {
    const objetivo = ids ? new Set(ids.map(Number)) : null;
    const lista = [...pendientes.values()].filter(
      (entrada) => entrada.campaignId === Number(campaignId) && (!objetivo || objetivo.has(entrada.id))
    );
    for (const entrada of lista) cerrar(entrada.id, { automatica: true, motivo: 'dm' });
    return lista.length;
  }

  /**
   * Retira sin tirar las pendientes que ya no tienen sentido (se acabó el
   * combate: una iniciativa pendiente no debe tirarse ya). La promesa se
   * cumple con `cancelada: true` para que quien esperaba no siga.
   */
  function cancelar(campaignId, { tipos = null } = {}) {
    const lista = [...pendientes.values()].filter(
      (entrada) => entrada.campaignId === Number(campaignId) && (!tipos || tipos.includes(entrada.tipo))
    );
    for (const entrada of lista) {
      pendientes.delete(entrada.id);
      if (entrada.timer) clearTimer(entrada.timer);
      avisos.resuelta(publica(entrada), { automatica: false, motivo: 'cancelada' });
      entrada.resolve({ roll: null, automatica: false, motivo: 'cancelada', cancelada: true });
    }
    return lista.length;
  }

  /** Las que puede ver cada cual: el DM todas; el jugador, las suyas. */
  function listar(campaignId, { userId = null, isDm = false } = {}) {
    return [...pendientes.values()]
      .filter((entrada) => entrada.campaignId === Number(campaignId))
      .filter((entrada) => isDm || entrada.ownerUserId === userId)
      .map(publica);
  }

  /** La pendiente de un PJ concreto y de un tipo, si la hay. */
  function buscar(campaignId, { characterId, tipo }) {
    const entrada = [...pendientes.values()].find(
      (item) => item.campaignId === Number(campaignId) && item.characterId === characterId && item.tipo === tipo
    );
    return entrada ? publica(entrada) : null;
  }

  return { configurar, solicitar, resolver, forzar, cancelar, listar, buscar, tamano: () => pendientes.size };
}

// La instancia de la aplicación. Las pruebas de dominio crean la suya con
// relojes falsos; las de integración acortan el plazo con la variable.
export const pendingRolls = createPendingRolls({
  plazoMs: Number(process.env.TRIDND_PLAZO_TIRADA_MS) || PLAZO_TIRADA_MS,
});
