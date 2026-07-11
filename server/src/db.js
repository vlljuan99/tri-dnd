import Database from 'better-sqlite3';
import { DB_PATH } from './config.js';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migraciones incrementales controladas por PRAGMA user_version.
// Cada entrada se ejecuta una sola vez y en orden; añadir nuevas al final.
const migrations = [
  // v1 — modelo base: usuarios, campañas, personajes, mesa de juego y compendio SRD
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dm_user_id INTEGER NOT NULL REFERENCES users(id),
    invite_code TEXT NOT NULL UNIQUE,
    scene TEXT NOT NULL DEFAULT 'aldea',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE campaign_members (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'jugador' CHECK (role IN ('dm', 'jugador')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (campaign_id, user_id)
  );

  CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    class_index TEXT,
    race_index TEXT,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
    abilities TEXT NOT NULL DEFAULT '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
    hp_max INTEGER NOT NULL DEFAULT 10,
    hp_current INTEGER NOT NULL DEFAULT 10,
    hp_temp INTEGER NOT NULL DEFAULT 0,
    ac INTEGER NOT NULL DEFAULT 10,
    speed INTEGER NOT NULL DEFAULT 30,
    save_proficiencies TEXT NOT NULL DEFAULT '[]',
    skill_proficiencies TEXT NOT NULL DEFAULT '[]',
    inventory TEXT NOT NULL DEFAULT '[]',
    spells TEXT NOT NULL DEFAULT '{"known":[],"prepared":[],"slots":{}}',
    features TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    avatar_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_characters_user ON characters(user_id);
  CREATE INDEX idx_characters_campaign ON characters(campaign_id);

  CREATE TABLE game_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
    is_live INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE srd_entries (
    category TEXT NOT NULL,
    idx TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_es TEXT,
    desc_es TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (category, idx)
  );
  CREATE INDEX idx_srd_name_es ON srd_entries(name_es);

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2 — registro de chat y tiradas por campaña
  `
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'chat' CHECK (type IN ('chat', 'roll', 'system')),
    body TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_chat_campaign ON chat_messages(campaign_id, id);
  `,

  // v3 — tracker de iniciativa: combatientes (PJ y enemigos) + estado del combate
  `
  ALTER TABLE game_tables ADD COLUMN combat_active INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE game_tables ADD COLUMN combat_round INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE game_tables ADD COLUMN combat_turn_id INTEGER;

  CREATE TABLE combatants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'enemigo' CHECK (kind IN ('pj', 'enemigo')),
    name TEXT NOT NULL,
    initiative INTEGER NOT NULL DEFAULT 0,
    hp_current INTEGER,
    hp_max INTEGER,
    ac INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_combatants_campaign ON combatants(campaign_id);
  `,

  // v4 — vincular un enemigo del tracker a su ficha del compendio (SRD) para
  // que el DM pueda consultarla y tirar sus ataques automáticamente
  `
  ALTER TABLE combatants ADD COLUMN monster_index TEXT;
  `,

  // v5 — asistente guiado de creación de personaje: estado de borrador/completo,
  // datos de identidad adicionales y competencias no cubiertas por habilidades/salvaciones
  `
  ALTER TABLE characters ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('draft', 'complete'));
  ALTER TABLE characters ADD COLUMN background TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN alignment TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN other_proficiencies TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE characters ADD COLUMN wizard_step INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE characters ADD COLUMN wizard_data TEXT NOT NULL DEFAULT '{}';
  CREATE INDEX idx_characters_status ON characters(status);
  `,

  // v6 — mapa táctico: imagen de fondo persistente por campaña (fase 7)
  `
  ALTER TABLE game_tables ADD COLUMN map_name TEXT NOT NULL DEFAULT 'Mapa sin título';
  ALTER TABLE game_tables ADD COLUMN map_background_url TEXT;
  ALTER TABLE game_tables ADD COLUMN map_width REAL NOT NULL DEFAULT 12;
  ALTER TABLE game_tables ADD COLUMN map_height REAL NOT NULL DEFAULT 8;
  ALTER TABLE game_tables ADD COLUMN map_grid_size REAL NOT NULL DEFAULT 1;
  `,

  // v7 — forma de la sala: casillas desactivadas para cuadrículas no rectangulares
  `
  ALTER TABLE game_tables ADD COLUMN map_disabled_cells TEXT NOT NULL DEFAULT '[]';
  `,

  // v8 — Fase 7.5: biblioteca de mapas por campaña. Un mapa tiene plantas
  // (lienzos independientes) y cada planta salas NxM colocadas en el lienzo;
  // las puertas conectan salas (entre plantas solo escalera/portal).
  // El mapa único que vivía en columnas map_* de game_tables se migra a un
  // mapa de una planta con una sala ya revelada; esas columnas quedan
  // obsoletas y se retirarán cuando la mesa en vivo lea del mapa activo.
  `
  CREATE TABLE maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Mapa sin título',
    grid_size REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_maps_campaign ON maps(campaign_id);

  CREATE TABLE map_floors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Planta 1',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_map_floors_map ON map_floors(map_id);

  -- x/y: origen de la sala en casillas del lienzo de su planta (puede ser
  -- negativo, la mazmorra crece en cualquier dirección). disabled_cells:
  -- pares [col, fila] relativos al origen de la sala, como en v7.
  CREATE TABLE map_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id INTEGER NOT NULL REFERENCES map_floors(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Sala sin nombre',
    x INTEGER NOT NULL DEFAULT 0,
    y INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 100),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 100),
    background_url TEXT,
    disabled_cells TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    revealed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_map_rooms_floor ON map_rooms(floor_id);

  -- from_x/from_y y to_x/to_y son casillas absolutas del lienzo de la planta
  -- de cada sala: dónde está la puerta y dónde aparece el token al cruzarla.
  -- control: 'jugador' (se abre al llegar e interactuar) o 'dm' (llave,
  -- secreta... solo la abre el DM).
  CREATE TABLE map_doors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    from_room_id INTEGER NOT NULL REFERENCES map_rooms(id) ON DELETE CASCADE,
    to_room_id INTEGER NOT NULL REFERENCES map_rooms(id) ON DELETE CASCADE,
    from_x INTEGER NOT NULL,
    from_y INTEGER NOT NULL,
    to_x INTEGER NOT NULL,
    to_y INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'puerta' CHECK (kind IN ('puerta', 'escalera', 'portal')),
    control TEXT NOT NULL DEFAULT 'jugador' CHECK (control IN ('jugador', 'dm')),
    is_open INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_map_doors_map ON map_doors(map_id);

  ALTER TABLE game_tables ADD COLUMN active_map_id INTEGER REFERENCES maps(id);

  INSERT INTO maps (campaign_id, name, grid_size)
    SELECT campaign_id, map_name, map_grid_size FROM game_tables;

  INSERT INTO map_floors (map_id, name, position)
    SELECT id, 'Planta 1', 0 FROM maps;

  INSERT INTO map_rooms (floor_id, name, x, y, width, height, background_url, disabled_cells, revealed)
    SELECT f.id, 'Sala 1', 0, 0,
           MAX(1, CAST(ROUND(gt.map_width) AS INTEGER)),
           MAX(1, CAST(ROUND(gt.map_height) AS INTEGER)),
           gt.map_background_url, gt.map_disabled_cells, 1
    FROM map_floors f
    JOIN maps m ON m.id = f.map_id
    JOIN game_tables gt ON gt.campaign_id = m.campaign_id;

  UPDATE game_tables
    SET active_map_id = (SELECT id FROM maps WHERE maps.campaign_id = game_tables.campaign_id);
  `,

  // v9 — Fase 7.5: marcadores preparados por sala (enemigos, aliados,
  // objetos y trampas). x/y en casillas absolutas del lienzo de la planta,
  // como las puertas. hidden=1 = solo lo ve el DM (trampas, tesoro oculto),
  // con el mismo filtrado en servidor que las salas sin revelar.
  `
  CREATE TABLE map_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES map_rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'enemigo' CHECK (kind IN ('enemigo', 'aliado', 'objeto', 'trampa')),
    name TEXT NOT NULL,
    monster_index TEXT,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_map_tokens_room ON map_tokens(room_id);
  `,

  // v10 — tokens de personaje persistidos por mapa (Fase 7, resto): la
  // posición de cada PJ vive en el servidor, por sala y casilla, y persiste
  // entre sesiones. Se crea automáticamente al servir el mapa activo si el
  // personaje aún no tiene token y hay alguna sala revelada donde aparecer.
  `
  CREATE TABLE map_character_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES map_rooms(id) ON DELETE CASCADE,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    UNIQUE (map_id, character_id)
  );
  CREATE INDEX idx_map_char_tokens_map ON map_character_tokens(map_id);
  `,

  // v11 — enlace entre un combatiente del tracker y el marcador de mapa que
  // lo originó: al revelarse una sala, sus enemigos entran al tracker una
  // sola vez aunque la sala se oculte y revele varias veces
  `
  ALTER TABLE combatants ADD COLUMN map_token_id INTEGER;
  `,

  // v12 — Fase 8: obstáculos por sala (columnas, rocas, muebles...). Pares
  // [col, fila] relativos al origen de la sala, como disabled_cells: la
  // casilla existe y se ve, pero no se puede pisar y (más adelante)
  // bloqueará la línea de visión.
  `
  ALTER TABLE map_rooms ADD COLUMN obstacle_cells TEXT NOT NULL DEFAULT '[]';
  `,

  // v13 — Fase 8: niebla fina configurable por mapa (escena). vision_mode:
  // 'sala' = se ve toda sala revelada (comportamiento clásico);
  // 'compartida' = se ve lo que ve el grupo entero (unión de visiones);
  // 'individual' = cada jugador solo ve lo que ven sus personajes.
  // vision_radius en casillas; obstáculos y paredes bloquean la línea de
  // visión. El filtrado ocurre en el servidor, como todo lo oculto.
  `
  ALTER TABLE maps ADD COLUMN vision_mode TEXT NOT NULL DEFAULT 'sala'
    CHECK (vision_mode IN ('sala', 'compartida', 'individual'));
  ALTER TABLE maps ADD COLUMN vision_radius INTEGER NOT NULL DEFAULT 6;
  `,

  // v14 — Fase 8.5: economía de turno de verdad. El modo por turnos pasa a
  // ser el estado por defecto de toda mesa (antes combat_active solo movía
  // el tracker, sin bloquear nada); las mesas ya existentes se activan aquí.
  // Cada combatiente lleva sus recursos del turno: casillas de movimiento
  // gastadas (se resetean al empezar SU turno), y si ya ha usado su acción y
  // su acción adicional (también por turno). La reacción es por RONDA, no
  // por turno, y se puede gastar fuera de tu turno: se guarda en qué ronda
  // se gastó por última vez y se compara con game_tables.combat_round.
  `
  UPDATE game_tables SET combat_active = 1;
  ALTER TABLE combatants ADD COLUMN moved_squares INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN action_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN bonus_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN reaction_used_round INTEGER;
  `,

  // v15 — Fase 8.6: notas privadas por personaje (diario de sesión). A
  // diferencia de todo lo demás en la app, ni el DM las ve: son del jugador
  // y punto, se filtran igual que el resto de datos ocultos pero sin
  // excepción para el DM. session_date es texto libre (el jugador escribe
  // la fecha de la sesión, no tiene por qué ser la fecha real de creación).
  `
  CREATE TABLE character_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    session_date TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_character_notes_character ON character_notes(character_id);
  `,

  // v16 — Fase 8.7: visión en la oscuridad por personaje (darkvision), en
  // casillas. Campo manual como los rasgos de clase/raza (texto libre): el
  // jugador lo rellena, no se deduce automáticamente de su raza. Se combina
  // con el radio de niebla del mapa (el mayor de los dos) al calcular
  // visión, nunca lo sustituye.
  `
  ALTER TABLE characters ADD COLUMN darkvision INTEGER NOT NULL DEFAULT 0;
  `,

  // v17 — Fase 8.7: dificultad opcional para forzar puertas o interactuar
  // con marcadores de trampa/objeto. dc es la dificultad (CD) de la tirada,
  // oculta al jugador hasta resolver el intento, igual que la CA en
  // combate; skill es el nombre de la habilidad narrada (ej. 'atletismo'),
  // visible antes de tirar para que el jugador sepa qué tira. NULL en
  // ambas = se abre/interactúa gratis, sin tirada.
  `
  ALTER TABLE map_doors ADD COLUMN dc INTEGER;
  ALTER TABLE map_doors ADD COLUMN skill TEXT;
  ALTER TABLE map_tokens ADD COLUMN dc INTEGER;
  ALTER TABLE map_tokens ADD COLUMN skill TEXT;
  `,

  // v18 — Fase 8.8: plazas, lore y objetivos de campaña (pantalla de carga),
  // y punto de aparición marcado por el DM en una sala (mismo patrón que
  // obstacle_cells: pares [col, fila] relativos al origen de la sala).
  // max_players NULL = sin límite. objectives es JSON, lista de strings.
  `
  ALTER TABLE campaigns ADD COLUMN max_players INTEGER;
  ALTER TABLE campaigns ADD COLUMN lore TEXT NOT NULL DEFAULT '';
  ALTER TABLE campaigns ADD COLUMN objectives TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE map_rooms ADD COLUMN spawn_cells TEXT NOT NULL DEFAULT '[]';
  `,

  // v19 — Mapa de campaña (mapa de mundo): una capa por encima del tablero.
  // El DM decide al crear la campaña si "forma parte de un mapa" (has_world_map).
  // Sobre una imagen de mundo (world_map_url) coloca ubicaciones (puntos de
  // interés), cada una con su lore y enlazada a un mapa jugable de la biblioteca
  // (map_id). El grupo "viaja" a una ubicación (current_location_id en
  // game_tables), lo que activa el mapa enlazado. En esta fase todas las
  // ubicaciones son visibles para todos (sin ocultas). El lore de apertura
  // reutiliza campaigns.lore de la v18.
  `
  ALTER TABLE campaigns ADD COLUMN has_world_map INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN world_map_url TEXT;

  -- x/y: posición del pin en porcentaje (0-100) sobre la imagen del mundo,
  -- independiente del tamaño de render. map_id ON DELETE SET NULL: borrar el
  -- mapa de la biblioteca desvincula la ubicación, no la borra.
  CREATE TABLE world_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Ubicación sin nombre',
    x REAL NOT NULL DEFAULT 50,
    y REAL NOT NULL DEFAULT 50,
    lore TEXT NOT NULL DEFAULT '',
    map_id INTEGER REFERENCES maps(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_world_locations_campaign ON world_locations(campaign_id);

  -- Ubicación actual del grupo. Sin ON DELETE (mismo criterio que
  -- active_map_id, v8): se limpia a mano al borrar la ubicación.
  ALTER TABLE game_tables ADD COLUMN current_location_id INTEGER;
  `,

  // v20 — Fase 8 (cierre): personaje como jefe/boss. En vez de un sistema de
  // plantillas de enemigo aparte, un "personaje" puede ser kind='boss': lo
  // crea el DM en la sección de Personajes, reutilizando ficha completa
  // (stats, avatar generado por IA, notas) sin pasar por el asistente
  // guiado de PJ. Un marcador de enemigo en el editor de mapas puede
  // enlazarse a un jefe (map_tokens.character_id) en vez de/además de un
  // monstruo del compendio SRD.
  `
  ALTER TABLE characters ADD COLUMN kind TEXT NOT NULL DEFAULT 'pj' CHECK (kind IN ('pj', 'boss'));
  ALTER TABLE map_tokens ADD COLUMN character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;
  `,

  // v21 — Hub de campañas: creación guiada como los personajes. status
  // 'draft' nace al pulsar crear, antes de rellenar nada; el DM la completa
  // paso a paso (autoguardado) y "termina" el asistente cuando pone
  // status='complete'. Las campañas ya existentes nacen 'complete' (no
  // pasaron por el asistente, no hace falta que lo hagan). wizard_step
  // recuerda en qué paso se quedó, igual que characters.wizard_step.
  `
  ALTER TABLE campaigns ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('draft', 'complete'));
  ALTER TABLE campaigns ADD COLUMN wizard_step INTEGER NOT NULL DEFAULT 0;
  `,

  // v22 — Bestiario del DM (adelanto de la Fase 11): favoritos del compendio
  // por usuario (monstruos hoy; category/idx genéricos para reutilizarlo con
  // hechizos o equipo en el buscador de la Fase 11) e imagen personalizada
  // por monstruo del SRD (subida o generada con IA una vez y reutilizada en
  // cada marcador del tablero, en vez de regenerarla cada vez).
  `
  CREATE TABLE srd_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    idx TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, category, idx)
  );

  CREATE TABLE monster_images (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    monster_idx TEXT NOT NULL,
    avatar_path TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, monster_idx)
  );
  `,

  // v23 — Fase 15: biblioteca del DM (objetos y hechizos propios). Por
  // usuario (no por campaña): una colección reutilizable en cualquier
  // campaña. `data` guarda un JSON con la MISMA forma que una entrada del
  // SRD (equipment/spells) para reutilizar el serializador `buildMeta`, el
  // detalle y el consumo desde la ficha sin formato paralelo; en los
  // listados/detalle del compendio se mezclan con index sintético
  // `custom:<id>` y bandera `custom: true`.
  `
  CREATE TABLE custom_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_custom_items_user ON custom_items(user_id);

  CREATE TABLE custom_spells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_custom_spells_user ON custom_spells(user_id);
  `,

  // v24 — Fase 21: secciones dinámicas de la ficha. El jugador crea bloques
  // propios (título + tipo texto/lista/srd + contenido) para organizar la
  // ficha a su gusto; una sola columna JSON en characters, sin tablas
  // aparte. Un bloque 'srd' enlaza entradas del compendio por index.
  `
  ALTER TABLE characters ADD COLUMN custom_sections TEXT NOT NULL DEFAULT '[]';
  `,

  // v25 — Fase 16: asignación de contenido de la biblioteca del DM a una
  // campaña. content_type distingue objeto/hechizo; content_id apunta a
  // custom_items/custom_spells. El marcador NPC no necesita esquema nuevo:
  // reutiliza un marcador 'aliado' enlazado a un personaje del DM
  // (map_tokens.character_id, v20), evitando reconstruir el CHECK de kind.
  `
  CREATE TABLE campaign_library (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('objeto', 'hechizo')),
    content_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (campaign_id, content_type, content_id)
  );
  `,

  // v26 — Fase 17 (variantes por instancia / minibosses) y Fase 20 (botín).
  // overrides: JSON por marcador con stats de ESTA instancia concreta
  //   { hp, ac, speed, attackBonus, damageBonus, traits: [{name, desc}] };
  //   se aplican con prioridad sobre el SRD/jefe al aparecer el enemigo y se
  //   copian al combatiente para que el bloque de estadísticas del DM los use.
  // loot: JSON con la tabla de botín del enemigo (objetos con probabilidad);
  //   al morir se tira y se deja un marcador 'objeto' saqueable con lo caído.
  `
  ALTER TABLE map_tokens ADD COLUMN overrides TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE map_tokens ADD COLUMN loot TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE combatants ADD COLUMN overrides TEXT NOT NULL DEFAULT '{}';
  `,

  // v27 — Terreno difícil y movimiento por camino real. terrain_cells:
  // JSON [[col, fila, coste], ...] relativo a la sala (mismo patrón que
  // obstacle_cells con un coste extra): entrar en esa casilla cuesta
  // `coste` puntos de movimiento en vez de 1. El movimiento pasa de
  // distancia Chebyshev en línea recta a coste del CAMINO más barato
  // (Dijkstra, services/pathfinding.js), validado en servidor.
  `
  ALTER TABLE map_rooms ADD COLUMN terrain_cells TEXT NOT NULL DEFAULT '[]';
  `,

  // v28 — Fases 18/19: eventos y efectos del DM con disparadores.
  // dm_events: biblioteca reutilizable por usuario (como custom_items), con
  //   pasiva/consecuencia en texto (effect) y disparador: 'manual' (solo a la
  //   vista del DM), 'rondas' (cada N rondas del combate) o 'revelar' (al
  //   revelarse la sala enlazada, una sola vez). hidden = el aviso va como
  //   mensaje oculto (solo DM), mismo patrón que las tiradas ocultas.
  // event_links: dónde cuelga cada evento en una campaña (la propia campaña,
  //   una sala o un marcador). last_fired_round/fired evitan el doble disparo.
  `
  CREATE TABLE dm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    effect TEXT NOT NULL DEFAULT '',
    trigger_kind TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'rondas', 'revelar')),
    trigger_every INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_dm_events_user ON dm_events(user_id);

  CREATE TABLE event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES dm_events(id) ON DELETE CASCADE,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('campana', 'sala', 'marcador')),
    target_id INTEGER,
    last_fired_round INTEGER,
    fired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_event_links_campaign ON event_links(campaign_id);
  `,
];

export function runMigrations() {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`[db] migración aplicada: v${v + 1}`);
  }
}
