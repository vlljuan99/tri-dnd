import { useEffect, useId, useState } from 'react';
import { api } from '../api.js';
import { useRoom } from '../store/socket.js';
import { toastError } from '../store/toast.js';
import { rollPool } from '../lib/dice.js';
import SrdPicker from './SrdPicker.jsx';
import MonsterStatBlock from './MonsterStatBlock.jsx';
import StatTooltip from './StatTooltip.jsx';
import { nextTurnPreview } from '../features/tactical-map/domain/turnOrder.js';
import {
  TurnBadges,
  ConditionChips,
  DeathSaveDots,
  ConditionEditor,
  InitiativeValue,
  ConcentrationChip,
} from '../features/tactical-map/components/CombatantStatus.jsx';

function hpRatioColor(ratio) {
  if (ratio > 0.5) return 'bg-moss';
  if (ratio > 0.2) return 'bg-gold';
  return 'bg-blood';
}

function HpBar({ current, max }) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
  const ratio = Math.max(0, Math.min(1, current / max));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-night-950">
      <div className={`h-full transition-all ${hpRatioColor(ratio)}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/**
 * Tracker de iniciativa de la mesa: orden de turnos, resaltado del turno
 * actual y panel del DM para añadir/editar enemigos y controlar el combate.
 * El HP/CA exacto de los enemigos nunca llega al socket de los jugadores
 * (filtrado en el backend), así que aquí simplemente pintamos lo que llega.
 */
export default function InitiativeTracker({ campaignId, isDm, userId }) {
  const room = useRoom();
  const { combat } = room;
  const [ownerByCharId, setOwnerByCharId] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [form, setForm] = useState({ name: '', initiative: '', hp: '', ac: '', monsterIndex: null });
  const [editingId, setEditingId] = useState(null);
  const [statBlockOf, setStatBlockOf] = useState(null); // { index, name } | null
  const [conditionsFor, setConditionsFor] = useState(null); // combatantId con el editor de condiciones abierto
  const [concentrationFor, setConcentrationFor] = useState(null); // combatantId con el campo de hechizo abierto
  const [startPrompt, setStartPrompt] = useState(null); // { total, withInitiative } al abrir el combate

  useEffect(() => {
    api(`/campaigns/${campaignId}`)
      .then(({ characters }) => {
        const map = {};
        for (const c of characters) map[c.id] = c.user_id;
        setOwnerByCharId(map);
      })
      .catch(() => {});
  }, [campaignId]);

  // Abrir el combate pisa las iniciativas ya tiradas o las respeta: es la
  // única decisión que la mesa no puede tomar sola, así que se pregunta. Si no
  // hay ninguna que conservar, no hay nada que preguntar.
  async function askTurnMode() {
    const summary = await room.initiativeSummary();
    if (summary?.error || !summary.withInitiative) {
      const resp = await room.toggleTurnMode({ rerollAll: true });
      if (resp?.error) toastError(resp.error);
      return;
    }
    setStartPrompt(summary);
  }

  async function startTurnMode(rerollAll) {
    setStartPrompt(null);
    const resp = await room.toggleTurnMode({ rerollAll });
    if (resp?.error) toastError(resp.error);
  }

  async function rollInitiative(combatant) {
    const resp = await room.rollInitiative(combatant.id);
    if (resp?.error) toastError(resp.error);
  }

  async function saveConcentration(combatant, spell) {
    setConcentrationFor(null);
    const resp = await room.setConcentration(combatant.id, spell);
    if (resp?.error) toastError(resp.error);
  }

  async function rollConcentrationSave(combatant) {
    const resp = await room.concentrationSave(combatant.id, 10);
    if (resp?.error) toastError(resp.error);
  }

  async function rollDeathSave(combatant) {
    const roll = rollPool({ d20: 1 }, { kind: 'check', label: 'Salvación de muerte', actorName: combatant.name });
    const natural = roll.groups.find((g) => g.sides === 20)?.results[0]?.kept ?? roll.total;
    const resp = await room.deathSave(combatant.id, roll, natural);
    if (resp?.error) toastError(resp.error);
  }

  function submitAdd(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    room.addCombatant({
      kind: 'enemigo',
      name,
      // Sin número, `undefined`: el servidor tira 1d20 + DES del monstruo. Con
      // 0 (lo que se mandaba antes) el servidor lo tomaba por una iniciativa
      // deliberada y el enemigo entraba mudo al fondo del orden.
      initiative: form.initiative === '' ? undefined : Number(form.initiative),
      hpCurrent: form.hp === '' ? null : Number(form.hp),
      hpMax: form.hp === '' ? null : Number(form.hp),
      ac: form.ac === '' ? null : Number(form.ac),
      monsterIndex: form.monsterIndex,
    });
    setForm({ name: '', initiative: '', hp: '', ac: '', monsterIndex: null });
    setShowAdd(false);
  }

  function pickMonster(entry) {
    setForm({
      name: entry.name,
      initiative: '',
      hp: entry.meta?.hp != null ? String(entry.meta.hp) : '',
      ac: entry.meta?.ac != null ? String(entry.meta.ac) : '',
      monsterIndex: entry.index,
    });
    setShowPicker(false);
    setShowAdd(true);
  }

  // A quién le tocaría al pulsar «Siguiente» y si eso cierra la ronda, para
  // que el DM vea las consecuencias del clic antes de darlo.
  const preview = combat.active
    ? nextTurnPreview(combat.combatants, combat.turnId)
    : { next: null, closesRound: false };
  const nextUp = preview.next;
  const closesRound = preview.closesRound;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gold/15 px-3 py-2">
        <h2 className="font-display text-sm uppercase tracking-widest text-gold/70">
          Iniciativa{combat.active && <span className="ml-1 text-bone/50">· Ronda {combat.round}</span>}
        </h2>
        {isDm && (
          <div className="flex gap-1">
            {!combat.active ? (
              <button
                onClick={askTurnMode}
                title="Activa el modo por turnos: movimiento y acción solo en tu turno"
                className="rounded-sm border border-moss px-2 py-0.5 text-xs text-bone hover:bg-moss/20"
              >
                Por turnos
              </button>
            ) : (
              <>
                <button
                  onClick={() => room.nextTurn()}
                  // Avanzar de turno no tiene vuelta atrás y, al dar la vuelta,
                  // sube la ronda y dispara sus eventos: que se vea antes de pulsar.
                  title={
                    nextUp
                      ? `Pasa el turno a ${nextUp.name}${closesRound ? ` y cierra la ronda ${combat.round}` : ''}`
                      : 'Avanza al siguiente combatiente'
                  }
                  className={`rounded-sm border px-2 py-0.5 text-xs ${
                    closesRound
                      ? 'border-ochre/70 text-ochre hover:bg-ochre/10'
                      : 'border-gold/50 text-gold hover:bg-gold/10'
                  }`}
                >
                  {closesRound ? `Siguiente · cierra ronda ${combat.round}` : 'Siguiente'}
                </button>
                <button
                  onClick={() => startTurnMode(true)}
                  title="Modo libre: moverse y actuar sin restricción de turno, sin vaciar el tracker"
                  className="rounded-sm border border-bone/25 px-2 py-0.5 text-xs text-bone/70 hover:text-bone"
                >
                  Libre
                </button>
                <button
                  onClick={() => room.endCombat()}
                  title="Termina el combate del todo y vacía el tracker"
                  className="rounded-sm border border-blood/50 px-2 py-0.5 text-xs text-blood hover:bg-blood/10"
                >
                  Fin
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {combat.combatants.length === 0 && (
          <p className="pt-4 text-center text-xs italic text-bone/40">Sin combatientes todavía.</p>
        )}
        {combat.combatants.map((c) => {
          const active = combat.turnId === c.id;
          const mine = c.kind === 'pj' && ownerByCharId[c.characterId] === userId;
          const knowsHp = c.hpCurrent != null && c.hpMax != null;
          // Mismo cálculo que el servidor (trySpendMovement / trySpendEnemyMovement):
          // casillas de 5 pies, dobladas al correr. La velocidad de un enemigo solo
          // llega al socket del DM, así que a un jugador le queda en null y no se pinta.
          const budget = c.speed ? Math.floor(c.speed / 5) * (c.dashed ? 2 : 1) : null;
          return (
            <div
              key={c.id}
              className={`rounded-sm border px-2 py-1.5 text-sm ${active ? 'border-gold bg-gold/10' : 'border-bone/15'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate font-display tracking-wide ${c.kind === 'enemigo' ? 'text-blood/90' : 'text-bone'}`}>
                  {c.name}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <TurnBadges combatant={c} />
                  {/* Sin StatTooltip: el glosario y el desglose de la tirada se
                      pisarían el hover, y aquí manda poder auditar el número. */}
                  <InitiativeValue combatant={c} />
                  {(mine || isDm) && (
                    <button
                      onClick={() => rollInitiative(c)}
                      title={
                        c.initiativeSource == null
                          ? 'Tirar iniciativa (1d20 + DES) en el servidor'
                          : 'Volver a tirar la iniciativa: se publicará la nueva tirada'
                      }
                      className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-xs text-gold hover:bg-gold/10"
                    >
                      {c.initiativeSource == null ? 'Tirar' : '↻'}
                    </button>
                  )}
                  {isDm && (
                    <>
                      {c.monsterIndex && (
                        <button
                          onClick={() => setStatBlockOf({ index: c.monsterIndex, name: c.name, overrides: c.overrides ?? {} })}
                          className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-xs text-gold hover:bg-gold/10"
                        >
                          Ficha
                        </button>
                      )}
                      <button
                        onClick={() => setConditionsFor(conditionsFor === c.id ? null : c.id)}
                        className="rounded-sm border border-bone/20 px-1.5 py-0.5 text-xs text-bone/60 hover:text-bone"
                      >
                        Condiciones
                      </button>
                      <button
                        onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                        className="rounded-sm border border-bone/20 px-1.5 py-0.5 text-xs text-bone/60 hover:text-bone"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => room.removeCombatant(c.id)}
                        aria-label={`Quitar a ${c.name}`}
                        className="rounded-sm border border-blood/30 px-1.5 py-0.5 text-xs text-blood/80 hover:bg-blood/10"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
              {knowsHp && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1">
                    <HpBar current={c.hpCurrent} max={c.hpMax} />
                  </div>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-bone/50">
                    <StatTooltip stat="hp">
                      {c.hpCurrent}/{c.hpMax}
                    </StatTooltip>
                    {c.hpTemp > 0 && <span className="text-moss">+{c.hpTemp} temp.</span>}
                    {c.ac != null && (
                      <>
                        ·<StatTooltip stat="ca">CA {c.ac}</StatTooltip>
                      </>
                    )}
                  </span>
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-1">
                <ConcentrationChip spell={c.concentration} />
                {(mine || isDm) && (
                  <button
                    onClick={() => setConcentrationFor(concentrationFor === c.id ? null : c.id)}
                    title="Marca el hechizo al que se concentra: al recibir daño, la mesa verá la CD de la salvación"
                    className="rounded-sm border border-bone/20 px-1 py-0.5 text-[0.6rem] text-bone/50 hover:text-bone"
                  >
                    {c.concentration ? 'Cambiar' : '◎ Concentrar'}
                  </button>
                )}
                {c.concentration && (mine || isDm) && (
                  <button
                    onClick={() => rollConcentrationSave(c)}
                    title="Tira la salvación de Constitución en el servidor (CD 10 por defecto; el aviso de daño trae la CD real)"
                    className="rounded-sm border border-gold/40 px-1 py-0.5 text-[0.6rem] text-gold hover:bg-gold/10"
                  >
                    Salvar
                  </button>
                )}
              </div>

              {concentrationFor === c.id && (
                <ConcentrationForm
                  spell={c.concentration}
                  onSave={(spell) => saveConcentration(c, spell)}
                  onCancel={() => setConcentrationFor(null)}
                />
              )}

              <ConditionChips conditions={c.conditions} />

              {/* PJ muerto de verdad (3 fallos): estado final */}
              {c.dead && (
                <p className="mt-1 text-center font-display text-xs uppercase tracking-widest text-blood">
                  ☠ Muerto
                </p>
              )}

              {/* Salvaciones de muerte de un PJ agonizante */}
              {c.downed && !c.dead && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <DeathSaveDots saves={c.deathSaves} />
                  {(mine || isDm) && (
                    <button
                      onClick={() => rollDeathSave(c)}
                      className="rounded-sm border border-blood/50 px-1.5 py-0.5 text-[0.65rem] text-blood hover:bg-blood/10"
                    >
                      Tirar salvación
                    </button>
                  )}
                </div>
              )}

              {/* Recursos del turno (Fase 8.5): visibles con el modo por turnos */}
              {combat.active && active && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-bone/10 pt-1.5">
                  {/* El presupuesto de movimiento también es del enemigo: el
                      servidor se lo lleva contando (trySpendEnemyMovement), pero
                      antes no se pintaba y el DM solo lo descubría al chocar
                      con el error a mitad de arrastrar el marcador. */}
                  {budget != null && (
                    <StatTooltip
                      stat="mov"
                      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[0.65rem] ${
                        c.movedSquares >= budget ? 'border-bone/10 text-bone/30' : 'border-moss/60 text-bone/80'
                      }`}
                    >
                      Mov {c.movedSquares}/{budget}
                    </StatTooltip>
                  )}
                  <StatTooltip
                    stat="accion"
                    className={`rounded-sm border px-1.5 py-0.5 text-[0.65rem] ${
                      c.actionUsed ? 'border-bone/10 text-bone/30 line-through' : 'border-gold/50 text-gold/90'
                    }`}
                  >
                    Acción
                  </StatTooltip>
                  {(mine || isDm) && !c.bonusUsed ? (
                    <StatTooltip stat="adicional" focusable={false}>
                      <button
                        onClick={() => room.useResource(c.id, 'adicional')}
                        className="rounded-sm border border-ochre/60 px-1.5 py-0.5 text-[0.65rem] text-ochre hover:bg-ochre/10"
                      >
                        Adicional
                      </button>
                    </StatTooltip>
                  ) : (
                    <StatTooltip
                      stat="adicional"
                      className={`rounded-sm border px-1.5 py-0.5 text-[0.65rem] ${
                        c.bonusUsed ? 'border-bone/10 text-bone/30 line-through' : 'border-bone/20 text-bone/50'
                      }`}
                    >
                      Adicional
                    </StatTooltip>
                  )}
                  {(mine || isDm) && (
                    <button
                      onClick={async () => {
                        const resp = await room.endTurn();
                        if (resp?.error) toastError(resp.error);
                      }}
                      className="ml-auto rounded-sm bg-gold px-2 py-0.5 font-display text-[0.65rem] uppercase tracking-widest text-night-950 hover:bg-gold/90"
                    >
                      Terminar turno
                    </button>
                  )}
                </div>
              )}
              {/* La reacción se puede gastar fuera de tu turno (una por ronda).
                  También la de un enemigo: el ataque de oportunidad de un
                  goblin gasta su reacción igual que la de un PJ, y el servidor
                  (tryUseReaction) nunca filtró por tipo — solo faltaba el botón. */}
              {combat.active && !active && (mine || isDm) && (
                <div className="mt-1 flex justify-end">
                  {c.reactionAvailable ? (
                    <StatTooltip stat="reaccion" focusable={false}>
                      <button
                        onClick={() => room.useResource(c.id, 'reaccion')}
                        className="rounded-sm border border-bone/25 px-1.5 py-0.5 text-[0.65rem] text-bone/70 hover:border-gold hover:text-gold"
                      >
                        Usar reacción
                      </button>
                    </StatTooltip>
                  ) : (
                    <StatTooltip stat="reaccion" className="rounded-sm border border-bone/10 px-1.5 py-0.5 text-[0.65rem] text-bone/30 line-through">
                      Reacción
                    </StatTooltip>
                  )}
                </div>
              )}
              {isDm && conditionsFor === c.id && (
                <ConditionEditor
                  conditions={c.conditions}
                  onToggle={async (key) => {
                    const resp = await room.toggleCondition(c.id, key);
                    if (resp?.error) toastError(resp.error);
                  }}
                />
              )}
              {isDm && editingId === c.id && (
                <EditCombatantForm
                  combatant={c}
                  onSave={(patch, initiative) => {
                    room.updateCombatant(c.id, patch);
                    if (initiative !== c.initiative) room.setInitiative(c.id, initiative);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {isDm && (
        <div className="border-t border-gold/15 p-2">
          {!showAdd ? (
            <div className="flex gap-2">
              <button
                onClick={() => room.addParty()}
                className="flex-1 rounded-sm border border-bone/20 py-1.5 text-xs text-bone/80 hover:bg-bone/5"
              >
                + Grupo
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex-1 rounded-sm border border-gold/40 py-1.5 text-xs text-gold hover:bg-gold/10"
              >
                + Enemigo
              </button>
            </div>
          ) : (
            <form onSubmit={submitAdd} className="space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nombre"
                  className="min-w-0 flex-1 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm placeholder:text-bone/30 focus:border-gold focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="shrink-0 rounded-sm border border-bone/20 px-2 text-xs text-bone/70 hover:text-bone"
                >
                  SRD
                </button>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={form.initiative}
                  onChange={(e) => setForm((f) => ({ ...f, initiative: e.target.value }))}
                  placeholder="Ini. auto"
                  title="En blanco: el servidor tira 1d20 + DES del monstruo y lo publica en el chat"
                  className="w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm placeholder:text-bone/30 focus:border-gold focus:outline-none"
                />
                <input
                  type="number"
                  value={form.hp}
                  onChange={(e) => setForm((f) => ({ ...f, hp: e.target.value }))}
                  placeholder="PG"
                  className="w-16 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
                />
                <input
                  type="number"
                  value={form.ac}
                  onChange={(e) => setForm((f) => ({ ...f, ac: e.target.value }))}
                  placeholder="CA"
                  className="w-16 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  className="flex-1 rounded-sm bg-gold py-1 font-display text-xs tracking-wide text-night-950 hover:bg-gold/90"
                >
                  Añadir
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-sm border border-bone/20 px-2 text-xs text-bone/60 hover:text-bone"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {showPicker && (
        <SrdPicker
          title="Elegir monstruo"
          category="monsters"
          onPick={pickMonster}
          onClose={() => setShowPicker(false)}
          renderMeta={(entry) => (entry.meta?.cr != null ? `DR ${entry.meta.cr}` : '')}
        />
      )}

      {statBlockOf && (
        <MonsterStatBlock
          index={statBlockOf.index}
          name={statBlockOf.name}
          overrides={statBlockOf.overrides}
          onClose={() => setStatBlockOf(null)}
        />
      )}

      {startPrompt && (
        <StartCombatDialog
          summary={startPrompt}
          onChoose={startTurnMode}
          onCancel={() => setStartPrompt(null)}
        />
      )}
    </div>
  );
}

/**
 * Qué hacer con las iniciativas ya tiradas al abrir el combate. Antes se
 * pisaban siempre y en silencio, que arruinaba el flujo clásico de mesa
 * («¡iniciativa!», todos tiran, el DM arranca): el jugador veía su 18 en el
 * chat y un 7 en el tracker.
 *
 * No usa ConfirmationDialog porque aquí hay tres salidas y no dos: cancelar
 * (Escape) tiene que dejar la mesa como estaba, no arrancar el combate de una
 * forma u otra.
 */
function StartCombatDialog({ summary, onChoose, onCancel }) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-lg border border-ochre/45 bg-parchment-100 text-ink shadow-2xl shadow-black/50"
      >
        <div className="border-b border-ochre/25 bg-ochre/10 px-5 py-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-ochre">
            Cambio visible en la mesa
          </p>
          <h2 id={titleId} className="mt-1 font-display text-2xl text-ink">
            Abrir el combate
          </h2>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-ink/70">
            {summary.withInitiative} de {summary.total} combatientes ya tienen iniciativa.
            El servidor tirará 1d20 + DES por quien haga falta y publicará cada tirada en el chat.
          </p>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onChoose(false)}
              className="w-full rounded-sm border border-ochre/40 bg-ochre/5 px-4 py-3 text-left hover:bg-ochre/15"
            >
              <span className="block font-display text-base text-ink">Respetar las existentes</span>
              <span className="block text-xs text-ink/60">
                Tira solo por los {summary.total - summary.withInitiative} que aún no tienen.
              </span>
            </button>
            <button
              type="button"
              onClick={() => onChoose(true)}
              className="w-full rounded-sm border border-ink/20 px-4 py-3 text-left hover:bg-ink/5"
            >
              <span className="block font-display text-base text-ink">Tirar por todos</span>
              <span className="block text-xs text-ink/60">
                Empieza de cero: pisa también lo que hayan tirado los jugadores.
              </span>
            </button>
          </div>

          <div className="flex justify-end border-t border-ochre/20 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm border border-ink/25 px-4 py-2 font-display text-sm text-ink/70 hover:bg-ink/5"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Qué hechizo se concentra. Texto libre y no un selector del compendio: los
// rasgos y hechizos de la ficha ya son texto libre en esta app, y el DM
// necesita poder escribir «el ritual del altar» sin que exista en el SRD.
function ConcentrationForm({ spell, onSave, onCancel }) {
  const [value, setValue] = useState(spell ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
      className="mt-1 flex gap-1.5 border-t border-bone/10 pt-1.5"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Bendición, Enredar…"
        maxLength={60}
        className="min-w-0 flex-1 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-xs placeholder:text-bone/30 focus:border-gold focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-sm bg-gold px-2 py-1 font-display text-[0.65rem] tracking-wide text-night-950 hover:bg-gold/90"
      >
        Guardar
      </button>
      {spell && (
        <button
          type="button"
          onClick={() => onSave(null)}
          title="Dejar de concentrarse"
          className="shrink-0 rounded-sm border border-blood/40 px-2 py-1 text-[0.65rem] text-blood hover:bg-blood/10"
        >
          Soltar
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-sm border border-bone/20 px-2 py-1 text-[0.65rem] text-bone/60 hover:text-bone"
      >
        ✕
      </button>
    </form>
  );
}

function EditCombatantForm({ combatant, onSave, onCancel }) {
  const [name, setName] = useState(combatant.name);
  const [initiative, setInitiative] = useState(String(combatant.initiative));
  const [hp, setHp] = useState(combatant.hpCurrent ?? '');
  const [hpMax, setHpMax] = useState(combatant.hpMax ?? '');
  const [hpTemp, setHpTemp] = useState(combatant.hpTemp ?? 0);
  const [ac, setAc] = useState(combatant.ac ?? '');

  function save() {
    onSave(
      {
        name,
        hpCurrent: hp === '' ? undefined : Number(hp),
        hpMax: hpMax === '' ? undefined : Number(hpMax),
        hpTemp: hpTemp === '' ? undefined : Number(hpTemp),
        ac: ac === '' ? undefined : Number(ac),
      },
      Number(initiative)
    );
  }

  return (
    <div className="mt-2 space-y-1.5 border-t border-bone/10 pt-2">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
        />
        <input
          type="number"
          value={initiative}
          onChange={(e) => setInitiative(e.target.value)}
          className="w-14 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        <input
          type="number"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          placeholder="PG actual"
          className="w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
        />
        <input
          type="number"
          value={hpMax}
          onChange={(e) => setHpMax(e.target.value)}
          placeholder="PG máx."
          className="w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
        />
        <input
          type="number"
          min="0"
          value={hpTemp}
          onChange={(e) => setHpTemp(e.target.value)}
          placeholder="PG temp."
          className="w-20 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
        />
        {combatant.kind === 'enemigo' && (
          <input
            type="number"
            value={ac}
            onChange={(e) => setAc(e.target.value)}
            placeholder="CA"
            className="w-16 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
          />
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={save}
          className="flex-1 rounded-sm bg-gold py-1 font-display text-xs tracking-wide text-night-950 hover:bg-gold/90"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm border border-bone/20 px-2 text-xs text-bone/60 hover:text-bone"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
