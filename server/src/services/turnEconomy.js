import { db } from '../db.js';

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
  db.prepare('UPDATE combatants SET moved_squares = 0, action_used = 0, bonus_used = 0 WHERE id = ?').run(
    combatantId
  );
}

// Marca a un combatiente como el que actúa ahora y resetea sus recursos del
// turno (la reacción no se resetea aquí: es por ronda, no por turno).
export function startTurnFor(campaignId, combatantId, round) {
  db.prepare('UPDATE game_tables SET combat_turn_id = ?, combat_round = ? WHERE campaign_id = ?').run(
    combatantId,
    round,
    campaignId
  );
  resetCombatantResources(combatantId);
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
     reaction_used_round = NULL WHERE campaign_id = ?`
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

// ¿Puede este personaje moverse/actuar ahora mismo?
// - Modo libre (combat_active = 0): siempre sí, sin gasto de recursos.
// - Modo por turnos pero el personaje no está en el tracker todavía: se
//   permite igualmente (no debería pasar tras ensureCombatantForCharacter,
//   pero un tracker vaciado a mano por el DM no debe dejar a nadie bloqueado).
// - Modo por turnos y el personaje sí está en el tracker: solo en su turno.
function checkTurn(campaignId, characterId) {
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
  const budget = Math.floor((character?.speed ?? 30) / 5);
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
  const budget = Math.floor(speedFeet / 5);
  const nextTotal = combatant.moved_squares + squares;
  if (nextTotal > budget) {
    const left = Math.max(0, budget - combatant.moved_squares);
    return { ok: false, error: `Sin movimiento suficiente (le quedan ${left} casillas este turno)` };
  }
  db.prepare('UPDATE combatants SET moved_squares = ? WHERE id = ?').run(nextTotal, combatant.id);
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
  const row = db.prepare('SELECT bonus_used FROM combatants WHERE id = ?').get(combatantId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
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
  const row = db.prepare('SELECT reaction_used_round FROM combatants WHERE id = ?').get(combatantId);
  if (!row) return { ok: false, error: 'Combatiente no encontrado' };
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
