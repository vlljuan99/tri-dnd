import { db } from '../db.js';
import { fireRoundEvents } from './events.js';
import {
  conditionsPreventActions,
  conditionsPreventMovement,
  isConditionImmune,
} from './combatRules.js';
import {
  CONDITION_TIMINGS,
  DEATH_STATES,
  conditionTimer,
  damageAtZeroTransition,
  normalizeConditionTimers,
  resolveDeathSave,
  tickConditionTimers,
} from './combatLifecycle.js';
import { consumeMonsterAttack, parseMultiattackState } from './monsterActions.js';
import { syncBossResources } from './bossActions.js';
import { abilityModifier } from '../rules/abilities.js';

let conditionExpirationNotifier = null;
let turnStartEffectsNotifier = null;

// Socket.io vive fuera de este servicio. Se inyecta un avisador para que las
// expiraciones al inicio de turno también generen toast cuando el combate se
// arranca desde una ruta HTTP (por ejemplo, al revelar una sala).
export function bindConditionExpirationNotifier(fn) {
  conditionExpirationNotifier = typeof fn === 'function' ? fn : null;
}

// Efectos de casilla que se disparan al inicio de turno viven en otro
// servicio para no mezclar geometría de mapas con la economía de acciones.
export function bindTurnStartEffectsNotifier(fn) {
  turnStartEffectsNotifier = typeof fn === 'function' ? fn : null;
}

// Economía de turno de verdad (Fase 8.5): con el modo por turnos activo
// (game_tables.combat_active), moverse y actuar en el tablero solo es
// posible en tu turno, con un presupuesto de movimiento y una acción por
// turno (más una acción adicional y una reacción por ronda, gestionadas
// aparte). Este módulo no sabe nada de sockets ni de mensajes de chat: solo
// datos y reglas; quien lo llama decide qué avisar y a quién.

function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

// Bonificador de Destreza de un combatiente: de su ficha si es un PJ, del
// compendio SRD si es un enemigo con monstruo asociado; 0 en cualquier otro caso
// (ficha incompleta, enemigo sin monster_index, etc. — nunca bloquea por esto).
function dexModifierForCombatant(row) {
  if (row.kind === 'pj' && row.character_id) {
    const char = db.prepare('SELECT abilities FROM characters WHERE id = ?').get(row.character_id);
    if (char) {
      try {
        return abilityModifier(JSON.parse(char.abilities).dex ?? 10);
      } catch {
        return 0;
      }
    }
    return 0;
  }
  if (row.kind === 'enemigo' && row.monster_index) {
    const entry = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
      .get(row.monster_index);
    if (entry) {
      try {
        return abilityModifier(JSON.parse(entry.data).dexterity ?? 10);
      } catch {
        return 0;
      }
    }
  }
  return 0;
}

// Tira la iniciativa de un combatiente devolviendo el desglose completo, no
// solo el total: la mesa tiene derecho a ver de dónde sale cada número (1d20
// + DES). Quien llama decide si lo publica en el chat, lo guarda o ambos.
export function rollInitiativeDetailed(row) {
  const d20 = rollD20();
  const modifier = dexModifierForCombatant(row);
  return { d20, modifier, total: d20 + modifier };
}

// Guarda una iniciativa tirada por el servidor con su desglose, para que el
// tracker pueda mostrarla auditada mucho después de perderse el chat.
export function storeRolledInitiative(combatantId, { d20, modifier, total }) {
  db.prepare(
    "UPDATE combatants SET initiative = ?, initiative_source = 'auto', initiative_d20 = ?, initiative_mod = ? WHERE id = ?"
  ).run(total, d20, modifier, combatantId);
}

