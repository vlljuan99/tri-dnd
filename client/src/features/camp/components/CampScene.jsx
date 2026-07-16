import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../../../api.js';

/**
 * Escena de campamento (Fase 9): pantalla-hogar de la campaña, estilo "menú
 * de misión" (Suikoden/Kingdom Hearts). Una ilustración fija (generada una
 * vez con IA y commiteada en client/public/campamento.jpg) con hotspots en
 * coordenadas % sobre la imagen — mismo patrón que los pins del mapa de
 * mundo, sin librerías extra:
 *   - hoguera  → la compañía (miembros, plazas, código de invitación)
 *   - tiendas  → fichas de personaje (la tuya y las de los compañeros)
 *   - camino   → la mesa de juego (bloqueado al jugador sin sesión abierta)
 *   - diario   → lore y objetivos de la campaña
 *   - cofre    → inventario de tu personaje (solo consulta)
 */

// Coordenadas afinadas a la ilustración de client/public/campamento.jpg
const TENT_SPOTS = [
  { x: 13.5, y: 46 },
  { x: 28.5, y: 40.5 },
  { x: 71.5, y: 40.5 },
  { x: 86, y: 46.5 },
];
const FIRE_SPOT = { x: 47.5, y: 52 };
const PATH_SPOT = { x: 55, y: 24 };
const CHEST_SPOT = { x: 16, y: 79 };
const DIARY_SPOT = { x: 78.5, y: 78 };

function Hotspot({ x, y, label, sublabel, onClick, to, dimmed = false }) {
  const body = (
    <motion.span
      whileHover={dimmed ? undefined : { scale: 1.08 }}
      whileTap={dimmed ? undefined : { scale: 0.96 }}
      className="group relative flex flex-col items-center"
    >
      {/* halo que se enciende al pasar el ratón */}
      {!dimmed && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(230,190,110,0.35)_0%,transparent_70%)] opacity-0 blur-sm transition-opacity duration-300 group-hover:opacity-100"
        />
      )}
      <span
        className={`relative whitespace-nowrap rounded-sm border px-2 py-0.5 font-display text-xs tracking-wide backdrop-blur-sm transition-colors ${
          dimmed
            ? 'border-bone/15 bg-night-950/60 text-bone/40'
            : 'border-gold/40 bg-night-950/70 text-gold group-hover:border-gold group-hover:bg-night-900/90'
        }`}
      >
        {label}
      </span>
      {sublabel && (
        <span className="relative mt-0.5 rounded-sm bg-night-950/60 px-1 text-[0.6rem] text-bone/70">
          {sublabel}
        </span>
      )}
    </motion.span>
  );

  const positionClass = 'absolute -translate-x-1/2 -translate-y-1/2';
  const style = { left: `${x}%`, top: `${y}%` };
  if (dimmed) {
    return (
      <span className={positionClass} style={style}>
        {body}
      </span>
    );
  }
  if (to) {
    return (
      <Link to={to} className={positionClass} style={style}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={positionClass} style={style}>
      {body}
    </button>
  );
}

