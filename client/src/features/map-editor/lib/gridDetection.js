// Detección de la cuadrícula dibujada en una imagen de mapa (Tehox, Roll20,
// Dungeondraft...). Las líneas de la cuadrícula producen bordes verticales y
// horizontales que se repiten a intervalos regulares: se proyecta la fuerza
// de borde por columna y por fila y se busca el periodo (tamaño de casilla
// en píxeles) y el desfase (dónde cae la primera línea) que mejor explican
// esos picos. Todo ocurre en el cliente; los valores devueltos están en
// píxeles de la imagen original.

const MAX_ANALYSIS_SIZE = 1200; // lado mayor del lienzo de análisis
const MIN_CELL_ANALYSIS_PX = 12; // casilla mínima plausible, en px de análisis

// Perfiles de fuerza de borde: colEdge[x] acumula |gris(x) − gris(x−1)| a lo
// largo de la columna (detecta líneas verticales), rowEdge lo mismo por filas.
function buildEdgeProfiles(img) {
  const scale = Math.min(1, MAX_ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const sw = Math.max(2, Math.round(img.naturalWidth * scale));
  const sh = Math.max(2, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  const gray = new Float64Array(sw * sh);
  for (let i = 0; i < sw * sh; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const colEdge = new Float64Array(sw);
  const rowEdge = new Float64Array(sh);
  for (let y = 1; y < sh; y += 1) {
    for (let x = 1; x < sw; x += 1) {
      const i = y * sw + x;
      colEdge[x] += Math.abs(gray[i] - gray[i - 1]);
      rowEdge[y] += Math.abs(gray[i] - gray[i - sw]);
    }
  }

  // Centrar en cero: así una alineación al azar puntúa ~0 y una línea real
  // destaca en positivo
  for (const profile of [colEdge, rowEdge]) {
    let mean = 0;
    for (const v of profile) mean += v;
    mean /= profile.length;
    for (let i = 0; i < profile.length; i += 1) profile[i] -= mean;
  }

  return { colEdge, rowEdge, scale };
}

// Puntúa un periodo candidato p (puede ser fraccional): media del perfil
// muestreado cada p píxeles, maximizada sobre el desfase inicial. Las líneas
// de cuadrícula reales suman valores altos en todas las muestras.
function foldScore(profile, p) {
  const n = profile.length;
  let best = { score: -Infinity, offset: 0 };
  const maxOffset = Math.ceil(p);
  for (let o = 0; o < maxOffset; o += 1) {
    let sum = 0;
    let count = 0;
    for (let pos = o; pos < n; pos += p) {
      // La línea puede tener 1-2 px de grosor a escala de análisis: tomar el
      // máximo del vecindario inmediato tolera ese grosor y errores de redondeo
      const i = Math.round(pos);
      const v = Math.max(profile[i] ?? -Infinity, profile[i - 1] ?? -Infinity, profile[i + 1] ?? -Infinity);
      if (v !== -Infinity) {
        sum += v;
        count += 1;
      }
    }
    if (count >= 3) {
      const score = sum / count;
      if (score > best.score) best = { score, offset: o };
    }
  }
  return best;
}

function bestPeriod(profile, minP, maxP) {
  const n = profile.length;

  // Autocorrelación del perfil: un periodo real p produce picos en p, 2p,
  // 3p... El fundamental es el primer pico local comparable al máximo (elegir
  // el máximo global caería en un múltiplo del tamaño de casilla).
  let r0 = 0;
  for (const v of profile) r0 += v * v;
  if (r0 === 0) return null;

  const corr = new Float64Array(maxP + 1);
  for (let lag = minP - 1; lag <= maxP; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) sum += profile[i] * profile[i + lag];
    corr[lag] = sum / (n - lag);
  }
  let peak = 0;
  for (let lag = minP; lag <= maxP; lag += 1) peak = Math.max(peak, corr[lag]);
  if (peak <= 0) return null;

  let period = 0;
  for (let lag = minP; lag < maxP; lag += 1) {
    const isLocalMax = corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1];
    if (isLocalMax && corr[lag] >= peak * 0.8) {
      period = lag;
      break;
    }
  }
  if (!period) return null;

  // Refinado fraccional alrededor del pico: en la imagen original, medio
  // píxel de error por casilla se acumula a lo largo de todo el mapa
  let best = { period, ...foldScore(profile, period) };
  for (let p = period - 1; p <= period + 1; p += 0.1) {
    if (p < minP) continue;
    const r = foldScore(profile, p);
    if (r.score > best.score) best = { period: p, ...r };
  }

  // Confianza: qué parte de la energía del perfil explica la periodicidad
  const confidence = Math.min(1, (corr[period] * (n - period)) / (r0 * 0.3));

  return { ...best, confidence };
}

// Detecta la cuadrícula de la imagen. Devuelve tamaño de casilla y desfase en
// píxeles de la imagen original, por eje (la sala se estira por eje, así que
// no hace falta forzar casillas cuadradas), más una confianza 0..1.
export function detectGrid(img) {
  const { colEdge, rowEdge, scale } = buildEdgeProfiles(img);
  const maxP = Math.floor(Math.min(colEdge.length, rowEdge.length) / 4);
  if (maxP <= MIN_CELL_ANALYSIS_PX) return null;

  const vx = bestPeriod(colEdge, MIN_CELL_ANALYSIS_PX, maxP);
  const vy = bestPeriod(rowEdge, MIN_CELL_ANALYSIS_PX, maxP);
  if (!vx || !vy) return null;

  let cellX = vx.period / scale;
  let cellY = vy.period / scale;
  // Si ambos ejes coinciden (lo normal: casillas cuadradas), promediar reduce
  // el error de cada eje por separado
  if (Math.abs(cellX - cellY) / ((cellX + cellY) / 2) < 0.04) {
    const c = (cellX + cellY) / 2;
    cellX = c;
    cellY = c;
  }

  return {
    cellX,
    cellY,
    offsetX: (vx.offset / scale) % cellX,
    offsetY: (vy.offset / scale) % cellY,
    confidence: Math.min(vx.confidence, vy.confidence),
  };
}

// Casillas completas que caben en la imagen a partir del desfase. El 0.02 de
// margen evita perder la última casilla por error de coma flotante.
export function gridDims(img, cal) {
  const cols = Math.max(1, Math.floor((img.naturalWidth - cal.offsetX) / cal.cellX + 0.02));
  const rows = Math.max(1, Math.floor((img.naturalHeight - cal.offsetY) / cal.cellY + 0.02));
  return { cols, rows };
}

// Recorta la región alineada con la cuadrícula (desde la primera línea hasta
// la última casilla completa) a resolución original y la devuelve como blob.
export function cropToGrid(img, cal, { type = 'image/webp', quality = 0.92 } = {}) {
  const { cols, rows } = gridDims(img, cal);
  const w = Math.round(cols * cal.cellX);
  const h = Math.round(rows * cal.cellY);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, Math.round(cal.offsetX), Math.round(cal.offsetY), w, h, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, cols, rows }) : reject(new Error('No se pudo procesar la imagen'))),
      type,
      quality
    );
  });
}
