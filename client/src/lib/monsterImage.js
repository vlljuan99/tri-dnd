import { api } from '../api.js';

// Imagen personalizada por monstruo del compendio (bestiario del DM).
// Mismo trío que characterAvatar.js: subir binario crudo, generar con IA
// (OpenAI/Google) o quitar la personalización y volver al marcador genérico.

export async function uploadMonsterImage(monsterIndex, file) {
  const res = await fetch(`/api/srd/monsters/${monsterIndex}/imagen`, {
    method: 'PATCH',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
  return data.imageUrl;
}

export async function generateMonsterImage(monsterIndex, { prompt, provider }) {
  const data = await api(`/srd/monsters/${monsterIndex}/imagen/generar`, {
    method: 'POST',
    body: { prompt, provider },
  });
  return data.imageUrl;
}

export async function removeMonsterImage(monsterIndex) {
  const data = await api(`/srd/monsters/${monsterIndex}/imagen`, { method: 'DELETE' });
  return data.imageUrl;
}
