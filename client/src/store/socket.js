import { create } from 'zustand';
import { io } from 'socket.io-client';

// Conexión única de Socket.io por pestaña. Se une a la sala de una campaña
// (mesa de juego o ficha vinculada) y mantiene chat, presencia y estado en vivo.
let socket = null;

export const useRoom = create((set, get) => ({
  connected: false,
  campaignId: null,
  campaignName: '',
  role: null, // 'dm' | 'jugador'
  isLive: false,
  messages: [],
  online: [],
  joinError: null,

  ensureSocket() {
    if (socket) return socket;
    socket = io({ withCredentials: true });
    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false, online: [] }));
    socket.on('chat:new', (message) => {
      set((s) => ({ messages: [...s.messages.slice(-199), message] }));
    });
    socket.on('room:members', (online) => set({ online }));
    socket.on('table:live', ({ isLive }) => set({ isLive }));
    return socket;
  },

  joinRoom(campaignId) {
    const s = get().ensureSocket();
    if (get().campaignId === campaignId) return;
    if (get().campaignId) s.emit('room:leave', { campaignId: get().campaignId });
    set({ campaignId, messages: [], online: [], joinError: null });
    s.emit('room:join', { campaignId }, (resp) => {
      if (resp?.error) {
        set({ joinError: resp.error, campaignId: null });
        return;
      }
      set({
        role: resp.role,
        isLive: resp.isLive,
        campaignName: resp.campaignName,
        messages: resp.messages,
        online: resp.members,
      });
    });
  },

  leaveRoom() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('room:leave', { campaignId });
    set({ campaignId: null, campaignName: '', role: null, isLive: false, messages: [], online: [] });
  },

  sendChat(text) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('chat:send', { campaignId, text });
  },

  /** Comparte una tirada en la sala actual. Devuelve true si se envió. */
  sendRoll(roll, { hidden = false } = {}) {
    const { campaignId } = get();
    if (!socket || !campaignId) return false;
    socket.emit('roll:send', { campaignId, roll, hidden });
    return true;
  },

  setLive(isLive) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('table:set-live', { campaignId, isLive });
  },
}));
