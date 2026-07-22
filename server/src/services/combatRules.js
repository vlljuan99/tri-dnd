// Reglas mecánicas de las condiciones de combate que afectan al flujo ya
// automatizado por la mesa: ataques, críticos y movimiento. Las condiciones
// que necesitan conocer una criatura origen (hechizado/asustado) se aplican
// solo en la parte que puede representar el estado actual; el DM conserva el
// control de cuándo poner o quitar el chip.

export const CONDITION_SRD_INDEX = {
  envenenado: 'poisoned',
  derribado: 'prone',
  agarrado: 'grappled',
  aturdido: 'stunned',
  cegado: 'blinded',
  ensordecido: 'deafened',
  asustado: 'frightened',
  hechizado: 'charmed',
  paralizado: 'paralyzed',
  petrificado: 'petrified',
  apresado: 'restrained',
  invisible: 'invisible',
  inconsciente: 'unconscious',
};

const ACTION_BLOCKERS = new Set(['aturdido', 'paralizado', 'petrificado', 'inconsciente']);
const MOVEMENT_BLOCKERS = new Set([
  'agarrado',
  'apresado',
  'aturdido',
  'paralizado',
  'petrificado',
  'inconsciente',
]);

export function parseConditions(value) {
  if (Array.isArray(value)) return value.filter((condition) => typeof condition === 'string');
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((condition) => typeof condition === 'string') : [];
  } catch {
    return [];
  }
}

export function conditionsPreventActions(conditions) {
  return parseConditions(conditions).some((condition) => ACTION_BLOCKERS.has(condition));
}

export function conditionsPreventMovement(conditions) {
  return parseConditions(conditions).some((condition) => MOVEMENT_BLOCKERS.has(condition));
}

export function isConditionImmune(monsterData, condition) {
  const srdIndex = CONDITION_SRD_INDEX[condition];
  if (!srdIndex) return false;
  return (monsterData?.condition_immunities ?? []).some(
    (entry) => String(entry?.index ?? entry?.name ?? entry ?? '').toLowerCase() === srdIndex
  );
}

function addIf(list, condition, reason) {
  if (condition) list.push(reason);
}

// Resuelve todas las fuentes conocidas de ventaja/desventaja. En 5e una sola
// fuente de cada lado basta y ambas se cancelan, independientemente de cuántas
// haya. `manualAdvantage` representa una fuente externa elegida por la mesa.
export function resolveAttackEffects({
  attackerConditions = [],
  targetConditions = [],
  targetStance = null,
  distance = Infinity,
  highGround = false,
  ranged = false,
  longRange = false,
  manualAdvantage = 'none',
} = {}) {
  const attacker = new Set(parseConditions(attackerConditions));
  const target = new Set(parseConditions(targetConditions));
  const advantageReasons = [];
  const disadvantageReasons = [];

  addIf(advantageReasons, attacker.has('invisible'), 'atacante invisible');
  addIf(advantageReasons, target.has('cegado'), 'objetivo cegado');
  addIf(advantageReasons, target.has('aturdido'), 'objetivo aturdido');
  addIf(advantageReasons, target.has('paralizado'), 'objetivo paralizado');
  addIf(advantageReasons, target.has('petrificado'), 'objetivo petrificado');
  addIf(advantageReasons, target.has('apresado'), 'objetivo apresado');
  addIf(advantageReasons, target.has('inconsciente'), 'objetivo inconsciente');
  addIf(advantageReasons, target.has('derribado') && distance <= 1, 'objetivo derribado a 5 pies');
  addIf(advantageReasons, ranged && highGround, 'cota alta');

  addIf(disadvantageReasons, attacker.has('cegado'), 'atacante cegado');
  addIf(disadvantageReasons, attacker.has('envenenado'), 'atacante envenenado');
  addIf(disadvantageReasons, attacker.has('asustado'), 'atacante asustado');
  addIf(disadvantageReasons, attacker.has('derribado'), 'atacante derribado');
  addIf(disadvantageReasons, attacker.has('apresado'), 'atacante apresado');
  addIf(disadvantageReasons, target.has('invisible'), 'objetivo invisible');
  addIf(disadvantageReasons, ranged && longRange, 'distancia larga');
  addIf(disadvantageReasons, target.has('derribado') && distance > 1, 'objetivo derribado a distancia');
  addIf(disadvantageReasons, target.has('inconsciente') && distance > 1, 'objetivo inconsciente y derribado');
  const targetCanDodge =
    !target.has('cegado') && !attacker.has('invisible') && !conditionsPreventMovement([...target]);
  addIf(disadvantageReasons, targetStance === 'esquivar' && targetCanDodge, 'objetivo esquivando');

  if (manualAdvantage === 'adv') advantageReasons.push('ventaja manual');
  if (manualAdvantage === 'dis') disadvantageReasons.push('desventaja manual');

  const advantage =
    advantageReasons.length > 0 && disadvantageReasons.length === 0
      ? 'adv'
      : disadvantageReasons.length > 0 && advantageReasons.length === 0
        ? 'dis'
        : 'none';
  const autoCrit = distance <= 1 && (target.has('paralizado') || target.has('inconsciente'));

  return {
    advantage,
    advantageReasons,
    disadvantageReasons,
    autoCrit,
    blocked: conditionsPreventActions([...attacker]),
  };
}
