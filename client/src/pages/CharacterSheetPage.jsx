import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  ABILITIES,
  SKILLS,
  SCHOOL_NAMES,
  abilityModifier,
  proficiencyBonus,
  formatModifier,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDC,
} from '../lib/dnd.js';
import { rollAttack } from '../lib/dice.js';
import { castSpellRoll } from '../lib/spellcasting.js';
import { uploadCharacterAvatar, generateCharacterAvatar, removeCharacterAvatar } from '../lib/characterAvatar.js';
import { useCharacter } from '../hooks/useCharacter.js';
import { useDice } from '../store/dice.js';
import { useRoom } from '../store/socket.js';
import SrdPicker from '../components/SrdPicker.jsx';
import RollCard from '../components/RollCard.jsx';
import WeaponRow from '../components/WeaponRow.jsx';
import SheetTutorial, { TUTORIAL_SEEN_KEY } from '../components/SheetTutorial.jsx';
import CharacterAvatarPanel from '../components/CharacterAvatarPanel.jsx';

const inputClass =
  'rounded-sm border border-bone/20 bg-night-950 px-2 py-1.5 text-bone focus:border-gold focus:outline-none disabled:opacity-60';

function Card({ title, action, children }) {
  return (
    <section className="rounded-md border border-gold/15 bg-night-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg tracking-wide text-gold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange, min = 0, max = 999, disabled, mono = true }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-bone/50">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0)))}
        className={`${inputClass} w-full text-center ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export default function CharacterSheetPage() {
  const { id } = useParams();
  const { char, editable, saveState, error, patch } = useCharacter(id);
  const [classes, setClasses] = useState([]);
  const [races, setRaces] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [picker, setPicker] = useState(null); // 'weapon' | 'gear' | 'spell'
  const [customItem, setCustomItem] = useState('');
  const [customProficiency, setCustomProficiency] = useState('');
  const [lastRoll, setLastRoll] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  const joinRoom = useRoom((s) => s.joinRoom);
  const submitRoll = useDice((s) => s.submitRoll);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    api('/srd/classes').then(({ results }) => setClasses(results));
    api('/srd/races').then(({ results }) => setRaces(results));
    api('/campaigns').then(({ campaigns }) => setCampaigns(campaigns)).catch(() => {});
  }, []);

  // Tras finalizar el asistente llegamos con ?tutorial=1: mostramos la guía
  // contextual solo si el usuario no la ha visto antes en este navegador.
  useEffect(() => {
    if (searchParams.get('tutorial') === '1') {
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) setTutorialOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeTutorial() {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    setTutorialOpen(false);
  }

  // Si el personaje está vinculado a una campaña, únete a su sala para
  // que las tiradas se compartan automáticamente en el registro de la mesa.
  useEffect(() => {
    if (char?.campaign_id) joinRoom(char.campaign_id);
  }, [char?.campaign_id, joinRoom]);

  async function runAvatarAction(action) {
    setAvatarBusy(true);
    setAvatarError('');
    try {
      const updated = await action();
      patch({ avatar_path: updated.avatar_path });
    } catch (e) {
      setAvatarError(e.message || 'No se pudo actualizar el icono.');
    } finally {
      setAvatarBusy(false);
    }
  }

  const handleAvatarUpload = (file) => runAvatarAction(() => uploadCharacterAvatar(id, file));
  const handleAvatarGenerate = (options) => runAvatarAction(() => generateCharacterAvatar(id, options));
  const handleAvatarRemove = () => runAvatarAction(() => removeCharacterAvatar(id));

  function onRoll(roll) {
    if (!roll) return;
    submitRoll(roll);
    setLastRoll(roll);
  }

  function rollCheck(label, bonus, kind = 'check') {
    onRoll({ ...rollAttack(bonus, { label, actorName: char.name }), kind });
  }

  if (error) {
    return (
      <div className="min-h-full bg-night-950 p-6 text-bone">
        <p className="text-blood">{error}</p>
        <Link to="/personajes" className="text-gold underline">Volver a personajes</Link>
      </div>
    );
  }
  if (!char) {
    return <div className="min-h-full bg-night-950 p-6 text-bone/60">Cargando ficha…</div>;
  }

  const prof = proficiencyBonus(char.level);
  const weapons = char.inventory.filter((i) => i.weapon && i.equipped);
  const preparedSet = new Set(char.spells.prepared ?? []);
  const ro = !editable;

  function addItem(entry) {
    const meta = entry.meta ?? {};
    const item = {
      id: crypto.randomUUID(),
      srdIndex: entry.index,
      name: entry.name,
      qty: 1,
      equipped: Boolean(meta.damage),
      weapon: meta.damage
        ? {
            damageDice: meta.damage.dice,
            damageType: meta.damage.type,
            versatileDice: meta.twoHandedDamage?.dice ?? null,
            properties: meta.properties ?? [],
            weaponRange: meta.weaponRange,
          }
        : null,
    };
    patch({ inventory: [...char.inventory, item] });
    setPicker(null);
  }

  function addCustomItem() {
    if (!customItem.trim()) return;
    patch({
      inventory: [
        ...char.inventory,
        { id: crypto.randomUUID(), srdIndex: null, name: customItem.trim(), qty: 1, equipped: false, weapon: null },
      ],
    });
    setCustomItem('');
  }

  function updateItem(itemId, fields) {
    patch({ inventory: char.inventory.map((i) => (i.id === itemId ? { ...i, ...fields } : i)) });
  }

  function addCustomProficiency() {
    if (!customProficiency.trim()) return;
    patch({ other_proficiencies: [...char.other_proficiencies, customProficiency.trim()] });
    setCustomProficiency('');
  }

  function removeProficiency(name) {
    patch({ other_proficiencies: char.other_proficiencies.filter((p) => p !== name) });
  }

  function addSpell(entry) {
    const known = char.spells.known ?? [];
    if (!known.some((s) => s.index === entry.index)) {
      const spell = {
        index: entry.index,
        name: entry.name,
        level: entry.meta?.level ?? 0,
        school: entry.meta?.school,
        attackType: entry.meta?.attackType ?? null,
        hasDamage: Boolean(entry.meta?.hasDamage),
        dc: entry.meta?.dc ?? null,
      };
      patch({ spells: { ...char.spells, known: [...known, spell] } });
    }
    setPicker(null);
  }

  function togglePrepared(index) {
    const prepared = preparedSet.has(index)
      ? (char.spells.prepared ?? []).filter((s) => s !== index)
      : [...(char.spells.prepared ?? []), index];
    patch({ spells: { ...char.spells, prepared } });
  }

  function removeSpell(index) {
    patch({
      spells: {
        ...char.spells,
        known: (char.spells.known ?? []).filter((s) => s.index !== index),
        prepared: (char.spells.prepared ?? []).filter((s) => s !== index),
      },
    });
  }

  async function castSpell(spell, mode) {
    const roll = await castSpellRoll(char, spell, mode);
    if (roll) onRoll(roll);
  }

  const saveLabels = { saved: 'Guardado ✓', pending: 'Cambios sin guardar…', saving: 'Guardando…', error: 'Error al guardar' };

  return (
    <div className="min-h-full bg-night-950">
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 text-bone">
      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <Link to="/personajes" className="font-display text-sm text-gold/80 hover:text-gold">
          ← Personajes
        </Link>
        <div className="flex items-center gap-3">
          <button onClick={() => setTutorialOpen(true)} className="text-xs text-gold/70 underline decoration-dotted hover:text-gold">
            Ayuda
          </button>
          <span className={`text-xs ${saveState === 'error' ? 'text-blood' : 'text-bone/50'}`}>
            {editable ? saveLabels[saveState] : 'Solo lectura'}
          </span>
        </div>
      </div>

      {char.status === 'draft' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ochre/40 bg-ochre/10 p-3 text-sm">
          <span className="text-bone/80">
            Este personaje es un <strong className="text-ochre">borrador</strong>: aún no ha terminado la creación
            guiada.
          </span>
          {editable && (
            <Link to={`/personajes/${id}/asistente`} className="rounded-sm border border-ochre/50 px-3 py-1 text-xs text-ochre hover:bg-ochre/10">
              Continuar asistente
            </Link>
          )}
        </div>
      )}

      <Card title="Personaje">
        <div className="mb-4">
          <CharacterAvatarPanel
            avatarUrl={char.avatar_path}
            editable={editable}
            busy={avatarBusy}
            error={avatarError}
            onUpload={handleAvatarUpload}
            onGenerate={handleAvatarGenerate}
            onRemove={handleAvatarRemove}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-bone/50">Nombre</span>
            <input
              value={char.name}
              disabled={ro}
              onChange={(e) => patch({ name: e.target.value })}
              className={`${inputClass} font-display text-lg`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-bone/50">Clase</span>
            <select
              value={char.class_index ?? ''}
              disabled={ro}
              onChange={(e) => patch({ class_index: e.target.value || null })}
              className={inputClass}
            >
              <option value="">—</option>
              {classes.map((c) => (
                <option key={c.index} value={c.index}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-bone/50">Raza</span>
            <select
              value={char.race_index ?? ''}
              disabled={ro}
              onChange={(e) => patch({ race_index: e.target.value || null })}
              className={inputClass}
            >
              <option value="">—</option>
              {races.map((r) => (
                <option key={r.index} value={r.index}>{r.name}</option>
              ))}
            </select>
          </label>
          <NumberField label="Nivel" value={char.level} min={1} max={20} disabled={ro} onChange={(v) => patch({ level: v })} />
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-bone/50">Competencia</span>
            <span className="rounded-sm border border-bone/10 bg-night-950 px-2 py-1.5 text-center font-mono text-gold">
              {formatModifier(prof)}
            </span>
          </div>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-bone/50">Campaña</span>
            <select
              value={char.campaign_id ?? ''}
              disabled={ro}
              onChange={(e) => patch({ campaign_id: e.target.value ? Number(e.target.value) : null })}
              className={inputClass}
            >
              <option value="">Sin campaña</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {/* Vitales */}
      <Card title="Vitales">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <div className="col-span-3 rounded-sm border border-blood/40 bg-blood/5 p-2">
            <div className="mb-1 text-center text-xs uppercase tracking-wider text-bone/50">Puntos de golpe</div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => patch({ hp_current: Math.max(-99, char.hp_current - 1) })}
                disabled={ro}
                className="h-8 w-8 rounded-sm border border-blood/50 text-blood hover:bg-blood/15 disabled:opacity-40"
                aria-label="Restar HP"
              >
                −
              </button>
              <span className="font-mono text-2xl">
                <input
                  type="number"
                  value={char.hp_current}
                  disabled={ro}
                  onChange={(e) => patch({ hp_current: parseInt(e.target.value, 10) || 0 })}
                  className="w-16 border-none bg-transparent text-center font-mono text-2xl text-bone focus:outline-none"
                />
                <span className="text-bone/40">/</span>
                <input
                  type="number"
                  value={char.hp_max}
                  disabled={ro}
                  onChange={(e) => patch({ hp_max: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  className="w-14 border-none bg-transparent text-center font-mono text-lg text-bone/70 focus:outline-none"
                />
              </span>
              <button
                onClick={() => patch({ hp_current: Math.min(char.hp_max, char.hp_current + 1) })}
                disabled={ro}
                className="h-8 w-8 rounded-sm border border-moss text-bone/90 hover:bg-moss/20 disabled:opacity-40"
                aria-label="Sumar HP"
              >
                +
              </button>
            </div>
          </div>
          <NumberField label="HP temp." value={char.hp_temp} disabled={ro} onChange={(v) => patch({ hp_temp: v })} />
          <NumberField label="CA" value={char.ac} max={40} disabled={ro} onChange={(v) => patch({ ac: v })} />
          <NumberField label="Velocidad" value={char.speed} max={300} disabled={ro} onChange={(v) => patch({ speed: v })} />
          <NumberField
            label="Visión oscuridad"
            value={char.darkvision}
            max={30}
            disabled={ro}
            onChange={(v) => patch({ darkvision: v })}
          />
        </div>
      </Card>

      {/* Características */}
      <Card title="Características">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => {
            const score = char.abilities[a.key];
            const mod = abilityModifier(score);
            return (
              <div key={a.key} className="rounded-sm border border-bone/10 bg-night-950/50 p-2 text-center">
                <button
                  onClick={() => rollCheck(`Prueba de ${a.name}`, mod)}
                  className="w-full font-display text-xs uppercase tracking-wider text-gold/90 hover:text-gold"
                  title={`Tirar prueba de ${a.name}`}
                >
                  {a.short}
                </button>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={score}
                  disabled={ro}
                  onChange={(e) =>
                    patch({
                      abilities: {
                        ...char.abilities,
                        [a.key]: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 10)),
                      },
                    })
                  }
                  className="w-full border-none bg-transparent text-center font-mono text-xl text-bone focus:outline-none"
                />
                <div className="font-mono text-sm text-bone/60">{formatModifier(mod)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Salvaciones y habilidades */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Salvaciones">
          <ul className="space-y-1">
            {ABILITIES.map((a) => {
              const bonus = saveBonus(char, a.key);
              return (
                <li key={a.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={char.save_proficiencies.includes(a.key)}
                    disabled={ro}
                    onChange={(e) =>
                      patch({
                        save_proficiencies: e.target.checked
                          ? [...char.save_proficiencies, a.key]
                          : char.save_proficiencies.filter((k) => k !== a.key),
                      })
                    }
                    className="accent-gold"
                  />
                  <button
                    onClick={() => rollCheck(`Salvación de ${a.name}`, bonus)}
                    className="flex flex-1 items-baseline justify-between rounded-sm px-1 py-0.5 text-left hover:bg-gold/10"
                  >
                    <span className="text-sm">{a.name}</span>
                    <span className="font-mono text-sm text-bone/80">{formatModifier(bonus)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Habilidades">
          <ul className="space-y-1">
            {SKILLS.map((sk) => {
              const bonus = skillBonus(char, sk);
              return (
                <li key={sk.index} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={char.skill_proficiencies.includes(sk.index)}
                    disabled={ro}
                    onChange={(e) =>
                      patch({
                        skill_proficiencies: e.target.checked
                          ? [...char.skill_proficiencies, sk.index]
                          : char.skill_proficiencies.filter((k) => k !== sk.index),
                      })
                    }
                    className="accent-gold"
                  />
                  <button
                    onClick={() => rollCheck(sk.name, bonus)}
                    className="flex flex-1 items-baseline justify-between rounded-sm px-1 py-0.5 text-left hover:bg-gold/10"
                  >
                    <span className="text-sm">
                      {sk.name} <span className="text-xs text-bone/40">({ABILITIES.find((a) => a.key === sk.ability).short})</span>
                    </span>
                    <span className="font-mono text-sm text-bone/80">{formatModifier(bonus)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* Otras competencias (herramientas, instrumentos, idiomas…) */}
      {(char.other_proficiencies.length > 0 || !ro) && (
        <Card title="Otras competencias">
          {char.other_proficiencies.length === 0 && (
            <p className="text-sm text-bone/50">Sin herramientas, idiomas u otras competencias registradas.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {char.other_proficiencies.map((p) => (
              <span key={p} className="flex items-center gap-1 rounded-sm border border-bone/15 px-2 py-1 text-xs text-bone/70">
                {p}
                {!ro && (
                  <button onClick={() => removeProficiency(p)} aria-label={`Quitar ${p}`} className="text-bone/40 hover:text-blood">
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
          {!ro && (
            <div className="mt-3 flex gap-2">
              <input
                value={customProficiency}
                onChange={(e) => setCustomProficiency(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomProficiency()}
                placeholder="Ej. Herramientas de ladrón"
                className={`${inputClass} flex-1 text-sm`}
              />
              <button onClick={addCustomProficiency} className="rounded-sm border border-bone/30 px-3 text-sm hover:bg-bone/10">
                Añadir
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Ataques */}
      <Card title="Ataques">
        {lastRoll && (
          <div className="mb-3">
            <RollCard roll={lastRoll} />
          </div>
        )}
        {weapons.length === 0 ? (
          <p className="text-sm text-bone/50">Equipa un arma del inventario para atacar con ella.</p>
        ) : (
          <div className="space-y-2">
            {weapons.map((item) => (
              <WeaponRow key={item.id} item={item} char={char} onRoll={onRoll} disabled={false} />
            ))}
          </div>
        )}
      </Card>

      {/* Inventario */}
      <Card
        title="Inventario"
        action={
          !ro && (
            <div className="flex gap-1.5">
              <button onClick={() => setPicker('weapon')} className="rounded-sm border border-gold/40 px-2 py-1 text-xs text-gold hover:bg-gold/10">
                + Arma
              </button>
              <button onClick={() => setPicker('gear')} className="rounded-sm border border-bone/30 px-2 py-1 text-xs hover:bg-bone/10">
                + Objeto SRD
              </button>
            </div>
          )
        }
      >
        {char.inventory.length === 0 && <p className="text-sm text-bone/50">Inventario vacío.</p>}
        <ul className="space-y-1.5">
          {char.inventory.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-sm border border-bone/10 px-2 py-1.5">
              {item.weapon && (
                <input
                  type="checkbox"
                  checked={item.equipped}
                  disabled={ro}
                  onChange={(e) => updateItem(item.id, { equipped: e.target.checked })}
                  title="Equipada"
                  className="accent-gold"
                />
              )}
              <span className="flex-1 text-sm">
                {item.name}
                {item.weapon && <span className="ml-2 font-mono text-xs text-bone/50">{item.weapon.damageDice}</span>}
              </span>
              <input
                type="number"
                min={1}
                max={999}
                value={item.qty}
                disabled={ro}
                onChange={(e) => updateItem(item.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className={`${inputClass} w-14 text-center font-mono text-xs`}
              />
              {!ro && (
                <button
                  onClick={() => patch({ inventory: char.inventory.filter((i) => i.id !== item.id) })}
                  aria-label={`Eliminar ${item.name}`}
                  className="px-1 text-bone/40 hover:text-blood"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {!ro && (
          <div className="mt-3 flex gap-2">
            <input
              value={customItem}
              onChange={(e) => setCustomItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomItem()}
              placeholder="Objeto propio (ej. Mapa del contrabandista)"
              className={`${inputClass} flex-1 text-sm`}
            />
            <button onClick={addCustomItem} className="rounded-sm border border-bone/30 px-3 text-sm hover:bg-bone/10">
              Añadir
            </button>
          </div>
        )}
      </Card>

      {/* Hechizos */}
      <Card
        title="Hechizos"
        action={
          !ro && (
            <button onClick={() => setPicker('spell')} className="rounded-sm border border-gold/40 px-2 py-1 text-xs text-gold hover:bg-gold/10">
              + Hechizo
            </button>
          )
        }
      >
        {char.class_index && (
          <p className="mb-2 text-xs text-bone/50">
            Ataque de conjuro {formatModifier(spellAttackBonus(char))} · CD de salvación {spellSaveDC(char)}
          </p>
        )}
        {(char.spells.known ?? []).length === 0 ? (
          <p className="text-sm text-bone/50">Sin hechizos conocidos.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...(char.spells.known ?? [])]
              .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
              .map((spell) => (
                <li key={spell.index} className="rounded-sm border border-bone/10 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={preparedSet.has(spell.index)}
                      disabled={ro}
                      onChange={() => togglePrepared(spell.index)}
                      title="Preparado"
                      className="accent-gold"
                    />
                    <span className="flex-1 text-sm">
                      {spell.name}
                      <span className="ml-2 text-xs text-bone/40">
                        {spell.level === 0 ? 'truco' : `nv. ${spell.level}`}
                        {spell.school && ` · ${SCHOOL_NAMES[spell.school] ?? spell.school}`}
                      </span>
                    </span>
                    {spell.attackType && (
                      <button onClick={() => castSpell(spell, 'attack')} className="rounded-sm border border-gold/40 px-2 py-0.5 text-xs text-gold hover:bg-gold/10">
                        Ataque
                      </button>
                    )}
                    {spell.hasDamage && (
                      <button onClick={() => castSpell(spell, 'damage')} className="rounded-sm border border-bone/30 px-2 py-0.5 text-xs hover:bg-bone/10">
                        Daño
                      </button>
                    )}
                    {spell.dc && !spell.hasDamage && (
                      <span className="font-mono text-xs text-bone/50">
                        CD {spellSaveDC(char)} {ABILITIES.find((a) => a.key === spell.dc)?.short ?? ''}
                      </span>
                    )}
                    {!ro && (
                      <button onClick={() => removeSpell(spell.index)} aria-label={`Olvidar ${spell.name}`} className="px-1 text-bone/40 hover:text-blood">
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {/* Rasgos y notas */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Rasgos y aptitudes">
          <textarea
            value={char.features}
            disabled={ro}
            onChange={(e) => patch({ features: e.target.value })}
            rows={6}
            placeholder="Furia, Estilo de combate, Don de la suerte…"
            className={`${inputClass} w-full text-sm`}
          />
        </Card>
        <Card title="Notas">
          <textarea
            value={char.notes}
            disabled={ro}
            onChange={(e) => patch({ notes: e.target.value })}
            rows={6}
            placeholder="Trasfondo, aliados, deudas pendientes…"
            className={`${inputClass} w-full text-sm`}
          />
        </Card>
      </div>

      {/* Selectores de compendio */}
      {picker === 'weapon' && (
        <SrdPicker
          title="Añadir arma"
          category="equipment"
          filters={{ cat: 'weapon' }}
          onPick={addItem}
          onClose={() => setPicker(null)}
          renderMeta={(e) => e.meta?.damage?.dice ?? ''}
        />
      )}
      {picker === 'gear' && (
        <SrdPicker
          title="Añadir objeto"
          category="equipment"
          onPick={addItem}
          onClose={() => setPicker(null)}
          renderMeta={(e) => e.meta?.damage?.dice ?? ''}
        />
      )}
      {picker === 'spell' && (
        <SrdPicker
          title="Añadir hechizo"
          category="spells"
          filters={char.class_index ? { class: char.class_index } : {}}
          onPick={addSpell}
          onClose={() => setPicker(null)}
          renderMeta={(e) => (e.meta?.level === 0 ? 'truco' : `nv. ${e.meta?.level}`)}
        />
      )}

      <SheetTutorial open={tutorialOpen} onClose={closeTutorial} />
    </div>
    </div>
  );
}
