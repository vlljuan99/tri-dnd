import { api } from '../api.js';

export async function uploadCharacterAvatar(characterId, file) {
  const res = await fetch(`/api/characters/${characterId}/avatar`, {
    method: 'PATCH',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo subir el icono');
  return data.character;
}

export async function generateCharacterAvatar(characterId, { prompt, provider }) {
  const data = await api(`/characters/${characterId}/avatar/generar`, {
    method: 'POST',
    body: { prompt, provider },
  });
  return data.character;
}

export async function removeCharacterAvatar(characterId) {
  const res = await fetch(`/api/characters/${characterId}/avatar`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo quitar el icono');
  return data.character;
}
