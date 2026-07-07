import { api } from '../api.js';
import { ABILITIES, spellAttackBonus, spellSaveDC, cantripDamageAtLevel } from './dnd.js';
import { rollAttack, rollDamage } from './dice.js';

/**
 * Calcula la tirada de un hechizo conocido: ataque de conjuro o daño (leyendo
 * la notación de dados del compendio SRD). Devuelve null si no hay tirada
 * aplicable (hechizo de salvación sin daño, o sin conexión al compendio).
 * Compartida por la ficha completa y la vista rápida.
 */
export async function castSpellRoll(char, spell, mode) {
  const dcText = spell.dc
    ? ` (CD ${spellSaveDC(char)} ${ABILITIES.find((a) => a.key === spell.dc)?.short ?? ''})`
    : '';

  if (mode === 'attack') {
    return rollAttack(spellAttackBonus(char), {
      label: `${spell.name} — ataque de conjuro`,
      actorName: char.name,
    });
  }

  try {
    const detail = await api(`/srd/spells/${spell.index}`);
    const data = detail.data;
    let notation = null;
    if (data.damage?.damage_at_slot_level) {
      notation = data.damage.damage_at_slot_level[data.level] ?? Object.values(data.damage.damage_at_slot_level)[0];
    } else if (data.damage?.damage_at_character_level) {
      notation = cantripDamageAtLevel(data.damage.damage_at_character_level, char.level);
    }
    if (!notation) return null;
    // Notaciones tipo "8d6" o "3d4 + 3" (bonificador plano incluido)
    const m = /(\d+)d(\d+)(?:\s*\+\s*(\d+))?/.exec(notation);
    if (!m) return null;
    return rollDamage(`${m[1]}d${m[2]}`, {
      modifier: m[3] ? Number(m[3]) : 0,
      label: `${spell.name} — daño${dcText}`,
      actorName: char.name,
    });
  } catch {
    return null; // sin conexión al compendio
  }
}
