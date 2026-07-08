import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useRoom } from '../store/socket.js';
import { abilityModifier } from '../lib/dnd.js';
import { rollPool } from '../lib/dice.js';
import SrdPicker from './SrdPicker.jsx';
import MonsterStatBlock from './MonsterStatBlock.jsx';

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

  useEffect(() => {
    api(`/campaigns/${campaignId}`)
      .then(({ characters }) => {
        const map = {};
        for (const c of characters) map[c.id] = c.user_id;
        setOwnerByCharId(map);
      })
      .catch(() => {});
  }, [campaignId]);

  async function rollOwnInitiative(combatant) {
    try {
      const { character } = await api(`/characters/${combatant.characterId}`);
      const mod = abilityModifier(character.abilities.dex);
      const roll = rollPool({ d20: 1 }, { modifier: mod, kind: 'check', label: 'Iniciativa', actorName: character.name });
      room.sendRoll(roll);
      room.setInitiative(combatant.id, roll.total);
    } catch {
      // Si falla, el jugador puede pedir al DM que introduzca el valor
    }
  }

  function submitAdd(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    room.addCombatant({
      kind: 'enemigo',
      name,
      initiative: form.initiative === '' ? 0 : Number(form.initiative),
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
                onClick={() => room.toggleTurnMode()}
                title="Activa el modo por turnos: iniciativas nuevas y movimiento/acción solo en tu turno"
                className="rounded-sm border border-moss px-2 py-0.5 text-xs text-bone hover:bg-moss/20"
              >
                Por turnos
              </button>
            ) : (
              <>
                <button
                  onClick={() => room.nextTurn()}
                  className="rounded-sm border border-gold/50 px-2 py-0.5 text-xs text-gold hover:bg-gold/10"
                >
                  Siguiente
                </button>
                <button
                  onClick={() => room.toggleTurnMode()}
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
          const budget = c.speed ? Math.floor(c.speed / 5) : null;
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
                  <span className="font-mono text-xs text-bone/50">Ini {c.initiative}</span>
                  {mine && !isDm && (
                    <button
                      onClick={() => rollOwnInitiative(c)}
                      className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-xs text-gold hover:bg-gold/10"
                    >
                      Tirar
                    </button>
                  )}
                  {isDm && (
                    <>
                      {c.monsterIndex && (
                        <button
                          onClick={() => setStatBlockOf({ index: c.monsterIndex, name: c.name })}
                          className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-xs text-gold hover:bg-gold/10"
                        >
                          Ficha
                        </button>
                      )}
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
                  <span className="shrink-0 font-mono text-xs text-bone/50">
                    {c.hpCurrent}/{c.hpMax}
                    {c.ac != null && ` · CA ${c.ac}`}
                  </span>
                </div>
              )}

              {/* Recursos del turno (Fase 8.5): visibles con el modo por turnos */}
              {combat.active && active && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-bone/10 pt-1.5">
                  {c.kind === 'pj' && budget != null && (
                    <span
                      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[0.65rem] ${
                        c.movedSquares >= budget ? 'border-bone/10 text-bone/30' : 'border-moss/60 text-bone/80'
                      }`}
                      title="Casillas de movimiento gastadas este turno"
                    >
                      Mov {c.movedSquares}/{budget}
                    </span>
                  )}
                  <span
                    className={`rounded-sm border px-1.5 py-0.5 text-[0.65rem] ${
                      c.actionUsed ? 'border-bone/10 text-bone/30 line-through' : 'border-gold/50 text-gold/90'
                    }`}
                    title="La acción del turno (atacar la consume)"
                  >
                    Acción
                  </span>
                  {(mine || isDm) && !c.bonusUsed ? (
                    <button
                      onClick={() => room.useResource(c.id, 'adicional')}
                      title="Marcar la acción adicional como gastada"
                      className="rounded-sm border border-ochre/60 px-1.5 py-0.5 text-[0.65rem] text-ochre hover:bg-ochre/10"
                    >
                      Adicional
                    </button>
                  ) : (
                    <span
                      className={`rounded-sm border px-1.5 py-0.5 text-[0.65rem] ${
                        c.bonusUsed ? 'border-bone/10 text-bone/30 line-through' : 'border-bone/20 text-bone/50'
                      }`}
                    >
                      Adicional
                    </span>
                  )}
                  {(mine || isDm) && (
                    <button
                      onClick={async () => {
                        const resp = await room.endTurn();
                        if (resp?.error) window.alert(resp.error);
                      }}
                      className="ml-auto rounded-sm bg-gold px-2 py-0.5 font-display text-[0.65rem] uppercase tracking-widest text-night-950 hover:bg-gold/90"
                    >
                      Terminar turno
                    </button>
                  )}
                </div>
              )}
              {/* La reacción se puede gastar fuera de tu turno (una por ronda) */}
              {combat.active && !active && (mine || isDm) && c.kind === 'pj' && (
                <div className="mt-1 flex justify-end">
                  {c.reactionAvailable ? (
                    <button
                      onClick={() => room.useResource(c.id, 'reaccion')}
                      title="Marcar la reacción como gastada (ataque de oportunidad, etc.)"
                      className="rounded-sm border border-bone/25 px-1.5 py-0.5 text-[0.65rem] text-bone/70 hover:border-gold hover:text-gold"
                    >
                      Usar reacción
                    </button>
                  ) : (
                    <span className="rounded-sm border border-bone/10 px-1.5 py-0.5 text-[0.65rem] text-bone/30 line-through">
                      Reacción
                    </span>
                  )}
                </div>
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
                  placeholder="Ini."
                  className="w-16 rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-sm focus:border-gold focus:outline-none"
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
          onClose={() => setStatBlockOf(null)}
        />
      )}
    </div>
  );
}

function EditCombatantForm({ combatant, onSave, onCancel }) {
  const [name, setName] = useState(combatant.name);
  const [initiative, setInitiative] = useState(String(combatant.initiative));
  const [hp, setHp] = useState(combatant.hpCurrent ?? '');
  const [hpMax, setHpMax] = useState(combatant.hpMax ?? '');
  const [ac, setAc] = useState(combatant.ac ?? '');

  function save() {
    onSave(
      {
        name,
        hpCurrent: hp === '' ? undefined : Number(hp),
        hpMax: hpMax === '' ? undefined : Number(hpMax),
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
