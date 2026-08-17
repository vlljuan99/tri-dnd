export const TACTICAL_CAMERA_DISTANCE = 60;

const TIME_COLORS = {
  amanecer: '#392b2a',
  dia: '#14110f',
  atardecer: '#2b1c20',
  noche: '#070a13',
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function sceneLighting(map, hasLights) {
  const time = map.timeOfDay ?? 'dia';
  const nightFactor = time === 'noche' ? 0.34 : time === 'atardecer' || time === 'amanecer' ? 0.68 : 1;
  return {
    background: TIME_COLORS[time] ?? TIME_COLORS.dia,
    ambient: (hasLights ? 0.6 : 0.95) * nightFactor,
    directional: (hasLights ? 0.45 : 0.7) * nightFactor,
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
