import { db } from '../db.js';
import { ADMIN_USERNAMES } from '../config.js';

// Administrador de la instalación: quien cambia lo que es de TODA la
// instalación y no de una mesa (los sonidos por defecto, las imágenes de las
// figuras de los escenarios de fábrica). No hay sistema de roles: se listan
// nombres de usuario en `TRIDND_ADMIN_USERS` y, sin la variable, manda el
// usuario fundador (ver config.js).

/**
 * ¿Es este usuario administrador de la instalación?
 *
 * Función pura para poder probarla: recibe la lista configurada, el usuario y
 * quién es el fundador. Si hay lista configurada, manda ella y el fundador no
 * tiene ningún privilegio implícito; si no la hay, manda el fundador.
 */
export function resolveInstallationAdmin({ configured = [], username = '', founderId = null, userId = null }) {
  if (configured.length > 0) {
    return configured.includes(String(username).trim().toLowerCase());
  }
  return founderId != null && Number(userId) === Number(founderId);
}

function founderId() {
  return db.prepare('SELECT MIN(id) AS id FROM users').get()?.id ?? null;
}

export function isInstallationAdmin(user) {
  if (!user) return false;
  return resolveInstallationAdmin({
    configured: ADMIN_USERNAMES,
    username: user.username,
    userId: user.id,
    founderId: founderId(),
  });
}
