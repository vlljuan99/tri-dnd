import test from 'node:test';
import assert from 'node:assert/strict';
import { recordFall, recordFinalBlow, recordRoll, summaryForPlayer, takeSummary } from '../combatLedger.js';

const attack = (actorName, resultado) => ({ kind: 'attack', actorName, total: 15, outcome: { tipo: 'ataque', resultado } });
const damage = (actorName, total) => ({ kind: 'damage', actorName, total });

test('el resumen cuenta daño, críticos, pifias, golpes finales y caídos', () => {
  const campaign = 9001;
  recordRoll(campaign, attack('Aria', 'critico'));
  recordRoll(campaign, damage('Aria', 14));
  recordRoll(campaign, attack('Aria', 'impacta'));
  recordRoll(campaign, damage('Aria', 6));
  recordRoll(campaign, attack('Bruno', 'pifia'));
  recordRoll(campaign, attack('Goblin', 'impacta'));
  recordRoll(campaign, damage('Goblin', 7));
  recordRoll(campaign, { kind: 'check', actorName: 'Aria', total: 12 });
  recordFinalBlow(campaign, { by: 'Aria', target: 'Goblin' });
  recordFall(campaign, 'Bruno');
  recordFall(campaign, 'Bruno');

  const summary = takeSummary(campaign, { pcNames: ['Aria', 'Bruno'], rounds: 3 });
  assert.equal(summary.rounds, 3);
  assert.deepEqual(summary.party.map((entry) => [entry.name, entry.damage, entry.crits, entry.fumbles]), [
    ['Aria', 20, 1, 0],
    ['Bruno', 0, 0, 1],
  ]);
  assert.deepEqual(summary.enemies.map((entry) => [entry.name, entry.damage]), [['Goblin', 7]]);
  assert.deepEqual(summary.finalBlows, [{ by: 'Aria', target: 'Goblin' }]);
  assert.deepEqual(summary.fallen, ['Bruno'], 'un caído cuenta una vez');

  const forPlayer = summaryForPlayer(summary);
  assert.equal(forPlayer.enemies, undefined, 'los números de los enemigos son del DM');
  assert.equal(takeSummary(campaign, { pcNames: ['Aria'] }), null, 'se olvida al resumirlo');
});

test('un combate sin nada que contar no produce tarjeta', () => {
  assert.equal(takeSummary(424242, { pcNames: ['Aria'] }), null);
});
