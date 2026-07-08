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
  combat: { active: false, round: 1, turnId: null, combatants: [] },
  // Contador que sube cuando el servidor avisa de que el mapa activo cambió;
  // quien muestre el mapa lo observa y vuelve a pedir /mapa-activo
  mapVersion: 0,
  // Pings efímeros sobre el tablero (se autodescartan a los pocos segundos)
  pings: [],

  ensureSocket() {
    if (socket) return socket;
    socket = io({ withCredentials: true });
    socket.on('connect', () => {
      set({ connected: true });
      // Tras una reconexión (p. ej. reinicio del servidor) hay que volver a
      // entrar en la sala: el servidor ya no recuerda a este socket
      const { campaignId } = get();
      if (campaignId) {
        socket.emit('room:join', { campaignId }, (resp) => {
          if (!resp?.error) {
            set((s) => ({
              role: resp.role,
              isLive: resp.isLive,
              campaignName: resp.campaignName,
              online: resp.members,
              combat: resp.combat ?? s.combat,
              mapVersion: s.mapVersion + 1,
            }));
          }
        });
      }
    });
    socket.on('disconnect', () => set({ connected: false, online: [] }));
    socket.on('chat:new', (message) => {
      set((s) => ({ messages: [...s.messages.slice(-199), message] }));
    });
    socket.on('room:members', (online) => set({ online }));
    socket.on('table:live', ({ isLive }) => set({ isLive }));
    socket.on('combat:state', (combat) => set({ combat }));
    socket.on('mapa:actualizado', () => set((s) => ({ mapVersion: s.mapVersion + 1 })));
    socket.on('mapa:ping', (ping) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = { id, createdAt: Date.now(), ...ping };
      set((s) => ({ pings: [...s.pings.slice(-11), entry] }));
      setTimeout(() => {
        set((s) => ({ pings: s.pings.filter((p) => p.id !== id) }));
      }, 4000);
    });
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
        combat: resp.combat ?? { active: false, round: 1, turnId: null, combatants: [] },
      });
    });
  },

  leaveRoom() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('room:leave', { campaignId });
    set({
      campaignId: null,
      campaignName: '',
      role: null,
      isLive: false,
      messages: [],
      online: [],
      combat: { active: false, round: 1, turnId: null, combatants: [] },
    });
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

  /** Lanza un ping en una casilla absoluta de la planta indicada. */
  sendPing({ floorId, x, y }) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('mapa:ping', { campaignId, floorId, x, y });
  },

  // --- Combate en el tablero ---------------------------------------

  /** Ataque de un personaje a un objetivo; el servidor decide el impacto. */
  attackTarget(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combate:atacar', { campaignId, ...payload }, resolve));
  },

  /** Daño de un personaje a un objetivo; el servidor lo aplica. */
  dealDamage(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combate:danio', { campaignId, ...payload }, resolve));
  },

  // --- Tracker de iniciativa ---------------------------------------

  addCombatant(payload) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:add', { campaignId, ...payload });
  },

  addParty() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:add-party', { campaignId });
  },

  setInitiative(combatantId, initiative) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:set-initiative', { campaignId, combatantId, initiative });
  },

  updateCombatant(combatantId, patch) {
    const { campaignId } = get();
    if (!socket || !campaignId) return;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    socket.emit('combat:update', { campaignId, combatantId, ...clean });
  },

  removeCombatant(combatantId) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:remove', { campaignId, combatantId });
  },

  startCombat() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:start', { campaignId });
  },

  nextTurn() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:next', { campaignId });
  },

  endCombat() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:end', { campaignId });
  },

  // --- Economía de turno (Fase 8.5) ---------------------------------

  /** Termina el turno del combatiente activo (su dueño, o siempre el DM). */
  endTurn() {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combat:end-turn', { campaignId }, resolve));
  },

  /** Alterna modo por turnos / modo libre (solo DM), sin vaciar el tracker. */
  toggleTurnMode() {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combat:toggle-mode', { campaignId }, resolve));
  },

  /** Marca la reacción ('reaccion') o la acción adicional ('adicional') como gastada. */
  useResource(combatantId, resource) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:use-resource', { campaignId, combatantId, resource }, resolve)
    );
  },
}));
