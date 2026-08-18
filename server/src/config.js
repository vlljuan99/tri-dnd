import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Variables de entorno locales (claves de IA, etc.), no versionadas
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// Las pruebas de integración arrancan el servidor real contra una carpeta
// temporal para no tocar nunca la base local del desarrollador. En producción
// se mantiene la ruta histórica dentro del volumen persistente.
export const DATA_DIR = process.env.TRIDND_DATA_DIR
  ? path.resolve(process.env.TRIDND_DATA_DIR)
  : path.resolve(__dirname, '../data');
export const DB_PATH = path.join(DATA_DIR, 'tri-dnd.db');
export const UPLOADS_ROOT = path.join(DATA_DIR, 'uploads');
export const MAP_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'maps');
export const AVATAR_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'avatars');
// Sonidos subidos para sustituir a los sintetizados. No son secretos: se
// sirven como estáticos igual que los avatares.
export const SOUND_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'sounds');
// El archivo narrativo del DM es privado: sus imágenes nunca se sirven desde
// /uploads, que es una ruta estática pública. Solo las entrega la API tras
// comprobar que quien las pide es el DM de la campaña.
export const NARRATIVE_MEDIA_DIR = path.join(DATA_DIR, 'narrative-media');
// Cada cambio del archivo narrativo deja una instantánea JSON recuperable.
// Se mantiene fuera de /uploads: además de ser un respaldo local, puede
// contener notas privadas del DM que nunca deben servirse como estáticas.
export const NARRATIVE_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'narrativa');
// Quién puede cambiar los sonidos por defecto de TODA la instalación. Es la
// única capacidad "de administrador" que existe en TriDnD, así que no se monta
// un sistema de roles para ella: se listan nombres de usuario separados por
// comas en `TRIDND_ADMIN_USERS`.
//
// Sin la variable, manda el usuario fundador (el de id más bajo, que es quien
// levantó la instalación). Así funciona en local sin configurar nada y en el
// VPS sin dejar la puerta abierta a los amigos que se registren después.
export const ADMIN_USERNAMES = (process.env.TRIDND_ADMIN_USERS || '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

export const PORT = Number(process.env.PORT) || 4000;
export const APP_VERSION = process.env.APP_VERSION || '0.1.0-dev';
export const GIT_SHA = process.env.GIT_SHA || 'desconocido';
export const BUILD_TIME = process.env.BUILD_TIME || null;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MAP_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(AVATAR_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SOUND_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(NARRATIVE_MEDIA_DIR, { recursive: true });
fs.mkdirSync(NARRATIVE_BACKUP_DIR, { recursive: true });

// Secreto JWT: variable de entorno o uno generado y persistido en local
const secretFile = path.join(DATA_DIR, 'jwt-secret.txt');
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf-8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret);
  return secret;
}

export const JWT_SECRET = loadJwtSecret();
export const COOKIE_NAME = 'tri_dnd_token';
