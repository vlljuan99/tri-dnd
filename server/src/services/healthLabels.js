// Estado de salud de un enemigo con palabras (Fase 4d). No es una regla del
// SRD ni la usa ninguna regla: es cómo la mesa narra «le has hecho daño».
// Los umbrales viven aquí, en un solo sitio, para que el tracker, el texto
// flotante del daño y la tira de iniciativa digan lo mismo.

export const HEALTH_LABELS = ['ileso', 'herido', 'malherido', 'a punto de caer', 'caído'];

/**
 * - ileso: PG al máximo
 * - herido: por encima de la mitad
 * - malherido: la mitad o menos
 * - a punto de caer: un cuarto o menos
 * - caído: 0 PG
 * null si no hay PG que leer (un marcador sin tracker).
 */
export function healthLabel(current, max) {
  if (current == null || max == null) return null;
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(max)) || Number(max) <= 0) return null;
  const hp = Number(current);
  if (hp <= 0) return 'caído';
  if (hp >= Number(max)) return 'ileso';
  const ratio = hp / Number(max);
  if (ratio <= 0.25) return 'a punto de caer';
  if (ratio <= 0.5) return 'malherido';
  return 'herido';
}