// Tira la iniciativa de un combatiente concreto y la guarda. Devuelve el
// desglose y el nombre, listos para narrar en el chat.
export function rollInitiativeFor(campaignId, combatantId) {
  const row = db
    .prepare('SELECT * FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  const detail = rollInitiativeDetailed(row);
  storeRolledInitiative(row.id, detail);
  return { ok: true, ...detail, id: row.id, name: row.name, kind: row.kind };
}

// Fija una iniciativa a mano (el DM escribe el número). Sin desglose: no hay
// tirada que auditar, y marcarla como 'manual' es justo lo que permite que
// "respetar las tiradas existentes" no la pise.
export function setManualInitiative(campaignId, combatantId, initiative) {
  const changed = db
    .prepare(
      `UPDATE combatants SET initiative = ?, initiative_source = 'manual',
       initiative_d20 = NULL, initiative_mod = NULL WHERE id = ? AND campaign_id = ?`
    )
    .run(initiative, combatantId, campaignId).changes;
  return changed > 0;
}

// Velocidad a pie de un monstruo del compendio SRD (p. ej. "30 ft." → 30).
// null si no tiene monster_index o no trae ese dato: la mesa decide a mano.
export function monsterSpeedFeet(monsterIndex) {
  if (!monsterIndex) return null;
  const entry = db
    .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
    .get(monsterIndex);
  if (!entry) return null;
  try {
    const match = /(\d+)/.exec(JSON.parse(entry.data).speed?.walk ?? '');
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function orderedCombatants(campaignId) {
  return db
    .prepare('SELECT * FROM combatants WHERE campaign_id = ? ORDER BY initiative DESC, id ASC')
    .all(campaignId);
}

export function combatantTakesTurn(row) {
  if (row.kind === 'enemigo') return !Number.isInteger(row.hp_current) || row.hp_current > 0;
  if (!row.character_id) return true;
  const character = db.prepare('SELECT hp_current FROM characters WHERE id = ?').get(row.character_id);
  if (!character || character.hp_current > 0) return true;
  // Un PJ agonizante conserva su turno para hacer una salvación de muerte.
  // Los estabilizados y muertos permanecen visibles en iniciativa, pero se
  // saltan hasta que recuperen PG o intervenga el DM.
  return row.death_state === DEATH_STATES.DYING;
}

export function resetCombatantResources(combatantId) {
  // Correr (dashed) y la postura (stance) son recursos del turno: se olvidan
  // al empezar el siguiente, igual que el movimiento/acción. Las condiciones
  // y las salvaciones de muerte NO se tocan aquí (persisten entre turnos).
  db.prepare(
    `UPDATE combatants SET moved_squares = 0, action_used = 0, bonus_used = 0,
     dashed = 0, stance = NULL, multiattack_state = '{}',
     legendary_points = legendary_points_max WHERE id = ?`
  ).run(combatantId);
}

// Marca a un combatiente como el que actúa ahora y resetea sus recursos del
// turno (la reacción no se resetea aquí: es por ronda, no por turno). Si la
// ronda avanza, saltan los eventos de cadencia por rondas (Fase 19) — este
// es el único sitio donde se escribe combat_round durante el combate.
export function startTurnFor(campaignId, combatantId, round) {
  const previousRound = db
    .prepare('SELECT combat_round FROM game_tables WHERE campaign_id = ?')
    .get(campaignId)?.combat_round;
  db.prepare('UPDATE game_tables SET combat_turn_id = ?, combat_round = ? WHERE campaign_id = ?').run(
    combatantId,
    round,
    campaignId
  );
  resetCombatantResources(combatantId);
  expireHelpFrom(campaignId, combatantId);
  const expiredConditions = tickConditionsForTurn(campaignId, combatantId, 'start');
  if (expiredConditions.length) conditionExpirationNotifier?.(campaignId, expiredConditions);
  turnStartEffectsNotifier?.(campaignId, combatantId, round);
  // Una reacción pendiente solo existe mientras sigue abierta la ventana
  // que provocó el movimiento. Al empezar otro turno no puede conservarse.
  db.prepare('DELETE FROM opportunity_attacks WHERE campaign_id = ?').run(campaignId);
  if (Number.isInteger(previousRound) && round > previousRound) {
    fireRoundEvents(campaignId, round);
  }
  return { expiredConditions };
}

// Si el modo por turnos está activo y no hay nadie actuando (mesa recién
// activada, o el tracker estaba vacío y acaba de entrar el primero), arranca
// con el primero por iniciativa sin tocar la ronda en curso.
export function ensureTurnStarted(campaignId) {
  const table = db
    .prepare('SELECT combat_active, combat_turn_id, combat_round FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active || table.combat_turn_id) return;
  const list = orderedCombatants(campaignId).filter(combatantTakesTurn);
  if (!list.length) return;
  return startTurnFor(campaignId, list[0].id, table.combat_round ?? 1);
}

// Activa el modo por turnos como arranque fresco de encuentro: resetea los
// recursos de todos (incluida la reacción: es una ronda 1 nueva), asegura que
// todo el mundo tiene iniciativa y empieza por el primero.
//
// `rerollAll` decide qué pasa con lo ya tirado, que es la única pregunta que
// esto no puede contestar solo (la hace el DM en la mesa):
//   true  → tira por todos, pisando cualquier valor previo.
//   false → tira solo por quien no tenga iniciativa propia todavía
//           (initiative_source IS NULL), respetando al resto.
// En ambos casos se devuelve el desglose de lo tirado para narrarlo: la
// automatización no vale nada si la mesa no puede ver de dónde sale.
//
// `deferPj` (Fase 4c): los combatientes para los que devuelve true NO se tiran
// aquí; se devuelven en `deferred` para que su jugador tire (el ritual de
// iniciativa) y el turno no arranca hasta que lleguen todos.
export function activateTurnMode(campaignId, { rerollAll = true, deferPj = null } = {}) {
  db.prepare('DELETE FROM opportunity_attacks WHERE campaign_id = ?').run(campaignId);
  db.prepare('UPDATE game_tables SET combat_active = 1 WHERE campaign_id = ?').run(campaignId);
  db.prepare(
    `UPDATE combatants SET moved_squares = 0, action_used = 0, bonus_used = 0,
     dashed = 0, stance = NULL, reaction_used_round = NULL, death_save_round = NULL,
     multiattack_state = '{}', help_from_id = NULL WHERE campaign_id = ?`
  ).run(campaignId);

  const rolls = [];
  const deferred = [];
  for (const combatant of orderedCombatants(campaignId)) syncBossResources(combatant.id);
  for (const c of orderedCombatants(campaignId)) {
    if (!rerollAll && c.initiative_source !== null) continue;
    if (deferPj?.(c)) {
      deferred.push(c);
      continue;
    }
    const detail = rollInitiativeDetailed(c);
    storeRolledInitiative(c.id, detail);
    rolls.push({ id: c.id, name: c.name, kind: c.kind, ...detail });
  }

  const fresh = orderedCombatants(campaignId);
  if (deferred.length) {
    // Nadie actúa hasta que los jugadores hayan tirado su iniciativa
    db.prepare('UPDATE game_tables SET combat_round = 1, combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
    return { order: fresh, rolls, deferred, expiredConditions: [] };
  }
  const firstConscious = fresh.find(combatantTakesTurn);
  const started = firstConscious ? startTurnFor(campaignId, firstConscious.id, 1) : null;
  if (!firstConscious) {
    db.prepare('UPDATE game_tables SET combat_round = 1, combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
  }
  return { order: fresh, rolls, deferred, expiredConditions: started?.expiredConditions ?? [] };
}

// ¿Hay iniciativas que "respetar las tiradas existentes" conservaría? El DM
// necesita saberlo para elegir con criterio antes de arrancar el combate.
export function initiativeSummary(campaignId) {
  const list = orderedCombatants(campaignId);
  return {
    total: list.length,
    withInitiative: list.filter((c) => c.initiative_source !== null).length,
  };
}

// Modo libre: se desactiva el bloqueo de movimiento/acción sin borrar el
// tracker (a diferencia de terminar el combate del todo, que sí lo vacía).
export function deactivateTurnMode(campaignId) {
  db.prepare('DELETE FROM opportunity_attacks WHERE campaign_id = ?').run(campaignId);
  db.prepare('UPDATE game_tables SET combat_active = 0, combat_turn_id = NULL WHERE campaign_id = ?').run(
    campaignId
  );
}

// Añade un personaje al tracker si aún no está (mismo patrón que los
// enemigos al revelarse su sala): tira iniciativa si el modo ya está activo,
// y arranca el turno si el tracker estaba vacío. Devuelve true si lo insertó.
export function ensureCombatantForCharacter(campaignId, characterId, { firstTurn = false } = {}) {
  const existing = db
    .prepare("SELECT id FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
    .get(campaignId, characterId);
  if (existing) return false;

  const character = db.prepare('SELECT id, name, hp_current FROM characters WHERE id = ?').get(characterId);
  if (!character) return false;

  // Entrar a un combate ya en marcha tira iniciativa sola (y guarda el
  // desglose); fuera del modo por turnos se queda sin tirar hasta que el DM
  // abra el combate, que es cuando el orden importa.
  const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
  const detail = table?.combat_active
    ? rollInitiativeDetailed({ kind: 'pj', character_id: characterId })
    : null;
  const inserted = db.prepare(
    `INSERT INTO combatants (campaign_id, character_id, kind, name, initiative,
     initiative_source, initiative_d20, initiative_mod, death_state)
     VALUES (?, ?, 'pj', ?, ?, ?, ?, ?, ?)`
  ).run(
    campaignId,
    characterId,
    character.name,
    detail?.total ?? 0,
    detail ? 'auto' : null,
    detail?.d20 ?? null,
    detail?.modifier ?? null,
    character.hp_current <= 0 ? DEATH_STATES.DYING : DEATH_STATES.NORMAL
  );

  // Los escenarios preparados sin DM conceden la apertura al aventurero. La
  // iniciativa se conserva y seguirá ordenando los turnos posteriores; solo
  // evitamos que la IA actúe antes de que el jugador haya podido hacer nada.
  if (firstTurn && table?.combat_active) {
    startTurnFor(campaignId, Number(inserted.lastInsertRowid), 1);
  } else {
    ensureTurnStarted(campaignId);
  }
  return detail ? { inserted: true, name: character.name, ...detail } : { inserted: true };
}

// ¿Está este personaje a 0 PG o menos? Inconsciente (agonizando o ya
// muerto): en 5e no puede moverse ni actuar en ningún caso, tenga o no el
// modo por turnos activo. Se comprueba siempre sobre characters.hp_current,
// la fuente de verdad (combatants.hp_current no se mantiene sincronizado
// para PJs).
function isPjDowned(characterId) {
  if (!characterId) return false;
  const character = db.prepare('SELECT hp_current FROM characters WHERE id = ?').get(characterId);
  return Boolean(character) && Number.isInteger(character.hp_current) && character.hp_current <= 0;
}

// ¿Puede este personaje moverse/actuar ahora mismo?
// - Inconsciente (0 PG o menos, agonizando o muerto): nunca, ni en modo libre.
// - Modo libre (combat_active = 0): siempre sí, sin gasto de recursos.
// - Modo por turnos pero el personaje no está en el tracker todavía: se
//   permite igualmente (no debería pasar tras ensureCombatantForCharacter,
//   pero un tracker vaciado a mano por el DM no debe dejar a nadie bloqueado).
// - Modo por turnos y el personaje sí está en el tracker: solo en su turno.
function checkTurn(campaignId, characterId) {
  if (isPjDowned(characterId)) {
    return { ok: false, error: 'Estás inconsciente y no puedes moverte ni actuar', gated: true, combatant: null };
  }

  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  const combatant = db
    .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
    .get(campaignId, characterId);
  if (!table?.combat_active) return { ok: true, combatant: combatant ?? null, gated: false };
  if (!combatant) return { ok: true, combatant: null, gated: false };

  if (table.combat_turn_id !== combatant.id) {
    return { ok: false, error: 'No es tu turno', gated: true };
  }
  return { ok: true, combatant, gated: true };
}

// Gasta movimiento del turno: casillas ya recorridas + las nuevas, contra el
// presupuesto de la velocidad (en casillas de 5 pies). Se puede llamar varias
// veces en el mismo turno (repartido antes/después de actuar).
export function trySpendMovement(campaignId, characterId, squares) {
  const check = checkTurn(campaignId, characterId);
  if (!check.ok) return check;
  if (check.combatant && conditionsPreventMovement(check.combatant.conditions)) {
    return { ok: false, error: 'Tus condiciones actuales reducen tu velocidad a 0' };
  }
  if (!check.gated || squares <= 0) return { ok: true };

  const character = db.prepare('SELECT speed FROM characters WHERE id = ?').get(characterId);
  // Correr (Dash) dobla el presupuesto de movimiento del turno
  const budget = Math.floor((character?.speed ?? 30) / 5) * (check.combatant.dashed ? 2 : 1);
  const nextTotal = check.combatant.moved_squares + squares;
  if (nextTotal > budget) {
    const left = Math.max(0, budget - check.combatant.moved_squares);
    return { ok: false, error: `Sin movimiento suficiente (te quedan ${left} casillas este turno)` };
  }
  db.prepare('UPDATE combatants SET moved_squares = ? WHERE id = ?').run(nextTotal, check.combatant.id);
  return { ok: true };
}

// Gasta la acción del turno (atacar cuenta como una sola acción, tirada y
// daño incluidos). Una vez gastada no se puede volver a atacar hasta tu
// siguiente turno.
export function trySpendAction(campaignId, characterId) {
  const check = checkTurn(campaignId, characterId);
  if (!check.ok) return check;
  if (check.combatant && conditionsPreventActions(check.combatant.conditions)) {
    return { ok: false, error: 'Tus condiciones actuales te impiden realizar acciones' };
  }
  if (!check.gated) return { ok: true };
  if (check.combatant.action_used) return { ok: false, error: 'Ya has usado tu acción este turno' };
  db.prepare('UPDATE combatants SET action_used = 1 WHERE id = ?').run(check.combatant.id);
  return { ok: true };
}

// Gasta movimiento de un enemigo arrastrado por el DM en el tablero: misma
// economía que un jugador (presupuesto por turno, bloqueado fuera de su
// turno), pero identificado por su marcador de mapa y con la velocidad del
// monstruo del compendio SRD en vez de characters.speed. Si el marcador aún
// no tiene combatiente (no ha entrado al tracker) no hay economía que
// aplicar: se mueve libre, como cualquier objeto/aliado del editor.
export function trySpendEnemyMovement(campaignId, mapTokenId, squares) {
  const combatant = db
    .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND map_token_id = ? AND kind = 'enemigo'")
    .get(campaignId, mapTokenId);
  if (!combatant) return { ok: true };
  if (Number.isInteger(combatant.hp_current) && combatant.hp_current <= 0) {
    return { ok: false, error: 'Este enemigo está inconsciente y no puede moverse' };
  }
  if (conditionsPreventMovement(combatant.conditions)) {
    return { ok: false, error: 'Las condiciones de este enemigo reducen su velocidad a 0' };
  }

  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active || squares <= 0) return { ok: true };
  if (table.combat_turn_id !== combatant.id) {
    return { ok: false, error: 'No es el turno de este enemigo' };
  }

  // La velocidad de la variante por instancia (miniboss, Fase 17) manda
  // sobre la del monstruo del compendio para el presupuesto de movimiento.
  const overrides = JSON.parse(combatant.overrides || '{}');
  const speedFeet = Number.isInteger(overrides.speed)
    ? overrides.speed
    : monsterSpeedFeet(combatant.monster_index) ?? 30;
  // Correr (Dash) dobla el presupuesto también para un enemigo del DM
  const budget = Math.floor(speedFeet / 5) * (combatant.dashed ? 2 : 1);
  const nextTotal = combatant.moved_squares + squares;
  if (nextTotal > budget) {
    const left = Math.max(0, budget - combatant.moved_squares);
    return { ok: false, error: `Sin movimiento suficiente (le quedan ${left} casillas este turno)` };
  }
  db.prepare('UPDATE combatants SET moved_squares = ? WHERE id = ?').run(nextTotal, combatant.id);
  return { ok: true };
}

// Condiciones de combate reconocidas (5e básicas + inconsciente). Sus efectos
// representables se aplican en servidor a ataques, críticos, acciones y
// movimiento; los que dependen de una criatura origen siguen bajo control del
// DM, que decide cuándo poner o quitar el chip.
export const COMBAT_CONDITIONS = [
  'envenenado',
  'derribado',
  'agarrado',
  'aturdido',
  'cegado',
  'ensordecido',
  'asustado',
  'hechizado',
  'paralizado',
  'petrificado',
  'apresado',
  'invisible',
  'inconsciente',
];

// Acciones especiales del turno que gastan la acción (Correr, Esquivar,
// Destrabarse, Ayudar). Solo el combatiente activo, y solo si aún no ha actuado.
// - 'correr' dobla el presupuesto de movimiento (marca dashed).
// - 'esquivar' aplica desventaja automática mientras pueda ver y moverse.
// - 'destrabarse' evita que el camino confirmado genere ataques de oportunidad.
// - 'ayudar' (Fase 4c, SRD 5.1 «Help»): el aliado elegido (`targetId`) gana
//   ventaja en su siguiente prueba de característica o en su siguiente ataque
//   contra una criatura a 5 pies o menos de quien ayuda, antes del siguiente
//   turno de quien ayuda. Se guarda en el ayudado (`help_from_id`).
export function trySpecialAction(campaignId, combatantId, kind, { targetId = null } = {}) {
  const valid = { correr: 'dash', esquivar: 'esquivar', destrabarse: 'destrabarse', ayudar: 'ayudar' };
  if (!valid[kind]) return { ok: false, error: 'Acción no válida' };
  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: false, error: 'La mesa está en modo libre' };
  if (table.combat_turn_id !== combatantId) return { ok: false, error: 'No es tu turno' };
  const row = db
    .prepare('SELECT action_used, kind, character_id, conditions FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  if (row.kind === 'pj' && isPjDowned(row.character_id)) {
    return { ok: false, error: 'Estás inconsciente y no puedes actuar' };
  }
  if (conditionsPreventActions(row.conditions)) {
    return { ok: false, error: 'Las condiciones actuales impiden realizar acciones' };
  }
  if (row.action_used) return { ok: false, error: 'Ya has usado tu acción este turno' };

  if (kind === 'ayudar') {
    const target = db
      .prepare('SELECT id, kind, name FROM combatants WHERE id = ? AND campaign_id = ?')
      .get(Number(targetId), campaignId);
    if (!target || target.id === combatantId) return { ok: false, error: 'Elige a un aliado al que ayudar' };
    // Se ayuda a un compañero: un PJ, o un aliado si quien ayuda es del DM
    const allied = target.kind === 'pj' || (target.kind === 'aliado' && row.kind !== 'enemigo');
    if (!allied || row.kind === 'enemigo') return { ok: false, error: 'Solo puedes ayudar a un aliado' };
    db.prepare('UPDATE combatants SET action_used = 1 WHERE id = ?').run(combatantId);
    db.prepare('UPDATE combatants SET help_from_id = ? WHERE id = ?').run(combatantId, target.id);
    return { ok: true, target };
  }
  if (kind === 'correr') {
    db.prepare('UPDATE combatants SET action_used = 1, dashed = 1 WHERE id = ?').run(combatantId);
  } else {
    db.prepare('UPDATE combatants SET action_used = 1, stance = ? WHERE id = ?').run(kind, combatantId);
  }
  return { ok: true };
}

// La ayuda vence al empezar el siguiente turno de quien la dio (SRD).
export function expireHelpFrom(campaignId, helperId) {
  db.prepare('UPDATE combatants SET help_from_id = NULL WHERE campaign_id = ? AND help_from_id = ?').run(
    campaignId,
    helperId
  );
}

// La ayuda se gasta al usarla (un ataque o una prueba del ayudado).
export function consumeHelp(combatantId) {
  db.prepare('UPDATE combatants SET help_from_id = NULL WHERE id = ?').run(combatantId);
}

function jsonList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Alterna una condición del combatiente (la pone si no está, la quita si sí).
// Sin duración persiste hasta que el DM la retire. Con duración, el contador
// baja al inicio o final del turno del propio afectado.
export function toggleCondition(campaignId, combatantId, condition, options = {}) {
  if (!COMBAT_CONDITIONS.includes(condition)) return { ok: false, error: 'Condición no válida' };
  if (options.duration != null) {
    const duration = Math.round(Number(options.duration));
    if (!Number.isInteger(duration) || duration < 1 || duration > 99) {
      return { ok: false, error: 'La duración debe estar entre 1 y 99 rondas' };
    }
    if (!CONDITION_TIMINGS.includes(options.timing)) {
      return { ok: false, error: 'El momento de expiración no es válido' };
    }
  }
  const row = db
    .prepare(
      'SELECT conditions, condition_timers, fluid_conditions, monster_index FROM combatants WHERE id = ? AND campaign_id = ?'
    )
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  const list = jsonList(row.conditions);
  const has = list.includes(condition);
  if (!has && row.monster_index) {
    const entry = db
      .prepare("SELECT data FROM srd_entries WHERE category = 'monsters' AND idx = ?")
      .get(row.monster_index);
    if (entry) {
      try {
        if (isConditionImmune(JSON.parse(entry.data), condition)) {
          return { ok: false, error: `La criatura es inmune a la condición «${condition}»` };
        }
      } catch {
        // Una entrada SRD dañada no bloquea la gestión manual del DM.
      }
    }
  }
  const next = has ? list.filter((c) => c !== condition) : [...list, condition];
  const existingTimers = normalizeConditionTimers(row.condition_timers).filter(
    (entry) => entry.condition !== condition
  );
  const timer = has ? null : conditionTimer(condition, options);
  const nextTimers = timer ? [...existingTimers, timer] : existingTimers;
  // Si el DM toca una condición automática, deja de pertenecer al fluido:
  // su decisión manual no se borrará al salir de la casilla.
  const fluidConditions = jsonList(row.fluid_conditions).filter((entry) => entry !== condition);
  db.prepare(
    'UPDATE combatants SET conditions = ?, condition_timers = ?, fluid_conditions = ? WHERE id = ?'
  ).run(
    JSON.stringify(next),
    JSON.stringify(nextTimers),
    JSON.stringify(fluidConditions),
    combatantId
  );
  return { ok: true, conditions: next, timedConditions: nextTimers, added: !has };
}

export function tickConditionsForTurn(campaignId, combatantId, timing) {
  const row = db
    .prepare(
      'SELECT id, name, conditions, condition_timers, fluid_conditions FROM combatants WHERE id = ? AND campaign_id = ?'
    )
    .get(combatantId, campaignId);
  if (!row) return [];

  const result = tickConditionTimers({
    conditions: jsonList(row.conditions),
    timers: row.condition_timers,
    fluidConditions: jsonList(row.fluid_conditions),
    timing,
  });
  db.prepare('UPDATE combatants SET conditions = ?, condition_timers = ? WHERE id = ?').run(
    JSON.stringify(result.conditions),
    JSON.stringify(result.timers),
    row.id
  );
  return result.expired.map((condition) => ({ combatantId: row.id, name: row.name, condition }));
}

// --- Concentración ---------------------------------------------------------

// Marca (o levanta, con spell = null) la concentración de un combatiente. Se
// guarda el nombre del hechizo porque al fallar la salvación la mesa necesita
// saber qué se acaba de caer, no solo que "algo" se cayó.
export function setConcentration(campaignId, combatantId, spell) {
  const row = db
    .prepare('SELECT id FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  const clean = typeof spell === 'string' && spell.trim() ? spell.trim().slice(0, 60) : null;
  db.prepare('UPDATE combatants SET concentration_spell = ? WHERE id = ?').run(clean, combatantId);
  return { ok: true, spell: clean };
}

// Pone a un combatiente PJ "agonizando": 0 salvaciones de muerte pendientes.
// Se llama al caer a 0 PG. Idempotente si ya estaba agonizando con marcas.
export function startDeathSaves(combatantId) {
  db.prepare(
    "UPDATE combatants SET death_state = 'dying', death_successes = 0, death_failures = 0, death_save_round = NULL WHERE id = ?"
  ).run(combatantId);
}

export function resetDeathSaves(combatantId) {
  db.prepare(
    "UPDATE combatants SET death_state = 'normal', death_successes = 0, death_failures = 0, death_save_round = NULL WHERE id = ?"
  ).run(combatantId);
}

export function recordDamageAtZero(combatantId, { critical = false, massive = false } = {}) {
  const row = db.prepare('SELECT death_state, death_successes, death_failures FROM combatants WHERE id = ?').get(combatantId);
  if (!row) return null;
  const next = damageAtZeroTransition({
    state: row.death_state,
    successes: row.death_successes,
    failures: row.death_failures,
    critical,
    massive,
  });
  db.prepare(
    'UPDATE combatants SET death_state = ?, death_successes = ?, death_failures = ? WHERE id = ?'
  ).run(next.state, next.successes, next.failures, combatantId);
  return next;
}

// Registra una salvación de muerte a partir de un d20 ya tirado por el cliente
// (mismo patrón que atacar: el cliente tira, el servidor decide). Aplica las
// reglas 5e: 20 natural → recupera 1 PG; 1 natural → 2 fallos; ≥10 → éxito;
// <10 → fallo. Con 3 éxitos se estabiliza; con 3 fallos, muere. Devuelve el
// estado y un texto para narrar. No toca los PG salvo el 20 natural (lo hace
// quien llama, que tiene el characterId).
export function recordDeathSave(campaignId, combatantId, d20) {
  const row = db
    .prepare("SELECT * FROM combatants WHERE id = ? AND campaign_id = ? AND kind = 'pj'")
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  const result = resolveDeathSave(
    {
      state: row.death_state,
      successes: row.death_successes,
      failures: row.death_failures,
    },
    d20
  );
  if (!result.ok) return result;
  const round = db.prepare('SELECT combat_round FROM game_tables WHERE campaign_id = ?').get(campaignId)?.combat_round;
  db.prepare(
    'UPDATE combatants SET death_state = ?, death_successes = ?, death_failures = ?, death_save_round = ? WHERE id = ?'
  ).run(result.state, result.successes, result.failures, round ?? null, combatantId);
  return { ...result, characterId: row.character_id };
}

// Gasta la acción del turno de un combatiente por su id directo (a
// diferencia de trySpendAction, que solo vale para un PJ por characterId):
// usado por el ataque de un enemigo/aliado controlado por el DM. Sin modo
// por turnos, o si el combatiente no está en el tracker, no hay economía
// que aplicar (se deja actuar libre, mismo criterio que el resto de casos
// "no bloqueados" de este módulo).
export function trySpendActionForCombatant(campaignId, combatantId) {
  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: true };
  if (table.combat_turn_id !== combatantId) return { ok: false, error: 'No es el turno de este combatiente' };
  const row = db
    .prepare('SELECT action_used, conditions FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: true };
  if (conditionsPreventActions(row.conditions)) {
    return { ok: false, error: 'Las condiciones actuales impiden realizar acciones' };
  }
  if (row.action_used) return { ok: false, error: 'Ya se ha usado la acción de este combatiente este turno' };
  db.prepare('UPDATE combatants SET action_used = 1 WHERE id = ?').run(combatantId);
  return { ok: true };
}

// Gasta un ataque de monstruo, normal o como parte de un Multiataque SRD.
// El resto de la secuencia persiste para poder cambiar de objetivo entre
// golpes sin convertir la acción en ataques ilimitados.
export function trySpendMonsterAttack(
  campaignId,
  combatantId,
  { actionName, planId = null, plans = [], countOverrides = {} } = {}
) {
  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: true, multiattackState: {} };
  if (table.combat_turn_id !== combatantId) return { ok: false, error: 'No es el turno de este combatiente' };
  const row = db
    .prepare('SELECT action_used, conditions, multiattack_state FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: true, multiattackState: {} };
  if (conditionsPreventActions(row.conditions)) {
    return { ok: false, error: 'Las condiciones actuales impiden realizar acciones' };
  }
  const consumed = consumeMonsterAttack({
    actionUsed: Boolean(row.action_used),
    state: parseMultiattackState(row.multiattack_state),
    actionName,
    planId,
    plans,
    countOverrides,
  });
  if (!consumed.ok) return consumed;
  db.prepare('UPDATE combatants SET action_used = 1, multiattack_state = ? WHERE id = ?').run(
    JSON.stringify(consumed.state),
    combatantId
  );
  return {
    ok: true,
    multiattackState: consumed.state,
    multiattackCompleted: consumed.completed,
    multiattackResolved: consumed.resolvedCounts ?? null,
  };
}

// Gasta la acción adicional del turno: solo el combatiente activo. Como las
// aptitudes de clase son texto libre en la ficha, no se valida si la clase
// realmente otorga una acción adicional: eso lo decide la mesa.
export function tryUseBonusAction(campaignId, combatantId) {
  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: false, error: 'La mesa está en modo libre' };
  if (table.combat_turn_id !== combatantId) return { ok: false, error: 'No es tu turno' };
  const row = db.prepare('SELECT bonus_used, kind, character_id, conditions FROM combatants WHERE id = ?').get(combatantId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  if (row.kind === 'pj' && isPjDowned(row.character_id)) {
    return { ok: false, error: 'Estás inconsciente y no puedes actuar' };
  }
  if (conditionsPreventActions(row.conditions)) {
    return { ok: false, error: 'Las condiciones actuales impiden realizar acciones' };
  }
  if (row.bonus_used) return { ok: false, error: 'Ya has usado tu acción adicional este turno' };
  db.prepare('UPDATE combatants SET bonus_used = 1 WHERE id = ?').run(combatantId);
  return { ok: true };
}

// Gasta la reacción: una por RONDA y utilizable fuera de tu turno (ataques
// de oportunidad automáticos, conjuros de reacción o usos narrados por el DM).
export function tryUseReaction(campaignId, combatantId) {
  const table = db
    .prepare('SELECT combat_active, combat_round FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: false, error: 'La mesa está en modo libre' };
  const row = db
    .prepare('SELECT reaction_used_round, kind, character_id, conditions FROM combatants WHERE id = ?')
    .get(combatantId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  if (row.kind === 'pj' && isPjDowned(row.character_id)) {
    return { ok: false, error: 'Estás inconsciente y no puedes actuar' };
  }
  if (conditionsPreventActions(row.conditions)) {
    return { ok: false, error: 'Las condiciones actuales impiden usar reacciones' };
  }
  if (row.reaction_used_round === table.combat_round) {
    return { ok: false, error: 'Ya has usado tu reacción esta ronda' };
  }
  db.prepare('UPDATE combatants SET reaction_used_round = ? WHERE id = ?').run(
    table.combat_round,
    combatantId
  );
  return { ok: true };
}

// Si ya no queda ningún combatiente de tipo enemigo, se acabó el encuentro:
// vuelve a movimiento libre sola. Devuelve true si acaba de desactivarse
// (para que quien llame decida si avisar por el chat).
export function endCombatIfNoEnemiesLeft(campaignId) {
  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM combatants WHERE campaign_id = ? AND kind = 'enemigo' AND (hp_current IS NULL OR hp_current > 0)")
    .get(campaignId).n;
  if (remaining > 0) return false;

  const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
  if (!table?.combat_active) return false;

  deactivateTurnMode(campaignId);
  return true;
}
