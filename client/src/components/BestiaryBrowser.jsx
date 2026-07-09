import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { MonsterStatsContent } from './MonsterStatBlock.jsx';
import CharacterAvatarPanel from './CharacterAvatarPanel.jsx';
import { uploadMonsterImage, generateMonsterImage, removeMonsterImage } from '../lib/monsterImage.js';
import { formatModifier } from '../lib/dnd.js';

const TABS = [
  { key: 'compendio', label: 'Compendio' },
  { key: 'favoritos', label: 'Favoritos' },
  { key: 'jefes', label: 'Mis jefes' },
];

const ABILITY_LABELS = [
  ['str', 'FUE'],
  ['dex', 'DES'],
  ['con', 'CON'],
  ['int', 'INT'],
  ['wis', 'SAB'],
  ['cha', 'CAR'],
];

// CR fraccionario del SRD (0.25, 0.5…) mostrado a la manera clásica (1/4, 1/2)
function formatCr(cr) {
  if (cr == null) return '—';
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Copia editable de un monstruo del SRD como jefe (personaje kind='boss'):
// stats numéricos mapeados a la ficha y rasgos/acciones como texto libre,
// el mismo espíritu que los rasgos de clase de un PJ.
async function createBossFromMonster(entry) {
  const data = entry.data;
  const { character } = await api('/characters', {
    method: 'POST',
    body: { name: entry.name, kind: 'boss' },
  });
  const ability = (value) => clamp(Number.isInteger(value) ? value : 10, 1, 30);
  const hp = clamp(Number.isInteger(data.hit_points) ? data.hit_points : 10, 0, 999);
  const speedFt = Number.parseInt(String(data.speed?.walk ?? '').replace(/\D/g, ''), 10);
  const darkvisionFt = Number.parseInt(String(data.senses?.darkvision ?? '').replace(/\D/g, ''), 10);
  const sections = [];
  if (data.special_abilities?.length) {
    sections.push('— RASGOS —', ...data.special_abilities.map((a) => `${a.name}. ${a.desc ?? ''}`));
  }
  if (data.actions?.length) {
    sections.push('— ACCIONES —', ...data.actions.map((a) => `${a.name}. ${a.desc ?? ''}`));
  }
  await api(`/characters/${character.id}`, {
    method: 'PUT',
    body: {
      abilities: {
        str: ability(data.strength),
        dex: ability(data.dexterity),
        con: ability(data.constitution),
        int: ability(data.intelligence),
        wis: ability(data.wisdom),
        cha: ability(data.charisma),
      },
      hp_max: hp,
      hp_current: hp,
      ac: clamp(data.armor_class?.[0]?.value ?? 10, 0, 40),
      speed: Number.isInteger(speedFt) ? clamp(speedFt, 0, 300) : 30,
      // La ficha guarda la visión en la oscuridad en casillas (5 pies cada una)
      darkvision: Number.isInteger(darkvisionFt) ? clamp(Math.round(darkvisionFt / 5), 0, 30) : 0,
      features: sections.join('\n\n').slice(0, 20000),
    },
  });
  return character;
}

function StarButton({ active, busy, onToggle }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={active ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      title={active ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      className={`shrink-0 px-1 text-base leading-none disabled:opacity-40 ${
        active ? 'text-gold' : 'text-bone/30 hover:text-gold/70'
      }`}
    >
      {active ? '★' : '☆'}
    </button>
  );
}

/**
 * Bestiario del DM: buscador del compendio SRD de monstruos con ficha
 * completa, favoritos, imagen personalizada por monstruo (subida o IA) y
 * acceso a los jefes propios (crearlos en blanco o como copia editable de un
 * monstruo). `onPick` recibe { type: 'monster', index, name } o
 * { type: 'boss', id, name } según lo elegido para colocar en el mapa.
 */
export default function BestiaryBrowser({ onPick, onClose, onBossesChanged }) {
  const [tab, setTab] = useState('compendio');
  const [q, setQ] = useState('');
  const [monsters, setMonsters] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [bosses, setBosses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { type: 'monster', index } | { type: 'boss', id }
  const [detail, setDetail] = useState(null); // entrada completa del monstruo seleccionado
  const [detailError, setDetailError] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState('');
  const [bossBusy, setBossBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // Compendio: búsqueda con el mismo debounce que SrdPicker
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams(q ? { q } : {});
        const { results } = await api(`/srd/monsters?${params}`);
        setMonsters(results);
      } catch {
        setMonsters([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    api('/srd/favoritos?category=monsters')
      .then(({ results }) => setFavorites(results))
      .catch(() => setFavorites([]));
  }, []);

  async function refreshBosses() {
    try {
      const { characters } = await api('/characters');
      const list = characters.filter((c) => c.kind === 'boss');
      setBosses(list);
      onBossesChanged?.(list);
    } catch {
      // la pestaña de jefes mostrará la lista vacía
    }
  }

  // Al entrar en "Mis jefes" se recarga: un jefe recién editado en otra
  // pestaña del navegador aparece al volver aquí
  useEffect(() => {
    if (tab === 'jefes') refreshBosses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Detalle del monstruo seleccionado (ficha completa del SRD)
  useEffect(() => {
    if (selected?.type !== 'monster') {
      setDetail(null);
      setDetailError('');
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError('');
    api(`/srd/monsters/${selected.index}`)
      .then((entry) => {
        if (!cancelled) setDetail(entry);
      })
      .catch(() => {
        if (!cancelled) setDetailError('No se pudo cargar la ficha del monstruo');
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.type === 'monster' ? selected.index : null]);

  const selectedBoss =
    selected?.type === 'boss' ? bosses.find((b) => b.id === selected.id) ?? null : null;

  const visibleList = useMemo(() => {
    const filter = (list) =>
      q.trim()
        ? list.filter((e) => (e.name ?? '').toLowerCase().includes(q.trim().toLowerCase()))
        : list;
    if (tab === 'compendio') return monsters;
    if (tab === 'favoritos') return filter(favorites);
    return filter(bosses);
  }, [tab, q, monsters, favorites, bosses]);

  function applyFavorite(index, favorite, entry) {
    setMonsters((list) => list.map((e) => (e.index === index ? { ...e, favorite } : e)));
    setDetail((d) => (d && d.index === index ? { ...d, favorite } : d));
    setFavorites((list) =>
      favorite
        ? list.some((e) => e.index === index)
          ? list
          : [...list, { ...entry, favorite: true }].sort((a, b) => a.name.localeCompare(b.name))
        : list.filter((e) => e.index !== index)
    );
  }

  async function toggleFavorite(entry) {
    const next = !entry.favorite;
    applyFavorite(entry.index, next, entry);
    try {
      await api(`/srd/favoritos/monsters/${entry.index}`, { method: next ? 'PUT' : 'DELETE' });
    } catch {
      applyFavorite(entry.index, !next, entry); // revertir si el servidor falló
    }
  }

  function applyImage(index, imageUrl) {
    setMonsters((list) => list.map((e) => (e.index === index ? { ...e, imageUrl } : e)));
    setFavorites((list) => list.map((e) => (e.index === index ? { ...e, imageUrl } : e)));
    setDetail((d) => (d && d.index === index ? { ...d, imageUrl } : d));
  }

  async function runImageAction(action) {
    if (!detail) return;
    setImgBusy(true);
    setImgError('');
    try {
      const imageUrl = await action(detail.index);
      applyImage(detail.index, imageUrl);
    } catch (e) {
      setImgError(e.message);
    } finally {
      setImgBusy(false);
    }
  }

  async function handleCreateBoss(fromMonster) {
    setBossBusy(true);
    setActionError('');
    try {
      const character = fromMonster
        ? await createBossFromMonster(detail)
        : (await api('/characters', { method: 'POST', body: { kind: 'boss' } })).character;
      await refreshBosses();
      window.open(`/personajes/${character.id}`, '_blank', 'noopener');
      if (fromMonster) setSelected({ type: 'boss', id: character.id });
      if (!fromMonster) {
        setTab('jefes');
        setSelected({ type: 'boss', id: character.id });
      }
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBossBusy(false);
    }
  }

  const rowButton = (active) =>
    `flex w-full items-center gap-2 px-2 py-2 text-left transition-colors ${
      active ? 'bg-gold/15' : 'hover:bg-gold/10'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex h-[90vh] w-full max-w-4xl flex-col rounded-t-lg border border-gold/25 bg-night-900 text-bone sm:h-[85vh] sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gold/15 px-4 py-3">
          <h2 className="font-display text-lg tracking-wide text-gold">Bestiario</h2>
          <button onClick={onClose} aria-label="Cerrar" className="px-2 text-bone/60 hover:text-bone">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Columna izquierda: pestañas, búsqueda y listado */}
          <div className="flex max-h-[45%] min-h-0 flex-col border-b border-gold/15 sm:max-h-none sm:w-72 sm:shrink-0 sm:border-b-0 sm:border-r">
            <div className="flex gap-1 p-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`flex-1 rounded-sm border px-2 py-1 font-display text-[0.65rem] uppercase tracking-widest ${
                    tab === t.key
                      ? 'border-gold bg-gold/15 text-gold'
                      : 'border-bone/20 text-bone/60 hover:border-bone/40'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="px-2 pb-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-sm border border-bone/20 bg-night-950 px-3 py-1.5 text-sm text-bone placeholder:text-bone/40 focus:border-gold focus:outline-none"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'jefes' && (
                <div className="flex items-center justify-between gap-2 px-2 pb-2">
                  <button
                    type="button"
                    disabled={bossBusy}
                    onClick={() => handleCreateBoss(false)}
                    className="rounded-sm border border-gold/30 px-2 py-1 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"
                  >
                    + Nuevo jefe
                  </button>
                  <a
                    href="/personajes"
                    target="_blank"
                    rel="noopener"
                    className="text-[0.65rem] uppercase tracking-widest text-bone/50 hover:text-gold"
                  >
                    Sección de jefes ↗
                  </a>
                </div>
              )}
              {tab === 'jefes' && actionError && (
                <p className="px-2 pb-2 text-xs text-blood">{actionError}</p>
              )}
              {tab === 'compendio' && loading ? (
                <p className="py-6 text-center text-sm text-bone/50">Buscando…</p>
              ) : visibleList.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-bone/50">
                  {tab === 'favoritos'
                    ? 'Sin favoritos todavía: márcalos con la estrella desde el compendio.'
                    : tab === 'jefes'
                      ? 'Sin jefes todavía: crea el primero arriba.'
                      : 'Sin resultados'}
                </p>
              ) : (
                <ul className="divide-y divide-bone/10">
                  {visibleList.map((entry) =>
                    tab === 'jefes' ? (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => setSelected({ type: 'boss', id: entry.id })}
                          className={rowButton(selected?.type === 'boss' && selected.id === entry.id)}
                        >
                          <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-gold/20 bg-night-950">
                            {entry.avatar_path && (
                              <img src={entry.avatar_path} alt="" className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{entry.name}</span>
                            <span className="block font-mono text-[0.65rem] text-bone/50">
                              PG {entry.hp_max} · CA {entry.ac}
                            </span>
                          </span>
                        </button>
                      </li>
                    ) : (
                      <li key={entry.index}>
                        <div
                          className={`${rowButton(
                            selected?.type === 'monster' && selected.index === entry.index
                          )} cursor-pointer`}
                          onClick={() => setSelected({ type: 'monster', index: entry.index })}
                        >
                          <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-bone/15 bg-night-950">
                            {entry.imageUrl && (
                              <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {entry.name}
                              {!entry.translated && (
                                <span
                                  className="ml-1.5 rounded-sm border border-bone/20 px-1 text-[0.6rem] text-bone/40"
                                  title="Traducción pendiente"
                                >
                                  EN
                                </span>
                              )}
                            </span>
                            <span className="block font-mono text-[0.65rem] text-bone/50">
                              CR {formatCr(entry.meta?.cr)} · PG {entry.meta?.hp ?? '—'} · CA{' '}
                              {entry.meta?.ac ?? '—'}
                            </span>
                          </span>
                          <StarButton active={Boolean(entry.favorite)} onToggle={() => toggleFavorite(entry)} />
                        </div>
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
          </div>

          {/* Columna derecha: ficha del monstruo o del jefe */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedBoss ? (
              <div>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-gold/30 bg-night-950">
                      {selectedBoss.avatar_path && (
                        <img src={selectedBoss.avatar_path} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <div>
                      <h3 className="font-display text-lg text-gold">{selectedBoss.name}</h3>
                      <p className="font-mono text-xs text-bone/60">
                        PG {selectedBoss.hp_max} · CA {selectedBoss.ac} · Vel. {selectedBoss.speed}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
                  {ABILITY_LABELS.map(([key, short]) => (
                    <div key={key} className="rounded-sm border border-bone/15 py-1.5">
                      <div className="text-xs uppercase tracking-wider text-bone/50">{short}</div>
                      <div className="font-mono">
                        {selectedBoss.abilities[key]} (
                        {formatModifier(Math.floor((selectedBoss.abilities[key] - 10) / 2))})
                      </div>
                    </div>
                  ))}
                </div>
                {selectedBoss.features && (
                  <div className="mb-3">
                    <h4 className="mb-1 font-display text-sm uppercase tracking-widest text-gold/70">
                      Rasgos y acciones
                    </h4>
                    <p className="whitespace-pre-wrap rounded-sm border border-bone/10 bg-night-950/50 p-2 text-xs text-bone/70">
                      {selectedBoss.features}
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onPick({ type: 'boss', id: selectedBoss.id, name: selectedBoss.name })}
                    className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
                  >
                    Usar en el mapa
                  </button>
                  <a
                    href={`/personajes/${selectedBoss.id}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-sm border border-gold/30 px-4 py-1.5 font-display text-sm text-gold hover:bg-gold/10"
                  >
                    Editar ficha ↗
                  </a>
                </div>
              </div>
            ) : selected?.type === 'monster' ? (
              detailError ? (
                <p className="py-6 text-center text-blood">{detailError}</p>
              ) : !detail ? (
                <p className="py-6 text-center text-bone/50">Cargando ficha…</p>
              ) : (
                <div>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg text-gold">
                        {detail.name}
                        {!detail.translated && (
                          <span
                            className="ml-2 rounded-sm border border-bone/20 px-1 align-middle text-xs text-bone/40"
                            title="Traducción pendiente"
                          >
                            EN
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-bone/60">
                        {detail.data.type}
                        {detail.data.subtype ? ` (${detail.data.subtype})` : ''} · CR{' '}
                        {formatCr(detail.data.challenge_rating)}
                        {detail.data.xp ? ` · ${detail.data.xp} PX` : ''}
                      </p>
                    </div>
                    <StarButton active={Boolean(detail.favorite)} onToggle={() => toggleFavorite(detail)} />
                  </div>

                  {/* Imagen personalizada: se ve en el marcador del tablero */}
                  <div className="mb-4 rounded-sm border border-gold/15 bg-night-950/40 p-3">
                    <p className="mb-2 text-[0.65rem] uppercase tracking-widest text-bone/50">
                      Imagen del marcador (solo la ves tú como DM)
                    </p>
                    <CharacterAvatarPanel
                      avatarUrl={detail.imageUrl}
                      editable
                      busy={imgBusy}
                      error={imgError}
                      onUpload={(file) => runImageAction((idx) => uploadMonsterImage(idx, file))}
                      onGenerate={(opts) => runImageAction((idx) => generateMonsterImage(idx, opts))}
                      onRemove={() => runImageAction((idx) => removeMonsterImage(idx))}
                    />
                  </div>

                  <MonsterStatsContent data={detail.data} monsterName={detail.name} />

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-gold/15 pt-3">
                    <button
                      type="button"
                      onClick={() => onPick({ type: 'monster', index: detail.index, name: detail.name })}
                      className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
                    >
                      Usar en el mapa
                    </button>
                    <button
                      type="button"
                      disabled={bossBusy}
                      onClick={() => handleCreateBoss(true)}
                      title="Copia la ficha a un jefe tuyo para cambiarle stats, foto y rasgos"
                      className="rounded-sm border border-gold/30 px-4 py-1.5 font-display text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
                    >
                      {bossBusy ? 'Creando…' : 'Crear jefe editable'}
                    </button>
                  </div>
                  {actionError && <p className="mt-2 text-xs text-blood">{actionError}</p>}
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-bone/50">
                <p>
                  Elige un monstruo del compendio o uno de tus jefes para ver su ficha completa,
                  guardarlo en favoritos, ponerle imagen o colocarlo en el mapa.
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
