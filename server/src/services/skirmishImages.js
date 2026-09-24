import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { SKIRMISH_UPLOADS_DIR } from '../config.js';
import { FIGURE_IMAGE_KINDS, listSkirmishFigures, skirmishFigureKey } from './skirmishPresets.js';

// Imágenes de las figuras (enemigos y objetos) de los escenarios de fábrica.
// Son de la instalación entera, como los sonidos por defecto: las pone su
// administrador y las ve cualquiera que juegue ese escenario, también en las
// partidas que ya estaban montadas antes de subirlas.
//
// Solo son aspecto: el marcador se juega igual con imagen o sin ella, y sin
// imagen el tablero sigue pintando el disco de color de siempre.

// Formatos que el tablero 3D carga como textura en cualquier navegador. SVG
// queda fuera a propósito: se sirve como estático y podría llevar scripts.
const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

export const MAX_FIGURE_IMAGE_BYTES = 8 * 1024 * 1024;

export function extensionForFigureImage(mimeType) {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[clean] ?? null;
}

function figureRows(presetId) {
  return db
    .prepare('SELECT figure_key, image_path, original_name, updated_at FROM skirmish_figure_images WHERE preset_id = ?')
    .all(presetId);
}

/** Figuras del escenario con su imagen, para el panel del administrador. */
export function serializeSkirmishFigures(presetId) {
  const figures = listSkirmishFigures(presetId);
  if (!figures) return null;
  const images = new Map(figureRows(presetId).map((row) => [row.figure_key, row]));
  return figures.map((figure) => {
    const row = images.get(figure.key);
    return {
      ...figure,
      imageUrl: row?.image_path ?? null,
      originalName: row?.original_name ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

/**
 * Añade `figure_avatar_path` a las filas de `map_tokens` de un mapa montado
 * desde un escenario de fábrica. Sin escenario (cualquier otro mapa) no toca
 * nada. Devuelve las mismas filas.
 */
export function applySkirmishFigureImages(presetId, tokens) {
  if (!presetId || !tokens.length) return tokens;
  const images = new Map(figureRows(presetId).map((row) => [row.figure_key, row.image_path]));
  if (!images.size) return tokens;
  for (const token of tokens) {
    if (!FIGURE_IMAGE_KINDS.includes(token.kind)) continue;
    const url = images.get(skirmishFigureKey(token.kind, token.true_name ?? token.name));
    if (url) token.figure_avatar_path = url;
  }
  return tokens;
}

/** Campañas con un mapa montado desde este escenario (para repintarlas). */
export function campaignsUsingPreset(presetId) {
  return db
    .prepare('SELECT DISTINCT campaign_id FROM maps WHERE skirmish_preset_id = ?')
    .all(presetId)
    .map((row) => row.campaign_id);
}

function findFigure(presetId, figureKey) {
  const figures = listSkirmishFigures(presetId);
  if (!figures) return { error: 'Ese escenario predefinido no existe', status: 404 };
  const figure = figures.find((entry) => entry.key === figureKey);
  if (!figure) return { error: 'Esa figura no está en el escenario', status: 404 };
  return { figure };
}

/**
 * Guarda la imagen de una figura y sustituye a la anterior, borrando su
 * fichero para no dejar basura en el disco.
 */
export function saveSkirmishFigureImage({ presetId, figureKey, buffer, mimeType, originalName, userId }) {
  const found = findFigure(presetId, figureKey);
  if (found.error) return found;
  const extension = extensionForFigureImage(mimeType);
  if (!extension) return { error: 'La imagen debe ser PNG, JPG o WebP', status: 400 };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { error: 'No se recibió ninguna imagen', status: 400 };
  if (buffer.length > MAX_FIGURE_IMAGE_BYTES) {
    return { error: `La imagen no puede pasar de ${Math.round(MAX_FIGURE_IMAGE_BYTES / 1024 / 1024)} MB`, status: 400 };
  }

  const previous = db
    .prepare('SELECT image_path FROM skirmish_figure_images WHERE preset_id = ? AND figure_key = ?')
    .get(presetId, figureKey);

  // La marca de tiempo cambia la url con cada subida: ningún navegador se
  // queda con la imagen vieja en caché.
  const filename = `${presetId}-${figureKey}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(SKIRMISH_UPLOADS_DIR, filename), buffer);
  const url = `/uploads/skirmishes/${filename}`;

  db.prepare(
    `INSERT INTO skirmish_figure_images (preset_id, figure_key, image_path, original_name, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (preset_id, figure_key)
     DO UPDATE SET image_path = excluded.image_path,
                   original_name = excluded.original_name,
                   updated_by = excluded.updated_by,
                   updated_at = datetime('now')`
  ).run(presetId, figureKey, url, originalName ?? null, userId ?? null);

  if (previous?.image_path) removeFigureFile(previous.image_path);
  return { ok: true, url };
}

/** Quita la imagen de una figura: vuelve al disco de color. */
export function clearSkirmishFigureImage({ presetId, figureKey }) {
  const found = findFigure(presetId, figureKey);
  if (found.error) return found;
  const row = db
    .prepare('SELECT image_path FROM skirmish_figure_images WHERE preset_id = ? AND figure_key = ?')
    .get(presetId, figureKey);
  db.prepare('DELETE FROM skirmish_figure_images WHERE preset_id = ? AND figure_key = ?').run(presetId, figureKey);
  if (row?.image_path) removeFigureFile(row.image_path);
  return { ok: true };
}

function removeFigureFile(url) {
  // Solo se borran ficheros de la carpeta de escenarios, y nunca se sale de
  // ella: la url viene de la base de datos, pero el borrado se acota igual.
  const absolute = path.join(SKIRMISH_UPLOADS_DIR, path.basename(String(url)));
  if (!absolute.startsWith(SKIRMISH_UPLOADS_DIR)) return;
  try {
    fs.rmSync(absolute, { force: true });
  } catch {
    // Que no se pueda borrar la anterior no debe impedir guardar la nueva.
  }
}
