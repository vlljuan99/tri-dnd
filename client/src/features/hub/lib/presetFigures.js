import { api } from '../../../api.js';

// Imágenes de las figuras (enemigos, objetos y trampas) de los escenarios de
// fábrica.
// Solo las cambia el administrador de la instalación; la subida sigue el
// patrón del resto de la app: binario crudo con su content-type, no multipart.

const BASE = '/campaigns/escaramuzas/predefinidas';

// Mismos formatos que acepta el servidor (services/skirmishImages.js)
export const FIGURE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

// Orden y rótulos de los grupos del panel
export const FIGURE_GROUPS = [
  { kind: 'enemigo', label: 'Enemigos' },
  { kind: 'objeto', label: 'Objetos' },
  { kind: 'trampa', label: 'Trampas' },
];

/** Reparte las figuras por tipo, en el orden de `FIGURE_GROUPS` y sin grupos vacíos. */
export function groupFigures(figures) {
  return FIGURE_GROUPS.map((group) => ({
    ...group,
    figures: (figures ?? []).filter((figure) => figure.kind === group.kind),
  })).filter((group) => group.figures.length > 0);
}

function figureImageUrl(presetId, figureKey) {
  return `/api${BASE}/${encodeURIComponent(presetId)}/figuras/${encodeURIComponent(figureKey)}/imagen`;
}

export async function fetchPresetFigures(presetId) {
  const data = await api(`${BASE}/${encodeURIComponent(presetId)}/figuras`);
  return data.figuras ?? [];
}

async function send(url, init, fallback) {
  const res = await fetch(url, { ...init, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (res.status === 413 ? 'La imagen es demasiado grande' : fallback));
  return data.figuras ?? [];
}

export function uploadPresetFigureImage(presetId, figureKey, file) {
  return send(
    figureImageUrl(presetId, figureKey),
    {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        // El nombre original solo se guarda para poder enseñarlo en el panel
        'X-Nombre-Original': encodeURIComponent(file.name || ''),
      },
      body: file,
    },
    'No se pudo subir la imagen'
  );
}

export function removePresetFigureImage(presetId, figureKey) {
  return send(figureImageUrl(presetId, figureKey), { method: 'DELETE' }, 'No se pudo quitar la imagen');
}
