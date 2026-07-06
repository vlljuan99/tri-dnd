import { create } from 'zustand';
import { api } from '../api.js';

export const useAuth = create((set) => ({
  user: null,
  loading: true,

  async loadSession() {
    try {
      const { user } = await api('/auth/me');
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  async login(username, password) {
    const { user } = await api('/auth/login', { method: 'POST', body: { username, password } });
    set({ user });
  },

  async register(username, displayName, password) {
    const { user } = await api('/auth/register', {
      method: 'POST',
      body: { username, displayName, password },
    });
    set({ user });
  },

  async logout() {
    await api('/auth/logout', { method: 'POST' });
    set({ user: null });
  },
}));
