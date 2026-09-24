import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { SOUND_UPLOADS_DIR } from '../config.js';
import { isInstallationAdmin, resolveInstallationAdmin } from './admin.js';

// Sonidos personalizados de la mesa. El catálogo (qué sonidos existen, cómo se
// llaman y cómo se sintetizan) vive en el cliente, que es quien los reproduce;
// aquí solo se guarda cuál ha sustituido alguien por un fichero propio.
//
// La lista de claves está duplicada a propósito en vez de importar el catálogo
// del cliente: el servidor se empaqueta y despliega sin el código del cliente,
// así que importarlo lo rompería en producción. Para que las dos mitades no se
// separen en silencio hay una prueba que compara ambas listas.
export const SOUND_KEYS = [
  'dice.throw',
  'dice.bounce',
  'dice.land',
  'dice.crit',
  'dice.fumble',
  'attack.hit',
  'attack.crit',
  'attack.miss',
  'heal',
  'downed',
  'death',
  'turn.start',
  'combat.start',
  'door',
  'ui.click',
];

const SOUND_KEY_SET = new Set(SOUND_KEYS);

// Formatos que todos los navegadores de la mesa pueden descodificar sin
// sorpresas. El tamaño es corto a propósito: son efectos, no música.
const EXTENSIONS = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/aac': '.m4a',
};

export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

export function isSoundKey(key) {
  return SOUND_KEY_SET.has(key);
}

export function extensionForAudio(mimeType) {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[clean] ?? null;
}

// Los sonidos por defecto son de la instalación entera: los cambia su
// administrador (services/admin.js). Se conserva el nombre para las pruebas.
export const resolveSoundAdmin = resolveInstallationAdmin;

export function canEditSounds(user) {
  return isInstallationAdmin(user);
}

/**
 * Sonidos personalizados vigentes como `{ clave: url }`.
 *
 * `scope` está preparado para las dos capas: hoy solo se consulta la global.
 * Cuando cada mesa pueda tener los suyos, esta misma función devolverá la capa
 * de la campaña y el cliente la pondrá encima de la global (`mergeOverrides`).
 */
export function soundOverrides({ scope = 'global', scopeId = null } = {}) {
  const rows = db
    .prepare(
      `SELECT event_key, file_path, original_name, updated_at
         FROM sound_overrides
        WHERE scope = ? AND IFNULL(scope_id, 0) = IFNULL(?, 0)`
    )
    .all(scope, scopeId);
  return rows.filter((row) => isSoundKey(row.event_key));
}

/** Catálogo servido al cliente: una entrada por sonido, con su url si la tiene. */
export function serializeSounds({ scope = 'global', scopeId = null } = {}) {
  const overrides = new Map(soundOverrides({ scope, scopeId }).map((row) => [row.event_key, row]));
  return SOUND_KEYS.map((key) => {
    const row = overrides.get(key);
    return {
      key,
      url: row?.file_path ?? null,
      custom: Boolean(row),
      originalName: row?.original_name ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

/**
 * Guarda un sonido subido y sustituye al anterior de esa clave, borrando su
 * fichero para no dejar basura acumulada en el disco.
 */
export function saveSound({ key, buffer, mimeType, originalName, userId, scope = 'global', scopeId = null }) {
  if (!isSoundKey(key)) return { error: 'Ese sonido no existe en el catálogo' };
  const extension = extensionForAudio(mimeType);
  if (!extension) return { error: 'El archivo debe ser un audio (mp3, ogg, wav, webm o m4a)' };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { error: 'No se recibió ningún audio' };
  if (buffer.length > MAX_SOUND_BYTES) {
    return { error: `El audio no puede pasar de ${Math.round(MAX_SOUND_BYTES / 1024 / 1024)} MB` };
  }

  const previous = db
    .prepare(
      `SELECT file_path FROM sound_overrides
        WHERE scope = ? AND IFNULL(scope_id, 0) = IFNULL(?, 0) AND event_key = ?`
    )
    .get(scope, scopeId, key);

  // El nombre lleva la clave y una marca de tiempo: al cambiar el fichero
  // cambia la url, así que ningún navegador se queda con el sonido viejo en
  // caché.
  const filename = `${key.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(SOUND_UPLOADS_DIR, filename), buffer);
  const url = `/uploads/sounds/${filename}`;

  db.prepare(
    `INSERT INTO sound_overrides (scope, scope_id, event_key, file_path, original_name, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, IFNULL(scope_id, 0), event_key)
     DO UPDATE SET file_path = excluded.file_path,
                   original_name = excluded.original_name,
                   updated_by = excluded.updated_by,
                   updated_at = datetime('now')`
  ).run(scope, scopeId, key, url, originalName ?? null, userId ?? null);

  if (previous?.file_path) removeSoundFile(previous.file_path);
  return { ok: true, url };
}

/** Devuelve un sonido a su versión sintetizada. */
export function clearSound({ key, scope = 'global', scopeId = null }) {
  if (!isSoundKey(key)) return { error: 'Ese sonido no existe en el catálogo' };
  const row = db
    .prepare(
      `SELECT file_path FROM sound_overrides
        WHERE scope = ? AND IFNULL(scope_id, 0) = IFNULL(?, 0) AND event_key = ?`
    )
    .get(scope, scopeId, key);
  db.prepare(
    `DELETE FROM sound_overrides
      WHERE scope = ? AND IFNULL(scope_id, 0) = IFNULL(?, 0) AND event_key = ?`
  ).run(scope, scopeId, key);
  if (row?.file_path) removeSoundFile(row.file_path);
  return { ok: true };
}

function removeSoundFile(url) {
  // Solo se borran ficheros de la carpeta de sonidos, y nunca se sale de ella:
  // la url viene de la base de datos, pero el borrado se acota igualmente.
  const name = path.basename(String(url));
  const absolute = path.join(SOUND_UPLOADS_DIR, name);
  if (!absolute.startsWith(SOUND_UPLOADS_DIR)) return;
  try {
    fs.rmSync(absolute, { force: true });
  } catch {
    // Que no se pueda borrar el anterior no debe impedir guardar el nuevo.
  }
}
