import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, '../data');
export const DB_PATH = path.join(DATA_DIR, 'tri-dnd.db');
export const PORT = Number(process.env.PORT) || 4000;

fs.mkdirSync(DATA_DIR, { recursive: true });

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
