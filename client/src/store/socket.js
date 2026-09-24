import { create } from 'zustand';
import { io } from 'socket.io-client';
import { toastInfo } from './toast.js';
import { conditionLabel } from '../features/tactical-map/domain/conditions.js';
import { useReveal } from './reveal.js';

// Conexión única de Socket.io por pestaña. Se une a la sala de una campaña
// (mesa de juego o ficha vinculada) y mantiene chat, presencia y estado en vivo.
let socket = null;

// Una mira por lanzador: si quien apunta se desconecta sin cerrar el panel, su
// entrada caducaría para siempre en el tablero de los demás, así que cada
// actualización reprograma su propia limpieza.
const AIM_TTL_MS = 45000;
const aimTimers = new Map();

// Fase 4b: lo que llega detrás de una tirada espera a que su dado caiga. Cada
// evento se ata a la última tirada aún sin revelar (ver store/reveal.js) y se
// suelta con su veredicto; sin tiradas pendientes, se aplica al instante. Si
// entretanto se cambia de sala, lo retenido de la anterior se descarta.
function afterDice(campaignId, fn) {
  useReveal.getState().retener(() => {
    if (useRoom.getState().campaignId === campaignId) fn();
  });
}

function clearAimTimers() {
  for (const timer of aimTimers.values()) clearTimeout(timer);
  aimTimers.clear();
}

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
  combat: { active: false, round: 1, turnId: null, enemyAiEnabled: false, combatants: [], opportunities: [] },
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
  combatVisuals: [],
  // Apuntado de conjuro de los DEMÁS lanzadores (el propio se pinta en local
  // sin pasar por el servidor) y destellos efímeros de los ya lanzados
  spellAims: [],
  spellFx: [],
  bestiaryVersion: 0,
  // Nivel concedido por el DM (Fase D). Se guarda el número y un contador,
  // para que quien esté en la mesa vea el aviso sin recargar.
  grantedLevel: null,
  grantedLevelVersion: 0,
  // Fase 4c: tiradas que esperan a que alguien pulse «Tirar». El jugador
  // recibe solo las suyas; el DM, todas (su panel de pendientes).
  pendingRolls: [],
  // Resultados recién llegados de esas tiradas (solo el DM ve total y éxito):
  // el panel los enseña unos segundos junto a las que aún faltan.
  pendingResults: [],
  // Una trampa acaba de saltar: la mesa se oscurece y suena el «¡clic!»
  trapAlert: null,

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
              pendingRolls: resp.pendingRolls ?? [],
              mapVersion: s.mapVersion + 1,
            }));
          }
        });
      }
    });
    socket.on('disconnect', () => set({ connected: false, online: [] }));
    socket.on('chat:new', (message) => {
      // Una tirada entra en la cola de revelado (rueda en esta pantalla una
      // sola vez) y su línea del registro espera al dado como todo lo demás.
      useReveal.getState().recibir(message);
      afterDice(get().campaignId, () => {
        set((s) => ({ messages: [...s.messages.slice(-199), message] }));
      });
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
    // El estado de combate (vida, turno, recursos) también espera: si no, la
    // barra de vida bajaba antes de que cayera el dado del daño.
    socket.on('combat:state', (combat) => afterDice(get().campaignId, () => set({ combat })));
    socket.on('combat:condition-expired', ({ name, condition }) => {
      afterDice(get().campaignId, () => toastInfo(`${name}: termina ${conditionLabel(condition)}.`));
    });
    socket.on('combat:visual', (visual) => {
      afterDice(get().campaignId, () => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const entry = { id, createdAt: Date.now(), ...visual };
        set((state) => ({ combatVisuals: [...state.combatVisuals.slice(-19), entry] }));
        setTimeout(() => {
          set((state) => ({ combatVisuals: state.combatVisuals.filter((item) => item.id !== id) }));
        }, 1800);
      });
    });
    // Alguien de la mesa está apuntando un conjuro: se guarda una sola mira
    // por lanzador y se sustituye con cada movimiento de la plantilla.
    socket.on('combate:apuntando', (aim) => {
      const casterId = Number(aim?.casterId);
      if (!Number.isInteger(casterId)) return;
      const previous = aimTimers.get(casterId);
      if (previous) clearTimeout(previous);
      aimTimers.delete(casterId);
      set((state) => {
        const rest = state.spellAims.filter((entry) => entry.casterId !== casterId);
        return { spellAims: aim.clear ? rest : [...rest, { ...aim, casterId }] };
      });
      if (aim.clear) return;
      aimTimers.set(
        casterId,
        setTimeout(() => {
          aimTimers.delete(casterId);
          set((state) => ({ spellAims: state.spellAims.filter((entry) => entry.casterId !== casterId) }));
        }, AIM_TTL_MS)
      );
    });
    socket.on('combate:efecto', (fx) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      set((state) => ({ spellFx: [...state.spellFx.slice(-5), { id, createdAt: Date.now(), ...fx }] }));
      setTimeout(() => {
        set((state) => ({ spellFx: state.spellFx.filter((entry) => entry.id !== id) }));
      }, 1700);
    });
    socket.on('bestiario:actualizado', () => set((state) => ({ bestiaryVersion: state.bestiaryVersion + 1 })));
    socket.on('campana:nivel', ({ grantedLevel }) =>
      set((state) => ({ grantedLevel, grantedLevelVersion: state.grantedLevelVersion + 1 }))
    );
    socket.on('combat:started', () => set((s) => ({ combatAlert: s.combatAlert + 1 })));
    // Tiradas pendientes (Fase 4c). El aviso no pasa por la cola de dados: es
    // una petición de gesto, no un resultado, y llega antes que cualquier dado.
    socket.on('tirada:pendiente', (pending) => {
      if (Number(pending?.campaignId) !== Number(get().campaignId)) return;
      set((s) => ({ pendingRolls: [...s.pendingRolls.filter((item) => item.id !== pending.id), pending] }));
    });
    socket.on('tirada:resuelta', (resolved) => {
      set((s) => ({
        pendingRolls: s.pendingRolls.filter((item) => item.id !== resolved.id),
        pendingResults:
          resolved.total != null
            ? [...s.pendingResults.filter((item) => item.id !== resolved.id), { ...resolved, at: Date.now() }].slice(-12)
            : s.pendingResults,
      }));
      if (resolved.total != null) {
        setTimeout(() => {
          set((s) => ({ pendingResults: s.pendingResults.filter((item) => item.id !== resolved.id) }));
        }, 9000);
      }
    });
    socket.on('trampa:activada', (trap) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set({ trapAlert: { id, ...trap } });
      setTimeout(() => {
        set((s) => ({ trapAlert: s.trapAlert?.id === id ? null : s.trapAlert }));
      }, 1600);
    });
    socket.on('mapa:actualizado', () =>
      afterDice(get().campaignId, () => set((s) => ({ mapVersion: s.mapVersion + 1 })))
    );
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
    clearAimTimers();
    set({
      campaignId, messages: [], online: [], joinError: null, removedCampaignId: null,
      worldTravel: null, spellAims: [], spellFx: [], pendingRolls: [], pendingResults: [], trapAlert: null,
    });
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
        combat: resp.combat ?? { active: false, round: 1, turnId: null, enemyAiEnabled: false, combatants: [], opportunities: [] },
        pendingRolls: resp.pendingRolls ?? [],
      });
    });
  },

  leaveRoom() {
    const { campaignId } = get();
    if (socket && campaignId) socket.emit('room:leave', { campaignId });
    clearAimTimers();
    set({
      campaignId: null,
      campaignName: '',
      role: null,
      isLive: false,
      messages: [],
      online: [],
      combat: { active: false, round: 1, turnId: null, enemyAiEnabled: false, combatants: [], opportunities: [] },
      worldTravel: null,
      spellAims: [],
      spellFx: [],
      pendingRolls: [],
      pendingResults: [],
      trapAlert: null,
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

  /**
   * Comparte con la mesa a dónde está apuntando un conjuro (casillas en
   * coordenadas ABSOLUTAS del editor). `null` retira la mira. Es información
   * puramente visual: el conjuro sigue resolviéndose entero en el servidor al
   * pulsar «Lanzar».
   */
  shareSpellAim(characterId, aim) {
    const { campaignId } = get();
    if (!socket || !campaignId || !characterId) return;
    socket.emit('combate:apuntar', aim
      ? { campaignId, characterId, ...aim }
      : { campaignId, characterId, clear: true });
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

  /** Activa o pausa los enemigos automáticos (DM o propietario de un escenario solitario). */
  setEnemyAi(enabled) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:set-enemy-ai', { campaignId, enabled: Boolean(enabled) }, resolve)
    );
  },

  /** Marca la reacción ('reaccion') o la acción adicional ('adicional') como gastada. */
  useResource(combatantId, resource) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:use-resource', { campaignId, combatantId, resource }, resolve)
    );
  },

  /**
   * Acción especial del turno: 'correr' | 'esquivar' | 'destrabarse' |
   * 'ayudar' (gasta la acción). Ayudar necesita a quién: `{ targetId }`.
   */
  specialAction(combatantId, kind, { targetId = null } = {}) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:special-action', { campaignId, combatantId, kind, targetId }, resolve)
    );
  },

  // --- Tiradas pendientes y pedidas (Fase 4c) ------------------------

  /** Pulsa «Tirar» en una tirada pendiente (la tuya, o cualquiera si eres DM). */
  resolvePendingRoll(id) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('tirada:resolver', { campaignId, id }, resolve));
  },

  /** El DM tira ya por todas las pendientes (o por las indicadas). */
  forcePendingRolls(ids = null) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('tirada:forzar', { campaignId, ids }, resolve));
  },

  /** El DM pide una tirada (prueba, habilidad o salvación) a unos PJ o a todos. */
  requestRoll(payload) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) => socket.emit('tirada:pedir', { campaignId, ...payload }, resolve));
  },

  /** Pone/quita una condición de combate a un combatiente (solo DM). */
  toggleCondition(combatantId, condition, options = {}) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:toggle-condition', { campaignId, combatantId, condition, ...options }, resolve)
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

  useBossAction(combatantId, type, actionId) {
    const { campaignId } = get();
    if (!socket || !campaignId) return Promise.resolve({ error: 'Sin conexión con la mesa' });
    return new Promise((resolve) =>
      socket.emit('combat:boss-action', { campaignId, combatantId, type, actionId }, resolve)
    );
  },
}));
