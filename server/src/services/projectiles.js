// Qué se ve volar cuando alguien dispara. El tablero ya narraba el resultado
// (impacto, fallo, daño) pero el disparo en sí era invisible: el enemigo perdía
// vida sin que nada cruzara el mapa. Aquí se decide QUÉ vuela; el cliente se
// encarga de dibujarlo.
//
// La familia se deduce del arma para que una honda no dispare flechas y una
// jabalina se vea girar. Añadir una nueva es añadir una entrada, no tocar el
// combate.

export const PROJECTILE_KINDS = ['flecha', 'virote', 'piedra', 'dardo', 'lanzada', 'conjuro', 'proyectil'];

// Por índice del SRD, que es estable e independiente del idioma del nombre.
const BY_SRD_INDEX = {
  shortbow: 'flecha',
  longbow: 'flecha',
  'crossbow-light': 'virote',
  'crossbow-heavy': 'virote',
  'crossbow-hand': 'virote',
  sling: 'piedra',
  dart: 'dardo',
  blowgun: 'dardo',
  javelin: 'lanzada',
  spear: 'lanzada',
  trident: 'lanzada',
  handaxe: 'lanzada',
  'light-hammer': 'lanzada',
  dagger: 'lanzada',
  net: 'lanzada',
};

// Y si no hay índice (arma casera, ficha de monstruo), por lo que dice el
// nombre en cualquiera de los dos idiomas de la mesa.
// El orden importa: "ballesta"/"crossbow" se comprueba antes que "arco"/"bow"
// porque `crossbow` contiene `bow`, y una ballesta dispara virotes.
const BY_NAME = [
  [/ballesta|crossbow|virote|bolt/i, 'virote'],
  [/arco|bow/i, 'flecha'],
  [/honda|sling|piedra|stone|rock/i, 'piedra'],
  [/dardo|dart|cerbatana|blowgun|aguja/i, 'dardo'],
  [/jabalina|javelin|lanza|spear|hacha|axe|daga|dagger|tridente|trident/i, 'lanzada'],
  [/rayo|ray|conjuro|spell|magic|arcano/i, 'conjuro'],
];

/**
 * Familia del proyectil de un ataque, o null si no vuela nada (cuerpo a cuerpo).
 *
 * @param geometry geometría del arma/acción ya resuelta (`ranged`, `thrown`)
 * @param srdIndex índice del equipo en el SRD, si el arma viene del compendio
 * @param name nombre del arma o de la acción del monstruo
 */
export function projectileKind({ geometry, srdIndex = null, name = '' } = {}) {
  const thrown = Boolean(geometry?.thrown);
  // Un arma cuerpo a cuerpo que NO se lanza no dispara nada: el golpe ya se
  // cuenta con la sacudida del objetivo.
  if (!geometry?.ranged && !thrown) return null;

  const byIndex = srdIndex ? BY_SRD_INDEX[String(srdIndex).toLowerCase()] : null;
  // Lanzarla manda sobre su familia: una daga arrojada vuela girando aunque
  // también sirva para apuñalar.
  if (thrown) return byIndex === 'flecha' || byIndex === 'virote' ? 'lanzada' : byIndex ?? 'lanzada';
  if (byIndex) return byIndex;

  const match = BY_NAME.find(([pattern]) => pattern.test(name ?? ''));
  return match ? match[1] : 'proyectil';
}
