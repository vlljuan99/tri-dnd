// Aspecto de cada proyectil en el tablero. El servidor decide QUÉ vuela
// (services/projectiles.js, a partir del arma); aquí se decide cómo se ve, y
// añadir una familia nueva es añadir una entrada a esta tabla.
//
// `shape` lo dibuja el componente: 'asta' (flecha, virote, jabalina), 'bola'
// (piedra, destello) y 'aguja' (dardo). `spin` hace girar el arma arrojada
// sobre sí misma, que es lo que distingue una jabalina lanzada de una flecha.
export const PROJECTILE_LOOKS = {
  flecha: { shape: 'asta', color: '#d9c79a', length: 0.62, thickness: 0.05, speed: 22, spin: false, trail: 0.35 },
  virote: { shape: 'asta', color: '#b9a98a', length: 0.42, thickness: 0.06, speed: 27, spin: false, trail: 0.3 },
  lanzada: { shape: 'asta', color: '#c8b9a0', length: 0.78, thickness: 0.07, speed: 15, spin: true, trail: 0.25 },
  piedra: { shape: 'bola', color: '#9c968c', length: 0.16, thickness: 0.16, speed: 16, spin: true, trail: 0.2 },
  dardo: { shape: 'aguja', color: '#8fa07c', length: 0.34, thickness: 0.035, speed: 24, spin: false, trail: 0.25 },
  conjuro: { shape: 'bola', color: '#a98bff', length: 0.2, thickness: 0.2, speed: 18, spin: false, trail: 0.6 },
  proyectil: { shape: 'bola', color: '#cbb27a', length: 0.18, thickness: 0.18, speed: 20, spin: false, trail: 0.3 },
};

export function projectileLook(kind) {
  return PROJECTILE_LOOKS[kind] ?? PROJECTILE_LOOKS.proyectil;
}

/**
 * Cuánto dura el vuelo, en milisegundos. Un disparo al otro lado del mapa no
 * puede tardar lo mismo que uno a dos casillas —parecería teletransporte— pero
 * tampoco puede eternizarse: la mesa está esperando el resultado.
 */
export function flightDuration(distance, kind) {
  const { speed } = projectileLook(kind);
  return Math.max(140, Math.min(900, (Math.max(0.5, distance) / speed) * 1000));
}

/**
 * Resuelve las dos puntas del vuelo contra los tokens del tablero. El servidor
 * manda referencias públicas (`characterId` o `mapTokenId`), no coordenadas:
 * así el proyectil sale de donde de verdad está la ficha en tu pantalla, y si
 * uno de los dos ya no está (murió, se fue de la planta), no se pinta nada.
 */
export function resolveProjectile(visual, tokens = []) {
  if (!visual || visual.type !== 'proyectil') return null;
  const find = (ref) => {
    if (!ref) return null;
    return (
      tokens.find((token) =>
        ref.characterId != null ? token.characterId === ref.characterId : token.serverId === ref.mapTokenId
      ) ?? null
    );
  };
  const from = find(visual.from);
  const to = find(visual.to);
  if (!from || !to) return null;
  return { from, to, look: projectileLook(visual.kind), hit: visual.hit !== false };
}
