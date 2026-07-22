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
  removedCampaignId: null,
  combat: { active: false, round: 1, turnId: null, combatants: [], opportunities: [] },
  // Sube cada vez que el servidor avisa de que ACABA de empezar el combate
  // (arranque manual del DM o automático al descubrir enemigos): la mesa lo
  // observa para mostrar el cartel de aviso a pantalla unos segundos.
  combatAlert: 0,
  // Contador que sube cuando el servidor avisa de que el mapa activo cambió;
  // quien muestre el mapa lo observa y vuelve a pedir /mapa-activo
  mapVersion: 0,
  // Igual, pero para el mapa de mundo (viajar, editar ubicaciones): la mesa
  // repide /mundo y, si cambió la ubicación actual, muestra el lore de destino
  worldVersion: 0,
  // Pings efímeros sobre el tablero (se autodescartan a los pocos segundos)
  pings: [],
  // Pings efímeros sobre el mapa de mundo (la voz del jugador en la exploración)
  worldPings: [],
  // Trayecto efímero emitido por el servidor antes de confirmar el viaje.
  worldTravel: null,

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
    socket.on('campaign:removed', ({ campaignId }) => {
      if (Number(campaignId) !== Number(get().campaignId)) return;
      set({
        campaignId: null,
        campaignName: '',
        role: null,
        isLive: false,
        messages: [],
        online: [],
        joinError: 'El DM te ha retirado de esta campaña.',
        removedCampaignId: Number(campaignId),
      });
    });
    socket.on('table:live', ({ isLive }) => set({ isLive }));
    socket.on('combat:state', (combat) => set({ combat }));
    socket.on('combat:started', () => set((s) => ({ combatAlert: s.combatAlert + 1 })));
    socket.on('mapa:actualizado', () => set((s) => ({ mapVersion: s.mapVersion + 1 })));
    socket.on('mundo:actualizado', () => set((s) => ({ worldVersion: s.worldVersion + 1 })));
    socket.on('mapa:ping', (ping) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = { id, createdAt: Date.now(), ...ping };
      set((s) => ({ pings: [...s.pings.slice(-11), entry] }));
      setTimeout(() => {
        set((s) => ({ pings: s.pings.filter((p) => p.id !== id) }));
      }, 4000);
    });
    socket.on('mundo:ping', (ping) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = { id, createdAt: Date.now(), ...ping };
      set((s) => ({ worldPings: [...s.worldPings.slice(-11), entry] }));
      setTimeout(() => {
        set((s) => ({ worldPings: s.worldPings.filter((p) => p.id !== id) }));
      }, 4000);
    });
    socket.on('mundo:viaje', (travel) => {
      set({ worldTravel: travel });
      setTimeout(() => {
        set((state) => ({ worldTravel: state.worldTravel?.id === travel.id ? null : state.worldTravel }));
      }, Math.max(400, Number(travel.durationMs) || 900) + 250);
    });
    return socket;
  },

  joinRoom(campaignId) {
    const s = get().ensureSocket();
    if (get().campaignId === campaignId) return;
    if (get().campaignId) s.emit('room:leave', { campaignId: get().campaignId });
    set({ campaignId, messages: [], online: [], joinError: null, removedCampaignId: null, worldTravel: null });
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
        combat: resp.combat ?? { active: false, round: 1, turnId: null, combatants: [], opportunities: [] },
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
      combat: { active: false, round: 1, turnId: null, combatants: [], opportunities: [] },
      worldTravel: null,
    });
  },

  sendChat(text, references = []) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('chat:send', { campaignId, text, references }, resolve));
  },

  /** Comparte una entrada SRD en una mesa en vivo sin cambiar la sala actual. */
  shareCompendiumReference(campaignId, entry) {
    const activeSocket = get().ensureSocket();
    if (!activeSocket || !campaignId) return Promise.resolve({ error: 'No hay una mesa en vivo' });
    return new Promise((resolve) => activeSocket.emit('srd:share', {
      campaignId,
      category: entry?.category,
      index: entry?.index,
    }, resolve));
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

  /**
   * Señala un punto del mapa de mundo (x/y en % sobre la imagen de la capa).
   * `locationId` opcional: el servidor le pone nombre al ping si es un pin
   * visible. Es la agencia del jugador en la exploración; el DM sigue viajando.
   */
  sendWorldPing({ worldMapId, x, y, locationId = null }) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('mundo:ping', { campaignId, worldMapId, x, y, locationId });
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

  /** Ataque de un enemigo/aliado controlado por el DM a un objetivo. */
  attackMarker(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combate:atacar-marcador', { campaignId, ...payload }, resolve));
  },

  /** Daño de un enemigo/aliado controlado por el DM a un objetivo. */
  dealDamageMarker(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combate:danio-marcador', { campaignId, ...payload }, resolve));
  },

  /** El DM aplica daño de caída ambiental a una criatura del tablero. */
  makeFall(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combate:hacer-caer', { campaignId, ...payload }, resolve));
  },

  /** Busca trampas con la percepción del personaje; toda la resolución es de servidor. */
  searchTraps(characterId) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('percepcion:buscar', { campaignId, characterId }, resolve));
  },

  /** Usa un objeto del inventario en tu turno; gasta la acción, como atacar. */
  useItem(characterId, itemId) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('objeto:usar', { campaignId, characterId, itemId }, resolve));
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

  /**
   * Pide al SERVIDOR que tire la iniciativa de un combatiente (1d20 + DES) y
   * la narre. Antes tiraba el cliente por su cuenta, lo que dejaba dos motores
   * de tirada distintos para lo mismo y una tirada que nadie podía auditar.
   */
  rollInitiative(combatantId) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combat:roll-initiative', { campaignId, combatantId }, resolve));
  },

  /** Cuántos combatientes ya tienen iniciativa propia (para el diálogo del DM). */
  initiativeSummary() {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combat:initiative-summary', { campaignId }, resolve));
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

  /** Abre el combate. `rerollAll` false respeta las iniciativas ya tiradas. */
  startCombat({ rerollAll = true } = {}) {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:start', { campaignId, rerollAll });
  },

  nextTurn() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:next', { campaignId });
  },

  endCombat() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('combat:end', { campaignId });
  },

  /** Acepta o deja pasar una reacción provocada por un movimiento. */
  resolveOpportunity(opportunityId, attackId = null, accept = true) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit(
        'combat:opportunity',
        { campaignId, opportunityId, attackId, accept },
        resolve
      )
    );
  },

  /** Lanza un conjuro contra una criatura o una plantilla elegida en el mapa. */
  castBoardSpell(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combate:lanzar-conjuro', { campaignId, ...payload }, resolve)
    );
  },

  // --- Economía de turno (Fase 8.5) ---------------------------------

  /** Termina el turno del combatiente activo (su dueño, o siempre el DM). */
  endTurn() {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combat:end-turn', { campaignId }, resolve));
  },

  /**
   * Alterna modo por turnos / modo libre (solo DM), sin vaciar el tracker.
   * `rerollAll` solo se mira al encender: true tira iniciativa por todos,
   * false respeta a quien ya tenga la suya. Al apagar se ignora.
   */
  toggleTurnMode({ rerollAll = true } = {}) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('combat:toggle-mode', { campaignId, rerollAll }, resolve));
  },

  /** Marca la reacción ('reaccion') o la acción adicional ('adicional') como gastada. */
  useResource(combatantId, resource) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:use-resource', { campaignId, combatantId, resource }, resolve)
    );
  },

  /** Acción especial del turno: 'correr' | 'esquivar' | 'destrabarse' (gasta la acción). */
  specialAction(combatantId, kind) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:special-action', { campaignId, combatantId, kind }, resolve)
    );
  },

  /** Pone/quita una condición de combate a un combatiente (solo DM). */
  toggleCondition(combatantId, condition) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:toggle-condition', { campaignId, combatantId, condition }, resolve)
    );
  },

  /**
   * Marca (spell) o levanta (null) la concentración de un combatiente. Lo
   * puede hacer el DM o el dueño del PJ: quien lanza sabe lo que ha lanzado.
   */
  setConcentration(combatantId, spell) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:set-concentration', { campaignId, combatantId, spell }, resolve)
    );
  },

  /** Salvación de concentración contra una CD; la tira y resuelve el servidor. */
  concentrationSave(combatantId, dc) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:concentration-save', { campaignId, combatantId, dc }, resolve)
    );
  },

  /** Tira una salvación de muerte para un PJ agonizante (dueño o DM). */
  deathSave(combatantId, roll, d20) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:death-save', { campaignId, combatantId, roll, d20 }, resolve)
    );
  },
}));
