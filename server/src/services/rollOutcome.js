// Veredicto que viaja con cada tirada resuelta (Fase 4b). La mesa revela la
// tirada por pasos —total, contra qué, veredicto— y cada pantalla necesita
// saber el «contra qué» sin esperar a la línea de sistema. Solo lleva lo que
// ya se narra en el chat tras resolver: el objetivo, la CA o CD y el resultado.
//
// El `outcome` lo escribe SIEMPRE el servidor: el que mande un cliente se tira.
// Vive aquí y no en sockets.js porque también lo usan los servicios que tiran
// por su cuenta (zonas de peligro, fluidos, tiradas pedidas por el DM).

export function rollWithOutcome(roll, outcome = null) {
  // eslint-disable-next-line no-unused-vars
  const { outcome: _clientOutcome, ...clean } = roll ?? {};
  return outcome ? { ...clean, outcome } : clean;
}

export function attackOutcome({ hit, crit, fumble, targetName, ac, effects = null }) {
  // Por qué se tiraron dos d20: las condiciones que lo causan ya son públicas
  // en la mesa (derribado, esquivando…), así que viajan con la tirada.
  const motivos =
    effects?.advantage === 'adv'
      ? effects.advantageReasons ?? []
      : effects?.advantage === 'dis'
        ? effects.disadvantageReasons ?? []
        : [];
  return {
    tipo: 'ataque',
    objetivo: targetName ?? null,
    contra: Number.isFinite(Number(ac)) ? { etiqueta: 'CA', valor: Number(ac) } : null,
    resultado: crit ? 'critico' : hit ? 'impacta' : fumble ? 'pifia' : 'falla',
    ...(motivos.length ? { motivos } : {}),
  };
}

export function saveOutcome({ saved, dc, targetName, tipo = 'salvacion' }) {
  return {
    tipo,
    objetivo: targetName ?? null,
    contra: Number.isFinite(Number(dc)) ? { etiqueta: 'CD', valor: Number(dc) } : null,
    resultado: saved ? 'supera' : 'no-supera',
  };
}

/**
 * Veredicto de una prueba cuya CD puede ser secreta (tiradas que pide el DM).
 * Con la CD oculta la tirada viaja sin veredicto: la mesa ve el número y el
 * DM narra; con la CD revelada, lleva el «contra CD 13 · supera» completo.
 */
export function checkOutcome({ success, dc, reveal, targetName, tipo = 'prueba' }) {
  if (!reveal || !Number.isFinite(Number(dc))) return null;
  return saveOutcome({ saved: success, dc, targetName, tipo });
}
