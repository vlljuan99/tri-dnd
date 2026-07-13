// Importador de archivos Universal VTT (.dd2vtt / .uvtt / .df2vtt, los
// exporta Dungeondraft y otros editores de mapas). El archivo trae la imagen
// del mapa en base64, el tamaño exacto en casillas, y los muros como
// polilíneas en unidades de cuadrícula: aquí se "ajustan" a nuestras paredes
// por arista (wall_edges, v29). Las luces del archivo se ignoran por ahora
// (fase 12) y los portales cerrados se importan como pared (el DM puede
// quitarla con el pincel).

// Tolerancia para considerar que un tramo discurre SOBRE una línea de la
// cuadrícula (el caso normal en muros de mazmorra de Dungeondraft)
const ON_LINE_EPS = 0.25;

// Aristas canónicas cruzadas o recorridas por el segmento a→b (en unidades
// de casilla): 'v:x,y' es el borde vertical entre (x-1,y) y (x,y); 'h:x,y'
// el horizontal entre (x,y-1) y (x,y). Un muro alineado con la cuadrícula
// marca las aristas que recorre; uno diagonal (cuevas) se escalona marcando
// las aristas que va cruzando.
export function segmentEdges(a, b) {
  const edges = new Set();

  const nearX = Math.round((a.x + b.x) / 2);
  const alignedV =
    Math.abs(a.x - nearX) <= ON_LINE_EPS &&
    Math.abs(b.x - nearX) <= ON_LINE_EPS &&
    Math.round(a.x) === Math.round(b.x);
  const nearY = Math.round((a.y + b.y) / 2);
  const alignedH =
    Math.abs(a.y - nearY) <= ON_LINE_EPS &&
    Math.abs(b.y - nearY) <= ON_LINE_EPS &&
    Math.round(a.y) === Math.round(b.y);

  if (alignedV && !alignedH) {
    const x = Math.round(a.x);
    const y0 = Math.round(Math.min(a.y, b.y));
    const y1 = Math.round(Math.max(a.y, b.y));
    for (let y = y0; y < y1; y += 1) edges.add(`v:${x},${y}`);
    return edges;
  }
  if (alignedH && !alignedV) {
    const y = Math.round(a.y);
    const x0 = Math.round(Math.min(a.x, b.x));
    const x1 = Math.round(Math.max(a.x, b.x));
    for (let x = x0; x < x1; x += 1) edges.add(`h:${x},${y}`);
    return edges;
  }
  if (alignedV && alignedH) return edges; // tramo puntual: nada que marcar

  // Tramo libre (muro de cueva, diagonal): se muestrea fino y cada cambio de
  // casilla marca la arista cruzada, escalonando el muro sobre la cuadrícula
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.min(4000, Math.max(2, Math.ceil(length / 0.05)));
  let pc = Math.floor(a.x);
  let pr = Math.floor(a.y);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const c = Math.floor(a.x + dx * t);
    const r = Math.floor(a.y + dy * t);
    if (c !== pc && r === pr) edges.add(`v:${Math.max(c, pc)},${r}`);
    else if (r !== pr && c === pc) edges.add(`h:${c},${Math.max(r, pr)}`);
    else if (c !== pc && r !== pr) {
      // Cruce de esquina entre dos muestras: se marcan ambas aristas para
      // que el escalón no deje rendija
      edges.add(`v:${Math.max(c, pc)},${pr}`);
      edges.add(`h:${c},${Math.max(r, pr)}`);
    }
    pc = c;
    pr = r;
  }
  return edges;
}

// Convierte aristas canónicas absolutas a entradas wall_edges [col, fila,
// lado] de una sala de cols×rows con origen en (0,0), descartando las que
// caen fuera. El borde exterior derecho/inferior se expresa desde la última
// casilla ('e'/'s') porque no hay casilla al otro lado.
export function wallEntriesFromEdges(edgeKeys, cols, rows) {
  const entries = [];
  for (const key of edgeKeys) {
    const [kind, coords] = key.split(':');
    const [x, y] = coords.split(',').map(Number);
    if (kind === 'v') {
      if (y < 0 || y >= rows || x < 0 || x > cols) continue;
      entries.push(x < cols ? [x, y, 'o'] : [cols - 1, y, 'e']);
    } else {
      if (x < 0 || x >= cols || y < 0 || y > rows) continue;
      entries.push(y < rows ? [x, y, 'n'] : [x, rows - 1, 's']);
    }
  }
  // Límite del servidor (4000): en la práctica no se alcanza; si un mapa
  // enorme lo supera, mejor importar la mayoría que fallar entero
  return entries.slice(0, 4000);
}

// Parsea el JSON de un archivo UVTT. Devuelve dimensiones en casillas,
// densidad de píxeles, la imagen en base64 y las paredes ya ajustadas.
export function parseUvtt(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un UVTT válido (JSON ilegible)');
  }
  const res = data.resolution;
  const cols = Math.round(res?.map_size?.x);
  const rows = Math.round(res?.map_size?.y);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error('El archivo no es un UVTT válido (sin tamaño de mapa)');
  }
  if (typeof data.image !== 'string' || !data.image) {
    throw new Error('El archivo UVTT no incluye la imagen del mapa');
  }
  const origin = res.map_origin ?? { x: 0, y: 0 };

  const edges = new Set();
  const addPolyline = (points) => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = { x: points[i].x - origin.x, y: points[i].y - origin.y };
      const b = { x: points[i + 1].x - origin.x, y: points[i + 1].y - origin.y };
      for (const edge of segmentEdges(a, b)) edges.add(edge);
    }
  };
  for (const line of data.line_of_sight ?? []) addPolyline(line);
  for (const line of data.objects_line_of_sight ?? []) addPolyline(line);
  // Un portal cerrado bloquea como pared; uno abierto deja el hueco que los
  // muros ya le dejan. (Convertirlos en puertas de verdad queda pendiente.)
  let closedPortals = 0;
  for (const portal of data.portals ?? []) {
    if (portal.closed && Array.isArray(portal.bounds) && portal.bounds.length >= 2) {
      addPolyline(portal.bounds.map((p) => ({ x: p.x, y: p.y })));
      closedPortals += 1;
    }
  }

  return {
    cols,
    rows,
    pixelsPerGrid: Number(res.pixels_per_grid) || 70,
    imageBase64: data.image,
    wallEdges: wallEntriesFromEdges(edges, cols, rows),
    portals: (data.portals ?? []).length,
    closedPortals,
    lights: (data.lights ?? []).length,
  };
}

// --- Solo navegador: preparación de la imagen para subirla ---

function base64ToBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // El tipo real da igual para decodificarla; createImageBitmap lo detecta
  return new Blob([bytes], { type: 'image/png' });
}

// Decodifica la imagen del UVTT y la reencodifica a WebP, reescalada si hace
// falta para respetar el límite de subida (15 MB) y no pasar de ~100 px por
// casilla ni de 8192 px de lado (de sobra para el tablero).
export async function uvttImageBlob(parsed) {
  const bitmap = await createImageBitmap(base64ToBlob(parsed.imageBase64));
  const scale = Math.min(
    1,
    100 / parsed.pixelsPerGrid,
    8192 / bitmap.width,
    8192 / bitmap.height
  );
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen del UVTT'))),
      'image/webp',
      0.9
    );
  });
}
