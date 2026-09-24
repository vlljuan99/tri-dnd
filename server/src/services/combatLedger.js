// Resumen de combate (Fase 4, añadido del 23-sep-2026): al terminar un
// combate, una tarjeta con el daño hecho por cada uno, sus críticos y pifias,
// quién dio el golpe final y quién cayó.
//
// Se alimenta de lo que ya se publica en la mesa (las tiradas con su veredicto
// y los derribos), así que no inventa nada ni guarda datos nuevos: vive en
// memoria mientras dura el combate y se descarta al resumirlo. Si el servidor
// se reinicia a mitad, el resumen de ese combate sale incompleto.

const ledgers = new Map();

function ledgerFor(campaignId) {
  const key = Number(campaignId);
  if (!ledgers.has(key)) {
    ledgers.set(key, { actors: new Map(), finalBlows: [], fallen: [] });
  }
  return ledgers.get(key);
}

function actor(ledger, name) {
  if (!ledger.actors.has(name)) ledger.actors.set(name, { name, damage: 0, crits: 0, fumbles: 0, attacks: 0 });
  return ledger.actors.get(name);
}

/** Una tirada publicada durante el combate: ataque (con veredicto) o daño. */
export function recordRoll(campaignId, roll) {
  const name = typeof roll?.actorName === 'string' ? roll.actorName.trim() : '';
  if (!name) return;
  const ledger = ledgerFor(campaignId);
  if (roll.kind === 'damage') {
    const total = Number(roll.total);
    if (Number.isFinite(total) && total > 0) actor(ledger, name).damage += total;
    return;
  }
  if (roll.outcome?.tipo === 'ataque') {
    const entry = actor(ledger, name);
    entry.attacks += 1;
    if (roll.outcome.resultado === 'critico') entry.crits += 1;
    if (roll.outcome.resultado === 'pifia') entry.fumbles += 1;
  }
}

export function recordFinalBlow(campaignId, { by, target }) {
  if (!by || !target) return;
  ledgerFor(campaignId).finalBlows.push({ by, target });
}

export function recordFall(campaignId, name) {
  if (!name) return;
  const ledger = ledgerFor(campaignId);
  if (!ledger.fallen.includes(name)) ledger.fallen.push(name);
}

/**
 * Resume y olvida el combate. `pcNames` son los PJ: sus números los ve toda la
 * mesa; los de los enemigos van aparte y solo los recibe el DM.
 */
export function takeSummary(campaignId, { pcNames = [], rounds = null } = {}) {
  const key = Number(campaignId);
  const ledger = ledgers.get(key);
  ledgers.delete(key);
  if (!ledger) return null;
  const pcs = new Set(pcNames);
  const byDamage = (a, b) => b.damage - a.damage || b.crits - a.crits || a.name.localeCompare(b.name);
  const actors = [...ledger.actors.values()];
  const party = actors.filter((entry) => pcs.has(entry.name)).sort(byDamage);
  const enemies = actors.filter((entry) => !pcs.has(entry.name)).sort(byDamage);
  if (!party.length && !enemies.length && !ledger.finalBlows.length && !ledger.fallen.length) return null;
  return {
    rounds,
    party,
    enemies,
    finalBlows: ledger.finalBlows.filter((blow) => pcs.has(blow.by)),
    fallen: ledger.fallen.filter((name) => pcs.has(name)),
  };
}

/** Lo que ve un jugador: sin los números de los enemigos. */
export function summaryForPlayer(summary) {
  if (!summary) return null;
  // eslint-disable-next-line no-unused-vars
  const { enemies, ...rest } = summary;
  return rest;
}

/** Descarta sin resumir (un combate que se cancela sin llegar a nada). */
export function discardLedger(campaignId) {
  ledgers.delete(Number(campaignId));
}
