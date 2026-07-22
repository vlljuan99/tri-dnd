// Reglas de concentración 5e. La app ya sabía qué hechizos la requieren (el
// compendio y la biblioteca propia guardan `concentration`), pero el combate
// la ignoraba por completo y la mesa tenía que acordarse a mano — que es
// justo la regla que más se olvida jugando.
//
// Como percepción y caída, la tirada se construye aquí y no en el cliente:
// quien concentra no elige su propio resultado. Todo el módulo es puro (el
// azar entra por parámetro) para poder probarlo sin base de datos; el estado
// vive en combatants.concentration_spell (ver turnEconomy.js).

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '') ?? fallback;
  } catch {
    return fallback;
  }
}

export function abilityModifier(score) {
  return Math.floor(((Number.isFinite(score) ? score : 10) - 10) / 2);
}

export function proficiencyBonus(level) {
  const safeLevel = Number.isInteger(level) && level > 0 ? level : 1;
  return 2 + Math.floor((safeLevel - 1) / 4);
}

/**
 * CD de la salvación al recibir daño concentrando: 10, o la mitad del daño
 * recibido si es mayor. El daño se redondea hacia abajo (38 → CD 19, 39 → 19).
 */
export function concentrationDC(damage) {
  const dealt = Number.isFinite(damage) ? Math.floor(damage) : 0;
  return Math.max(10, Math.floor(dealt / 2));
}

/** Bonificador de la salvación de Constitución de un PJ (mod. CON + competencia si la tiene). */
export function concentrationSaveBonus(character) {
  const abilities = parseJson(character?.abilities, {});
  const saves = parseJson(character?.save_proficiencies, []);
  return (
    abilityModifier(abilities.con) +
    (saves.includes('con') ? proficiencyBonus(character?.level) : 0)
  );
}

/** Tirada de salvación de concentración con el mismo formato que el resto del chat. */
export function buildConcentrationSaveRoll({ actorName, bonus, spell, random = Math.random }) {
  const kept = Math.floor(random() * 20) + 1;
  const modifier = Number.isFinite(bonus) ? bonus : 0;
  return {
    kind: 'check',
    formula: `1d20${modifier >= 0 ? '+' : ''}${modifier}`,
    label: spell ? `Concentración (${spell})` : 'Concentración',
    actorName,
    groups: [{ die: 'd20', sides: 20, results: [{ rolls: [kept], kept }] }],
    modifier,
    total: kept + modifier,
    natural: kept,
  };
}

/**
 * Resuelve la salvación. Un 1 natural siempre falla y un 20 natural siempre
 * pasa (regla de mesa habitual para salvaciones; el SRD no lo impone, pero es
 * lo que espera cualquiera que se siente a jugar).
 */
export function resolveConcentrationSave({ total, natural, dc }) {
  if (natural === 1) return { held: false, reason: 'pifia' };
  if (natural === 20) return { held: true, reason: 'critico' };
  return { held: total >= dc, reason: 'normal' };
}
