import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useRoom } from '../store/socket.js';
import { formatModifier } from '../lib/dnd.js';
import { rollAttack, rollDamage } from '../lib/dice.js';

const ABILITY_FIELDS = [
  ['strength', 'FUE'],
  ['dexterity', 'DES'],
  ['constitution', 'CON'],
  ['intelligence', 'INT'],
  ['wisdom', 'SAB'],
  ['charisma', 'CAR'],
];

function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

// Notación del SRD tipo "1d6+2" (dados y modificador ya sumados en un string)
function parseDamageDice(str) {
  const m = /^(\d+)d(\d+)\s*(?:\+\s*(\d+))?$/i.exec(String(str).trim());
  if (!m) return null;
  return { dice: `${m[1]}d${m[2]}`, modifier: m[3] ? Number(m[3]) : 0 };
}

function ActionRow({ action, monsterName, onRoll }) {
  const canRoll = Number.isInteger(action.attack_bonus) && action.damage?.length > 0;

  return (
    <div className="rounded-sm border border-bone/10 bg-night-950/50 p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-bone">{action.name}</span>
        {canRoll && <span className="font-mono text-xs text-bone/60">{formatModifier(action.attack_bonus)}</span>}
      </div>
      {action.desc && <p className="mt-0.5 text-xs text-bone/60">{action.desc}</p>}
      {canRoll && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => onRoll(rollAttack(action.attack_bonus, { advantage: 'dis', label: `${monsterName} — ${action.name}` }))}
            className="rounded-sm border border-blood/50 px-2 py-0.5 text-xs text-blood hover:bg-blood/10"
          >
            Desv.
          </button>
          <button
            onClick={() => onRoll(rollAttack(action.attack_bonus, { label: `${monsterName} — ${action.name}` }))}
            className="rounded-sm border border-gold/50 px-2 py-0.5 text-xs text-gold hover:bg-gold/10"
          >
            Atacar
          </button>
          <button
            onClick={() => onRoll(rollAttack(action.attack_bonus, { advantage: 'adv', label: `${monsterName} — ${action.name}` }))}
            className="rounded-sm border border-moss px-2 py-0.5 text-xs text-bone/90 hover:bg-moss/20"
          >
            Vent.
          </button>
          <span className="mx-1 text-bone/20">|</span>
          {action.damage.map((d, i) => {
            const parsed = parseDamageDice(d.damage_dice);
            if (!parsed) return null;
            const typeName = d.damage_type?.name ?? '';
            return (
              <span key={i} className="flex gap-1.5">
                <button
                  onClick={() =>
                    onRoll(
                      rollDamage(parsed.dice, {
                        modifier: parsed.modifier,
                        label: `${monsterName} — ${action.name}${typeName ? ` (${typeName})` : ''}`,
                      })
                    )
                  }
                  className="rounded-sm border border-bone/30 px-2 py-0.5 text-xs hover:bg-bone/10"
                >
                  Daño
                </button>
                <button
                  onClick={() =>
                    onRoll(
                      rollDamage(parsed.dice, {
                        modifier: parsed.modifier,
                        crit: true,
                        label: `${monsterName} — ${action.name}${typeName ? ` (${typeName})` : ''} crítico`,
                      })
                    )
                  }
                  className="rounded-sm border border-gold/40 px-2 py-0.5 text-xs text-gold/90 hover:bg-gold/10"
                >
                  ¡Crítico!
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Ficha de un enemigo del compendio SRD para el DM: estadísticas básicas y
 * botones para tirar sus ataques (impacto y daño, con ventaja/desventaja y
 * crítico), compartidos en el registro de la mesa como cualquier otra tirada.
 */
export default function MonsterStatBlock({ index, name, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const sendRoll = useRoom((s) => s.sendRoll);

  useEffect(() => {
    setData(null);
    setError('');
    api(`/srd/monsters/${index}`)
      .then((entry) => setData(entry.data))
      .catch(() => setError('No se pudo cargar la ficha del monstruo'));
  }, [index]);

  function onRoll(roll) {
    if (!roll) return;
    sendRoll(roll);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-lg border border-gold/25 bg-night-900 p-4 text-bone sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg tracking-wide text-gold">{name}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="px-2 text-bone/60 hover:text-bone">
            ✕
          </button>
        </div>

        {error && <p className="py-6 text-center text-blood">{error}</p>}
        {!data && !error && <p className="py-6 text-center text-bone/50">Cargando…</p>}

        {data && (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
              {ABILITY_FIELDS.map(([key, short]) => (
                <div key={key} className="rounded-sm border border-bone/15 py-1.5">
                  <div className="text-xs uppercase tracking-wider text-bone/50">{short}</div>
                  <div className="font-mono">
                    {data[key]} ({formatModifier(abilityMod(data[key]))})
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-bone/60">
              <span>CA {data.armor_class?.[0]?.value ?? '—'}</span>
              <span>
                PG {data.hit_points}
                {data.hit_dice ? ` (${data.hit_dice})` : ''}
              </span>
              {data.speed && (
                <span>Vel. {Object.entries(data.speed).map(([k, v]) => `${k} ${v}`).join(', ')}</span>
              )}
            </div>

            {data.special_abilities?.length > 0 && (
              <div className="mb-3 space-y-1.5">
                <h3 className="font-display text-sm uppercase tracking-widest text-gold/70">Rasgos</h3>
                {data.special_abilities.map((a, i) => (
                  <div key={i} className="rounded-sm border border-bone/10 bg-night-950/50 p-2">
                    <span className="font-medium">{a.name}</span>
                    {a.desc && <p className="mt-0.5 text-xs text-bone/60">{a.desc}</p>}
                  </div>
                ))}
              </div>
            )}

            {data.actions?.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="font-display text-sm uppercase tracking-widest text-gold/70">Acciones</h3>
                {data.actions.map((a, i) => (
                  <ActionRow key={i} action={a} monsterName={name} onRoll={onRoll} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
