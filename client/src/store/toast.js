import { create } from 'zustand';

// Avisos flotantes de la mesa. Existen para sustituir a window.alert, que
// bloqueaba el hilo y rompía la estética en mitad de un combate: «No es tu
// turno» no merece un modal del navegador que hay que cerrar a mano.
//
// Se descartan solos. Los errores duran más que los avisos normales porque
// suelen explicar por qué algo NO ha pasado, y eso hay que leerlo.

const DURATION = { error: 5000, info: 3000 };

let nextId = 1;

export const useToasts = create((set, get) => ({
  toasts: [],

  /** Muestra un aviso. `tone`: 'error' | 'info'. Devuelve su id. */
  push(message, { tone = 'info' } = {}) {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return null;

    // Un mismo error repetido (aporrear "mover" sin movimiento) renueva el
    // aviso que ya está en pantalla en vez de apilar copias idénticas.
    const existing = get().toasts.find((t) => t.message === text && t.tone === tone);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => get().dismiss(existing.id), DURATION[tone]);
      return existing.id;
    }

    const id = nextId++;
    const timer = setTimeout(() => get().dismiss(id), DURATION[tone]);
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message: text, tone, timer }] }));
    return id;
  },

  dismiss(id) {
    set((s) => {
      const found = s.toasts.find((t) => t.id === id);
      if (found) clearTimeout(found.timer);
      return { toasts: s.toasts.filter((t) => t.id !== id) };
    });
  },
}));

/** Atajo para el caso más común: enseñar el error de una respuesta del socket. */
export function toastError(message) {
  useToasts.getState().push(message, { tone: 'error' });
}

export function toastInfo(message) {
  useToasts.getState().push(message, { tone: 'info' });
}
