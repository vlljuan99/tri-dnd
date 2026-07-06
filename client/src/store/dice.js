import { create } from 'zustand';
import { DICE_TYPES, rollPool } from '../lib/dice.js';
import { useRoom } from './socket.js';

const emptyPool = () => Object.fromEntries(DICE_TYPES.map((d) => [d, 0]));

export const useDice = create((set, get) => ({
  open: false,
  pool: emptyPool(),
  modifier: 0,
  advantage: 'none', // 'none' | 'adv' | 'dis'
  hidden: false, // tirada oculta (solo tiene efecto si eres DM de la sala)
  lastRoll: null,
  rollId: 0, // cambia con cada tirada para reiniciar la animación
  history: [],

  toggleOpen() {
    set((s) => ({ open: !s.open }));
  },
  close() {
    set({ open: false });
  },

  incDie(die, delta) {
    set((s) => ({ pool: { ...s.pool, [die]: Math.max(0, Math.min(20, s.pool[die] + delta)) } }));
  },
  incModifier(delta) {
    set((s) => ({ modifier: Math.max(-30, Math.min(30, s.modifier + delta)) }));
  },
  setAdvantage(advantage) {
    set({ advantage });
  },
  setHidden(hidden) {
    set({ hidden });
  },
  clearPool() {
    set({ pool: emptyPool(), modifier: 0, advantage: 'none' });
  },

  /**
   * Registra una tirada ya calculada (del overlay o de un ataque de la ficha):
   * la guarda en el historial y la comparte en la sala si hay una activa.
   */
  submitRoll(roll, { hidden = false } = {}) {
    const shared = useRoom.getState().sendRoll(roll, { hidden });
    set((s) => ({
      lastRoll: { ...roll, shared },
      rollId: s.rollId + 1,
      history: [{ ...roll, shared, at: Date.now() }, ...s.history.slice(0, 29)],
    }));
    return shared;
  },

  roll() {
    const { pool, modifier, advantage, hidden } = get();
    const total = DICE_TYPES.reduce((n, d) => n + pool[d], 0);
    if (total === 0) return;
    const result = rollPool(pool, { modifier, advantage, kind: 'dice', label: 'Tirada' });
    get().submitRoll(result, { hidden });
  },
}));
