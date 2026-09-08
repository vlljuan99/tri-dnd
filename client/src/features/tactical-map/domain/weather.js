export const TACTICAL_CAMERA_DISTANCE = 60;

const TIME_COLORS = {
  amanecer: '#202022',
  dia: '#15191b',
  atardecer: '#1d1b20',
  noche: '#080e17',
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function sceneLighting(map, hasLights) {
  const time = map.timeOfDay ?? 'dia';
  const nightFactor = time === 'noche' ? 0.34 : time === 'atardecer' || time === 'amanecer' ? 0.68 : 1;
  // La hora sigue marcando el objetivo, pero ninguna escena visible cae por
  // debajo de este suelo. Las antorchas suman una pequeña base global y sus
  // pointLight aportan después las pozas cálidas locales: nunca oscurecen el
  // ambiente por el mero hecho de existir.
  const ambientTarget = 0.95 * nightFactor + (hasLights ? 0.05 : 0);
  const directionalTarget = 0.7 * nightFactor + (hasLights ? 0.03 : 0);
  return {
    background: TIME_COLORS[time] ?? TIME_COLORS.dia,
    ambient: Math.max(0.56, ambientTarget),
    directional: Math.max(0.42, directionalTarget),
  };
}

export function weatherFog(map) {
  const weather = map.weather ?? 'despejado';
  if (weather !== 'niebla' && weather !== 'lluvia') return null;

  const parsedIntensity = Number(map.weatherIntensity ?? 0.55);
  const intensity = clamp(Number.isFinite(parsedIntensity) ? parsedIntensity : 0.55, 0, 1);
  const width = Math.max(Number(map.width) || 0, 1);
  const height = Math.max(Number(map.height) || 0, 1);
  const boardRadius = Math.hypot(width, height) / 2;

  // La cámara orbita a 60 unidades del centro. El límite lejano debe superar
  // además el radio del tablero o Three.js lo reemplaza entero por el color
  // de la niebla, que fue lo que ocultó mapa, rejilla y tokens en producción.
  const farthestBoardPoint = TACTICAL_CAMERA_DISTANCE + boardRadius;

  if (weather === 'lluvia') {
    return {
      color: '#283039',
      near: TACTICAL_CAMERA_DISTANCE - 10 - intensity * 4,
      far: farthestBoardPoint + 18 - intensity * 4,
    };
  }

  return {
    color: '#6e7471',
    near: TACTICAL_CAMERA_DISTANCE - 18 - intensity * 5,
    far: farthestBoardPoint + 9 - intensity * 4,
  };
}
