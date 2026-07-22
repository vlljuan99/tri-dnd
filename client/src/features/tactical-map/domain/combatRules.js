// Espejo cliente de las reglas puras del servidor. Sirve para tirar el d20
// correcto antes de enviarlo; el servidor vuelve a resolverlas y rechaza un
// modo obsoleto si las condiciones cambiaron mientras el panel estaba abierto.

const ACTION_BLOCKERS = new Set(['aturdido', 'paralizado', 'petrificado', 'inconsciente']);
const MOVEMENT_BLOCKERS = new Set([
  'agarrado',
  'apresado',
  'aturdido',
  'paralizado',
  'petrificado',
  'inconsciente',
]);

function clean(conditions) {
  return Array.isArray(conditions) ? conditions.filter((condition) => typeof condition === 'string') : [];
}

function addIf(list, condition, reason) {
  if (condition) list.push(reason);
}

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
  const attacker = new Set(clean(attackerConditions));
  const target = new Set(clean(targetConditions));
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
    !target.has('cegado') &&
    !attacker.has('invisible') &&
    ![...target].some((condition) => MOVEMENT_BLOCKERS.has(condition));
  addIf(disadvantageReasons, targetStance === 'esquivar' && targetCanDodge, 'objetivo esquivando');

  if (manualAdvantage === 'adv') advantageReasons.push('ventaja manual');
  if (manualAdvantage === 'dis') disadvantageReasons.push('desventaja manual');

  return {
    advantage:
      advantageReasons.length > 0 && disadvantageReasons.length === 0
        ? 'adv'
        : disadvantageReasons.length > 0 && advantageReasons.length === 0
          ? 'dis'
          : 'none',
    advantageReasons,
    disadvantageReasons,
    autoCrit: distance <= 1 && (target.has('paralizado') || target.has('inconsciente')),
    blocked: [...attacker].some((condition) => ACTION_BLOCKERS.has(condition)),
  };
}