// Panel superpuesto de la escena (compañía, diario, cofre, camino cerrado)
function CampPanel({ title, onClose, children }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-night-950/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-sm border border-gold/30 bg-night-900/95 p-4 text-bone shadow-2xl backdrop-blur"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display text-lg tracking-wide text-gold">{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="px-1 text-bone/60 hover:text-bone">
            ✕
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

// Cofre: inventario de tu personaje en modo consulta (usar objetos sigue
// siendo cosa del tablero, donde gasta la acción del turno). El DM puede
// asomarse al de cualquier personaje de la campaña.
function ChestContents({ characters, ownCharacterId, isDm }) {
  const [selectedId, setSelectedId] = useState(ownCharacterId ?? characters[0]?.id ?? null);
  const [character, setCharacter] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setCharacter(null);
    setError('');
    api(`/characters/${selectedId}`)
      .then(({ character: c }) => {
        if (!cancelled) setCharacter(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo abrir el cofre.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (!selectedId) {
    return (
      <p className="text-sm text-bone/60">
        {isDm
          ? 'Todavía no hay personajes en la campaña: el cofre está vacío.'
          : 'Sin personaje en la campaña, no tienes nada guardado en el cofre.'}
      </p>
    );
  }

  return (
    <div>
      {isDm && characters.length > 1 && (
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          className="mb-3 w-full rounded-sm border border-gold/30 bg-night-950 px-2 py-1.5 text-sm text-bone focus:border-gold focus:outline-none"
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {!character && !error && <p className="text-sm text-bone/50">Abriendo el cofre…</p>}
      {error && <p className="text-sm text-blood">{error}</p>}
      {character && character.inventory.length === 0 && (
        <p className="text-sm italic text-bone/50">El cofre está vacío.</p>
      )}
      {character && character.inventory.length > 0 && (
        <ul className="space-y-1.5">
          {character.inventory.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-bone/10 bg-night-950/60 px-2 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate">{item.name}</span>
              {item.qty > 1 && <span className="shrink-0 font-mono text-xs text-bone/60">×{item.qty}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-bone/50">
        Para usar o equipar objetos, hazlo desde la ficha o desde el tablero (en tu turno).
      </p>
    </div>
  );
}

export default function CampScene({
  campaign,
  members,
  characters,
  user,
  isDm,
  isLive,
  playerCount,
  onTakePath,
  campaignId,
}) {
  const [panel, setPanel] = useState(null); // 'hoguera' | 'diario' | 'cofre' | 'camino'
  const scrollerRef = useRef(null);

  // En pantallas estrechas (móvil) la imagen desborda con paneo horizontal:
  // arrancar centrado en la hoguera, no en el borde izquierdo del claro
  function centerScroll() {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }
  useEffect(centerScroll, []);

  // Si el jugador estaba mirando el camino cerrado y el DM abre la sesión,
  // el aviso se retira solo (isLive llega por socket)
  useEffect(() => {
    if (isLive) setPanel((p) => (p === 'camino' ? null : p));
  }, [isLive]);

  // Solo los PJ acampan en las tiendas (los jefes/PNJ del DM no); el tuyo
  // primero para que siempre tenga tienda aunque haya más de cuatro.
  const campers = useMemo(() => {
    const pjs = characters.filter((c) => (c.kind ?? 'pj') === 'pj');
    return pjs.sort((a, b) => (a.user_id === user?.id ? -1 : b.user_id === user?.id ? 1 : a.id - b.id));
  }, [characters, user]);
  const ownCharacter = campers.find((c) => c.user_id === user?.id) ?? null;

  function takePath() {
    if (!isDm && !isLive) {
      setPanel('camino');
      return;
    }
    onTakePath();
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="relative flex-1 overflow-hidden bg-night-950"
    >
      {/* fondo difuminado para las franjas laterales en pantallas muy anchas */}
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-35 blur-xl"
        style={{ backgroundImage: 'url(/campamento.jpg)' }}
      />

      <div ref={scrollerRef} className="absolute inset-0 overflow-auto">
        <div className="flex h-full w-max min-w-full items-center justify-center">
          <div className="relative h-full">
            <img
              src="/campamento.jpg"
              alt={`Campamento de ${campaign?.name ?? 'la campaña'}`}
              draggable={false}
              onLoad={centerScroll}
              className="h-full w-auto max-w-none select-none"
            />

            {/* resplandor vivo de la hoguera */}
            <motion.span
              aria-hidden
              animate={{ opacity: [0.25, 0.5, 0.3, 0.45, 0.25] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
              className="pointer-events-none absolute h-[46%] w-[32%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,150,50,0.5)_0%,rgba(255,110,30,0.15)_45%,transparent_70%)] mix-blend-screen"
              style={{ left: `${FIRE_SPOT.x}%`, top: `${FIRE_SPOT.y}%` }}
            />

            {/* camino a la mesa de juego */}
            <Hotspot
              {...PATH_SPOT}
              label="⚔ Partir de aventura"
              sublabel={!isDm && !isLive ? 'el DM aún no ha abierto la sesión' : 'a la mesa de juego'}
              onClick={takePath}
            />

            {/* hoguera: la compañía */}
            <Hotspot {...FIRE_SPOT} label="🔥 La compañía" onClick={() => setPanel('hoguera')} />

            {/* tiendas: fichas de personaje */}
            {TENT_SPOTS.map((spot, i) => {
              const character = campers[i] ?? null;
              if (character) {
                return (
                  <Hotspot
                    key={i}
                    {...spot}
                    label={`⛺ ${character.name}`}
                    sublabel={character.user_id === user?.id ? 'tu tienda' : undefined}
                    to={`/personajes/${character.id}`}
                  />
                );
              }
              // primera tienda libre: invita a montar la tuya si aún no tienes PJ
              if (!isDm && !ownCharacter && i === campers.length) {
                return (
                  <Hotspot key={i} {...spot} label="⛺ Monta tu tienda" sublabel="crea tu personaje" to="/personajes" />
                );
              }
              return <Hotspot key={i} {...spot} label="⛺ Tienda libre" dimmed />;
            })}

            {/* diario de campaña */}
            <Hotspot {...DIARY_SPOT} label="📖 Diario de campaña" onClick={() => setPanel('diario')} />

            {/* cofre del grupo */}
            <Hotspot {...CHEST_SPOT} label="🧰 Cofre" onClick={() => setPanel('cofre')} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {panel === 'hoguera' && (
          <CampPanel key="hoguera" title="La compañía" onClose={() => setPanel(null)}>
            <p className="mb-3 text-sm text-bone/70">
              {playerCount} jugador{playerCount === 1 ? '' : 'es'} unido{playerCount === 1 ? '' : 's'}
              {campaign?.maxPlayers ? ` de ${campaign.maxPlayers} plazas` : ''}
              {isLive ? ' · sesión en vivo' : ' · sesión cerrada'}
            </p>
            <ul className="space-y-1.5">
              {members.map((m) => {
                const character = campers.find((c) => c.user_id === m.id) ?? null;
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-sm border border-bone/10 bg-night-950/60 px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {m.displayName}
                      {character && <span className="text-bone/50"> · {character.name}</span>}
                    </span>
                    <span
                      className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-display text-[0.65rem] uppercase tracking-widest ${
                        m.role === 'dm' ? 'border-ember/50 text-ember' : 'border-bone/20 text-bone/60'
                      }`}
                    >
                      {m.role === 'dm' ? 'DM' : 'Jugador'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {isDm && campaign?.inviteCode && (
              <p className="mt-3 text-xs text-bone/60">
                Código de invitación:{' '}
                <span className="font-mono tracking-widest text-gold">{campaign.inviteCode}</span>
              </p>
            )}
          </CampPanel>
        )}

        {panel === 'diario' && (
          <CampPanel key="diario" title="Diario de campaña" onClose={() => setPanel(null)}>
            {campaign?.lore ? (
              <div className="mb-3">
                <p className="mb-1 font-display text-xs uppercase tracking-widest text-gold/70">Lore</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone/85">{campaign.lore}</p>
              </div>
            ) : null}
            {campaign?.objectives?.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 font-display text-xs uppercase tracking-widest text-gold/70">Objetivos</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-bone/85">
                  {campaign.objectives.map((objective, i) => (
                    <li key={i}>{objective}</li>
                  ))}
                </ul>
              </div>
            )}
            {!campaign?.lore && !campaign?.objectives?.length && (
              <p className="text-sm italic text-bone/50">El DM aún no ha escrito nada en el diario.</p>
            )}
            {isDm && (
              <Link
                to={`/campanas/${campaignId}/gestion`}
                className="text-xs text-gold underline hover:text-gold/80"
              >
                Gestión de la campaña
              </Link>
            )}
          </CampPanel>
        )}

        {panel === 'cofre' && (
          <CampPanel key="cofre" title="Cofre" onClose={() => setPanel(null)}>
            <ChestContents
              characters={isDm ? campers : campers.filter((c) => c.user_id === user?.id)}
              ownCharacterId={ownCharacter?.id ?? null}
              isDm={isDm}
            />
          </CampPanel>
        )}

        {panel === 'camino' && (
          <CampPanel key="camino" title="El camino está a oscuras" onClose={() => setPanel(null)}>
            <p className="text-sm leading-relaxed text-bone/80">
              El DM aún no ha abierto la sesión de juego. Descansa junto a la hoguera: en cuanto la abra,
              el camino se iluminará solo.
            </p>
          </CampPanel>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
