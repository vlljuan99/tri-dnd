import { api } from '../../api.js';

// Acceso a los sonidos de la instalación. Sigue el patrón del resto de subidas
// de la app: binario crudo con su content-type, no multipart.

export async function fetchSounds() {
  return api('/sonidos');
}

export async function uploadSound(key, file) {
  const res = await fetch(`/api/sonidos/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      // El nombre original solo se guarda para poder enseñarlo en la lista.
      'X-Nombre-Original': encodeURIComponent(file.name || ''),
    },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo subir el sonido');
  return data;
}

export async function resetSound(key) {
  const res = await fetch(`/api/sonidos/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo restaurar el sonido');
  return data;
}
