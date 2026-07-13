import { db } from '../db.js';
import { fireRoundEvents } from './events.js';

// Economía de turno de verdad (Fase 8.5): con el modo por turnos activo
// (game_tables.combat_active), moverse y actuar en el tablero solo es
// posible en tu turno, con un presupuesto de movimiento y una acción por
// turno (más una acción adicional y una reacción por ronda, gestionadas
// aparte). Este módulo no sabe nada de sockets ni de mensajes de chat: solo
// datos y reglas; quien lo llama decide qué avisar y a quién.

function abilityModifier(score) {
  return Math.floor((Number(score) - 10) / 2);
}

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

export function rollInitiativeValue(row) {
  return rollD20() + dexModifierForCombatant(row);
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

export function resetCombatantResources(combatantId) {
  // Correr (dashed) y la postura (stance) son recursos del turno: se olvidan
  // al empezar el siguiente, igual que el movimiento/acción. Las condiciones
  // y las salvaciones de muerte NO se tocan aquí (persisten entre turnos).
  db.prepare(
    'UPDATE combatants SET moved_squares = 0, action_used = 0, bonus_used = 0, dashed = 0, stance = NULL WHERE id = ?'
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
  if (Number.isInteger(previousRound) && round > previousRound) {
    fireRoundEvents(campaignId, round);
  }
}

// Si el modo por turnos está activo y no hay nadie actuando (mesa recién
// activada, o el tracker estaba vacío y acaba de entrar el primero), arranca
// con el primero por iniciativa sin tocar la ronda en curso.
export function ensureTurnStarted(campaignId) {
  const table = db
    .prepare('SELECT combat_active, combat_turn_id, combat_round FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active || table.combat_turn_id) return;
  const list = orderedCombatants(campaignId);
  if (!list.length) return;
  startTurnFor(campaignId, list[0].id, table.combat_round ?? 1);
}

// Activa el modo por turnos como arranque fresco de encuentro: tira
// iniciativa para todos los presentes (pisa cualquier valor anterior),
// resetea los recursos de todos (incluida la reacción: es una ronda 1
// nueva) y empieza por el primero. Devuelve el orden final.
export function activateTurnMode(campaignId) {
  db.prepare('UPDATE game_tables SET combat_active = 1 WHERE campaign_id = ?').run(campaignId);
  db.prepare(
    `UPDATE combatants SET moved_squares = 0, action_used = 0, bonus_used = 0,
     dashed = 0, stance = NULL, reaction_used_round = NULL WHERE campaign_id = ?`
  ).run(campaignId);
  for (const c of orderedCombatants(campaignId)) {
    db.prepare('UPDATE combatants SET initiative = ? WHERE id = ?').run(rollInitiativeValue(c), c.id);
  }
  const fresh = orderedCombatants(campaignId);
  if (fresh.length) startTurnFor(campaignId, fresh[0].id, 1);
  else db.prepare('UPDATE game_tables SET combat_round = 1, combat_turn_id = NULL WHERE campaign_id = ?').run(campaignId);
  return fresh;
}

// Modo libre: se desactiva el bloqueo de movimiento/acción sin borrar el
// tracker (a diferencia de terminar el combate del todo, que sí lo vacía).
export function deactivateTurnMode(campaignId) {
  db.prepare('UPDATE game_tables SET combat_active = 0, combat_turn_id = NULL WHERE campaign_id = ?').run(
    campaignId
  );
}

// Añade un personaje al tracker si aún no está (mismo patrón que los
// enemigos al revelarse su sala): tira iniciativa si el modo ya está activo,
// y arranca el turno si el tracker estaba vacío. Devuelve true si lo insertó.
export function ensureCombatantForCharacter(campaignId, characterId) {
  const existing = db
    .prepare("SELECT id FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
    .get(campaignId, characterId);
  if (existing) return false;

  const character = db.prepare('SELECT id, name FROM characters WHERE id = ?').get(characterId);
  if (!character) return false;

  const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
  const initiative = table?.combat_active
    ? rollInitiativeValue({ kind: 'pj', character_id: characterId })
    : 0;
  db.prepare("INSERT INTO combatants (campaign_id, character_id, kind, name, initiative) VALUES (?, ?, 'pj', ?, ?)").run(
    campaignId,
    characterId,
    character.name,
    initiative
  );
  ensureTurnStarted(campaignId);
  return true;
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
  if (!table?.combat_active) return { ok: true, combatant: null, gated: false };

  const combatant = db
    .prepare("SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'pj' AND character_id = ?")
    .get(campaignId, characterId);
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

// Condiciones de combate reconocidas (5e básicas + inconsciente/muerto). El
// cliente muestra su icono/etiqueta; la app no aplica ningún efecto mecánico
// automático (la mesa las narra), solo las lleva como estado del combatiente.
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
// Destrabarse). Solo el combatiente activo, y solo si aún no ha actuado.
// - 'correr' dobla el presupuesto de movimiento (marca dashed).
// - 'esquivar'/'destrabarse' fijan la postura (informativa; el DM narra su
//   efecto sobre reacciones y ataques de oportunidad, sin autodetección).
export function trySpecialAction(campaignId, combatantId, kind) {
  const valid = { correr: 'dash', esquivar: 'esquivar', destrabarse: 'destrabarse' };
  if (!valid[kind]) return { ok: false, error: 'Acción no válida' };
  const table = db
    .prepare('SELECT combat_active, combat_turn_id FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: false, error: 'La mesa está en modo libre' };
  if (table.combat_turn_id !== combatantId) return { ok: false, error: 'No es tu turno' };
  const row = db
    .prepare('SELECT action_used, kind, character_id FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  if (row.kind === 'pj' && isPjDowned(row.character_id)) {
    return { ok: false, error: 'Estás inconsciente y no puedes actuar' };
  }
  if (row.action_used) return { ok: false, error: 'Ya has usado tu acción este turno' };

  if (kind === 'correr') {
    db.prepare('UPDATE combatants SET action_used = 1, dashed = 1 WHERE id = ?').run(combatantId);
  } else {
    db.prepare('UPDATE combatants SET action_used = 1, stance = ? WHERE id = ?').run(kind, combatantId);
  }
  return { ok: true };
}

// Alterna una condición del combatiente (la pone si no está, la quita si sí).
// Persiste entre turnos: la gestiona el DM a mano. Devuelve la lista resultante.
export function toggleCondition(campaignId, combatantId, condition) {
  if (!COMBAT_CONDITIONS.includes(condition)) return { ok: false, error: 'Condición no válida' };
  const row = db
    .prepare('SELECT conditions FROM combatants WHERE id = ? AND campaign_id = ?')
    .get(combatantId, campaignId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  let list;
  try {
    list = JSON.parse(row.conditions || '[]');
  } catch {
    list = [];
  }
  const has = list.includes(condition);
  const next = has ? list.filter((c) => c !== condition) : [...list, condition];
  db.prepare('UPDATE combatants SET conditions = ? WHERE id = ?').run(JSON.stringify(next), combatantId);
  return { ok: true, conditions: next, added: !has };
}

// Pone a un combatiente PJ "agonizando": 0 salvaciones de muerte pendientes.
// Se llama al caer a 0 PG. Idempotente si ya estaba agonizando con marcas.
export function startDeathSaves(combatantId) {
  db.prepare('UPDATE combatants SET death_successes = 0, death_failures = 0 WHERE id = ?').run(combatantId);
}

export function resetDeathSaves(combatantId) {
  startDeathSaves(combatantId);
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
  const natural = Math.max(1, Math.min(20, Math.round(Number(d20)) || 1));

  let successes = row.death_successes;
  let failures = row.death_failures;
  let outcome;

  if (natural === 20) {
    successes = 0;
    failures = 0;
    outcome = 'revive'; // recupera 1 PG (lo aplica el llamador sobre la ficha)
  } else if (natural === 1) {
    failures = Math.min(3, failures + 2);
    outcome = failures >= 3 ? 'muere' : 'fallo';
  } else if (natural >= 10) {
    successes = Math.min(3, successes + 1);
    outcome = successes >= 3 ? 'estable' : 'exito';
  } else {
    failures = Math.min(3, failures + 1);
    outcome = failures >= 3 ? 'muere' : 'fallo';
  }

  if (outcome === 'estable') {
    successes = 0;
    failures = 0;
  }
  db.prepare('UPDATE combatants SET death_successes = ?, death_failures = ? WHERE id = ?').run(
    successes,
    failures,
    combatantId
  );
  return { ok: true, outcome, successes, failures, natural, characterId: row.character_id };
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
  const row = db.prepare('SELECT action_used FROM combatants WHERE id = ? AND campaign_id = ?').get(combatantId, campaignId);
  if (!row) return { ok: true };
  if (row.action_used) return { ok: false, error: 'Ya se ha usado la acción de este combatiente este turno' };
  db.prepare('UPDATE combatants SET action_used = 1 WHERE id = ?').run(combatantId);
  return { ok: true };
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
  const row = db.prepare('SELECT bonus_used, kind, character_id FROM combatants WHERE id = ?').get(combatantId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  if (row.kind === 'pj' && isPjDowned(row.character_id)) {
    return { ok: false, error: 'Estás inconsciente y no puedes actuar' };
  }
  if (row.bonus_used) return { ok: false, error: 'Ya has usado tu acción adicional este turno' };
  db.prepare('UPDATE combatants SET bonus_used = 1 WHERE id = ?').run(combatantId);
  return { ok: true };
}

// Gasta la reacción: una por RONDA y utilizable fuera de tu turno (ataques
// de oportunidad y similares, narrados por el DM — sin detección automática).
export function tryUseReaction(campaignId, combatantId) {
  const table = db
    .prepare('SELECT combat_active, combat_round FROM game_tables WHERE campaign_id = ?')
    .get(campaignId);
  if (!table?.combat_active) return { ok: false, error: 'La mesa está en modo libre' };
  const row = db
    .prepare('SELECT reaction_used_round, kind, character_id FROM combatants WHERE id = ?')
    .get(combatantId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
  if (row.kind === 'pj' && isPjDowned(row.character_id)) {
    return { ok: false, error: 'Estás inconsciente y no puedes actuar' };
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
    .prepare("SELECT COUNT(*) AS n FROM combatants WHERE campaign_id = ? AND kind = 'enemigo'")
    .get(campaignId).n;
  if (remaining > 0) return false;

  const table = db.prepare('SELECT combat_active FROM game_tables WHERE campaign_id = ?').get(campaignId);
  if (!table?.combat_active) return false;

  deactivateTurnMode(campaignId);
  return true;
}
