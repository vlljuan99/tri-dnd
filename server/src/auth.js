import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { JWT_SECRET, COOKIE_NAME } from './config.js';

const USERNAME_RE = /^[a-z0-9_-]{3,20}$/i;

function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

function setSessionCookie(res, user) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

/** Middleware: exige sesión válida y deja el usuario en req.user */
export function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!row) return res.status(401).json({ error: 'Sesión no válida' });
    req.user = publicUser(row);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión caducada' });
  }
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { username, displayName, password } = req.body ?? {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'El nombre de usuario debe tener 3-20 caracteres (letras, números, guiones)' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const name = (typeof displayName === 'string' && displayName.trim()) || username;

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });

  const hash = await bcrypt.hash(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
    .run(username, name.slice(0, 40), hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  setSessionCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const row =
    typeof username === 'string'
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      : undefined;
  const ok = row && typeof password === 'string' && (await bcrypt.compare(password, row.password_hash));
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  setSessionCookie(res, row);
  res.json({ user: publicUser(row) });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
