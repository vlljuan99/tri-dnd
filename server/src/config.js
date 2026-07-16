import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Variables de entorno locales (claves de IA, etc.), no versionadas
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const DATA_DIR = path.resolve(__dirname, '../data');
export const DB_PATH = path.join(DATA_DIR, 'tri-dnd.db');
export const UPLOADS_ROOT = path.join(DATA_DIR, 'uploads');
export const MAP_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'maps');
export const AVATAR_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'avatars');
// El archivo narrativo del DM es privado: sus imágenes nunca se sirven desde
// /uploads, que es una ruta estática pública. Solo las entrega la API tras
// comprobar que quien las pide es el DM de la campaña.
export const NARRATIVE_MEDIA_DIR = path.join(DATA_DIR, 'narrative-media');
export const PORT = Number(process.env.PORT) || 4000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MAP_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(AVATAR_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(NARRATIVE_MEDIA_DIR, { recursive: true });

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
