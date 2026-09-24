import Database from 'better-sqlite3';
import { DB_PATH } from './config.js';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migraciones incrementales controladas por PRAGMA user_version.
// Cada entrada se ejecuta una sola vez y en orden; añadir nuevas al final.
// Se exporta para poder probar una migración concreta sobre una base
// temporal (ver services/__tests__/migrations.test.js): ninguna debe perder
// datos de partidas ya jugadas.
export const migrations = [
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

  // v29 — Paredes por arista de casilla (prerrequisito del importador UVTT).
  // JSON [[col, fila, lado], ...] relativo al origen de la sala, con lado
  // 'n'|'e'|'s'|'o': una pared fina sobre ese borde de la casilla. Bloquea el
  // paso (pathfinding) y la línea de visión (niebla fina), validado siempre
  // en servidor. A diferencia de un obstáculo, la casilla sigue siendo
  // pisable: solo se cierra ese lado.
  `
  ALTER TABLE map_rooms ADD COLUMN wall_edges TEXT NOT NULL DEFAULT '[]';
  `,

  // v30 — Color de las paredes por mapa: el DM lo elige con un selector en el
  // editor y aplica a todas las paredes de ese mapa (tablero 3D y lienzo 2D).
  // Es solo cosmético, así que también viaja al jugador.
  `
  ALTER TABLE maps ADD COLUMN wall_color TEXT NOT NULL DEFAULT '#9b8555';
  `,

  // v31 — Refino del combate por turnos: más acciones y estados de combatiente.
  // dashed: acción Correr gastada este turno → dobla el presupuesto de
  //   movimiento (se resetea al empezar SU turno, como el resto de recursos).
  // stance: postura tomada con la acción este turno, 'esquivar' | 'destrabarse'
  //   | NULL — solo informativa/narrativa (la app no autodetecta disparadores),
  //   también por turno.
  // conditions: JSON con las condiciones activas (envenenado, derribado…). A
  //   diferencia de los recursos del turno, PERSISTE entre turnos: la quita el
  //   DM a mano (o la lógica que la puso).
  // death_successes/death_failures: salvaciones de muerte de un PJ a 0 PG
  //   (0..3 cada una). Se ponen a 0 al caer, se limpian al estabilizarse,
  //   curarse o al terminar el combate (borrado del tracker).
  `
  ALTER TABLE combatants ADD COLUMN dashed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN stance TEXT;
  ALTER TABLE combatants ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE combatants ADD COLUMN death_successes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN death_failures INTEGER NOT NULL DEFAULT 0;
  `,

  // v32 — Elevación por casilla: JSON [[col, fila, nivel], ...] relativo al
  // origen de la sala (mismo patrón que terrain_cells). nivel es un entero de
  // "escalones" de 5 pies: positivo = plataforma/altura, negativo = foso. Las
  // casillas sin listar están a nivel 0. Subir cuesta movimiento extra
  // (pathfinding); es geometría visible, así que también viaja al jugador.
  `
  ALTER TABLE map_rooms ADD COLUMN elevation_cells TEXT NOT NULL DEFAULT '[]';
  `,

  // v33 — Luces del tablero (visuales, la niebla por niveles de luz queda
  // para la fase 12). light_cells: JSON [[col, fila]] relativo a la sala,
  // fuentes de luz puestas a mano por el DM (braseros, velas...).
  // wall_light_every: cada cuántas casillas brota una antorcha automática en
  // las paredes del mapa (0 = desactivadas, el DM las pone todas a mano).
  `
  ALTER TABLE map_rooms ADD COLUMN light_cells TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE maps ADD COLUMN wall_light_every INTEGER NOT NULL DEFAULT 4;
  `,

  // v34 — Mapa de mundo por capas: submapas (ciudades) y tipos de ubicación.
  // world_maps: cada fila es una imagen con pins (el mapa raíz de la campaña
  //   o un submapa, p. ej. una ciudad). La jerarquía no lleva parent_id: el
  //   padre de un submapa es el mapa donde vive el pin que lo enlaza
  //   (world_locations.target_world_map_id).
  // campaigns.root_world_map_id: el mapa raíz (sin ON DELETE, mismo criterio
  //   que active_map_id: la API nunca borra el raíz). campaigns.world_map_url
  //   queda obsoleta (la imagen vive ahora en world_maps.image_url).
  // world_locations.kind: 'dungeon' | 'ciudad' | 'campamento' | 'evento',
  //   validado en ruta (sin CHECK, para poder añadir tipos sin reconstruir).
  // world_locations.hidden: pin oculto a los jugadores (emboscadas de camino),
  //   filtrado en SERVIDOR como las tiradas ocultas; se revela al viajar allí.
  // game_tables.current_world_map_id: qué capa está mirando el grupo.
  // event_links se reconstruye (nadie la referencia) para ampliar el CHECK de
  //   target_type con 'ubicacion': el disparador 'revelar' pasa a significar
  //   "al revelarse la sala / al llegar a la ubicación" (el CHECK de dm_events
  //   no se toca, precedente de la Fase 16).
  `
  CREATE TABLE world_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Mapa de mundo',
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_world_maps_campaign ON world_maps(campaign_id);

  ALTER TABLE campaigns ADD COLUMN root_world_map_id INTEGER;

  INSERT INTO world_maps (campaign_id, name, image_url)
    SELECT id, 'Mapa de mundo', world_map_url
    FROM campaigns WHERE has_world_map = 1 OR world_map_url IS NOT NULL;
  UPDATE campaigns SET root_world_map_id =
    (SELECT wm.id FROM world_maps wm WHERE wm.campaign_id = campaigns.id);

  ALTER TABLE world_locations ADD COLUMN world_map_id INTEGER REFERENCES world_maps(id) ON DELETE CASCADE;
  UPDATE world_locations SET world_map_id =
    (SELECT c.root_world_map_id FROM campaigns c WHERE c.id = world_locations.campaign_id);
  ALTER TABLE world_locations ADD COLUMN kind TEXT NOT NULL DEFAULT 'dungeon';
  ALTER TABLE world_locations ADD COLUMN target_world_map_id INTEGER REFERENCES world_maps(id) ON DELETE SET NULL;
  ALTER TABLE world_locations ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE game_tables ADD COLUMN current_world_map_id INTEGER;
  UPDATE game_tables SET current_world_map_id =
    (SELECT c.root_world_map_id FROM campaigns c WHERE c.id = game_tables.campaign_id);

  CREATE TABLE event_links_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES dm_events(id) ON DELETE CASCADE,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('campana', 'sala', 'marcador', 'ubicacion')),
    target_id INTEGER,
    last_fired_round INTEGER,
    fired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO event_links_new (id, event_id, campaign_id, target_type, target_id, last_fired_round, fired, created_at)
    SELECT id, event_id, campaign_id, target_type, target_id, last_fired_round, fired, created_at FROM event_links;
  DROP TABLE event_links;
  ALTER TABLE event_links_new RENAME TO event_links;
  CREATE INDEX idx_event_links_campaign ON event_links(campaign_id);
  `,

  // v35 — Biblioteca de plantillas del DM (salas, dungeons enteros, ciudades
  // del mundo y enemigos configurados). Por usuario, como custom_items o
  // dm_events: se guardan desde una campaña y se instancian en cualquiera.
  // data: snapshot JSON (services/templates.js); las imágenes se referencian
  //   por URL de /uploads/maps (borrar mapas nunca borra archivos).
  // kind: 'sala' | 'mapa' | 'ciudad' | 'enemigo', validado en ruta (sin
  //   CHECK, para añadir tipos sin reconstruir, mismo criterio que v34).
  // meta: resumen precalculado para listados (plantas/salas/tamaño/pins).
  `
  CREATE TABLE dm_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    preview_url TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_dm_templates_user ON dm_templates(user_id);
  `,

  // v36 — Percepción y visión de criaturas (Fase 10.5). La CD de
  // percepción pertenece a la trampa y nunca se envía al jugador mientras
  // siga oculta; vision_radius permite al DM previsualizar qué detecta cada
  // enemigo/PNJ sin mezclarlo con el radio global del mapa.
  `
  ALTER TABLE map_tokens ADD COLUMN perception_dc INTEGER;
  ALTER TABLE map_tokens ADD COLUMN vision_radius INTEGER NOT NULL DEFAULT 6;
  `,

  // v37 — Consecuencias informativas de trampas y objetos. Se guardan las
  // dos ramas, pero el jugador solo recibe la que corresponda después de
  // resolver la interacción; nunca viajan por adelantado en el mapa.
  `
  ALTER TABLE map_tokens ADD COLUMN success_consequence TEXT NOT NULL DEFAULT '';
  ALTER TABLE map_tokens ADD COLUMN failure_consequence TEXT NOT NULL DEFAULT '';
  `,

  // v38 — Organización de las fichas del DM. Internamente siguen siendo
  // characters.kind='boss' para conservar compatibilidad con mapas, combate
  // y avatares; esta categoría solo separa enemigos, jefes y PNJ en la UI.
  `
  ALTER TABLE characters ADD COLUMN dm_category TEXT;
  UPDATE characters SET dm_category = 'jefe' WHERE kind = 'boss';
  `,

  // v39 — Tipo de partida independiente del mapa de mundo y archivo
  // narrativo privado por campaña. Una campaña puede existir sin mapa de
  // mundo y una escaramuza sigue siendo una mesa rápida: has_world_map deja
  // de ser el discriminador de producto. El archivo usa un árbol de
  // secciones/entradas y bloques ordenados. image_path es siempre una clave
  // privada bajo data/narrative-media; nunca una URL pública de /uploads.
  `
  ALTER TABLE campaigns ADD COLUMN campaign_type TEXT NOT NULL DEFAULT 'campana'
    CHECK (campaign_type IN ('campana', 'escaramuza'));
  UPDATE campaigns
     SET campaign_type = CASE WHEN has_world_map = 1 THEN 'campana' ELSE 'escaramuza' END;

  CREATE TABLE campaign_narrative_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES campaign_narrative_nodes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'entrada' CHECK (kind IN ('seccion', 'entrada')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_campaign_narrative_nodes_tree
    ON campaign_narrative_nodes(campaign_id, parent_id, position, id);

  CREATE TABLE campaign_narrative_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL REFERENCES campaign_narrative_nodes(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'texto'
      CHECK (type IN ('texto', 'imagen', 'video', 'enlace', 'musica')),
    content TEXT NOT NULL DEFAULT '',
    url TEXT,
    caption TEXT NOT NULL DEFAULT '',
    alt_text TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    image_mime TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (image_path IS NULL OR type = 'imagen')
  );
  CREATE INDEX idx_campaign_narrative_blocks_node
    ON campaign_narrative_blocks(node_id, position, id);

  INSERT INTO campaign_narrative_nodes (campaign_id, kind, title, position)
    SELECT id, 'seccion', 'Lore general', 0 FROM campaigns WHERE campaign_type = 'campana';
  INSERT INTO campaign_narrative_nodes (campaign_id, kind, title, position)
    SELECT id, 'seccion', 'Personajes', 1 FROM campaigns WHERE campaign_type = 'campana';
  INSERT INTO campaign_narrative_nodes (campaign_id, kind, title, position)
    SELECT id, 'seccion', 'Facciones', 2 FROM campaigns WHERE campaign_type = 'campana';
  INSERT INTO campaign_narrative_nodes (campaign_id, kind, title, position)
    SELECT id, 'seccion', 'Lugares', 3 FROM campaigns WHERE campaign_type = 'campana';
  INSERT INTO campaign_narrative_nodes (campaign_id, kind, title, position)
    SELECT id, 'seccion', 'Tramas y sesiones', 4 FROM campaigns WHERE campaign_type = 'campana';
  `,

  // v40 — Conservación del lore anterior al archivo. campaigns.lore sigue
  // siendo la introducción pública para los jugadores; esta migración hace
  // además una copia privada editable bajo «Lore general» para que ningún DM
  // pierda el texto que ya había preparado al adoptar el nuevo archivo.
  `
  INSERT INTO campaign_narrative_nodes
    (campaign_id, parent_id, kind, title, summary, position)
  SELECT c.id, section.id, 'entrada', 'Introducción heredada',
         'Copia del lore público existente al crear el archivo narrativo.',
         COALESCE((
           SELECT MAX(sibling.position) + 1
             FROM campaign_narrative_nodes sibling
            WHERE sibling.parent_id = section.id
         ), 0)
    FROM campaigns c
    JOIN campaign_narrative_nodes section
      ON section.campaign_id = c.id
     AND section.parent_id IS NULL
     AND section.kind = 'seccion'
     AND section.title = 'Lore general'
   WHERE c.campaign_type = 'campana'
     AND trim(c.lore) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM campaign_narrative_nodes existing
        WHERE existing.campaign_id = c.id
          AND existing.parent_id = section.id
          AND existing.title = 'Introducción heredada'
     );

  INSERT INTO campaign_narrative_blocks
    (node_id, type, content, position)
  SELECT entry.id, 'texto', c.lore, 0
    FROM campaigns c
    JOIN campaign_narrative_nodes entry
      ON entry.id = (
        SELECT MAX(candidate.id)
          FROM campaign_narrative_nodes candidate
          JOIN campaign_narrative_nodes parent ON parent.id = candidate.parent_id
         WHERE candidate.campaign_id = c.id
           AND candidate.title = 'Introducción heredada'
           AND parent.title = 'Lore general'
      )
   WHERE c.campaign_type = 'campana'
     AND trim(c.lore) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM campaign_narrative_blocks block WHERE block.node_id = entry.id
     );
  `,

  // v41 — Publicación selectiva del archivo narrativo. La visibilidad vive
  // en cada entrada y se filtra en servidor junto con sus bloques/imágenes.
  // Las secciones se incluyen al jugador solo cuando son ancestros de al
  // menos una entrada publicada.
  `
  ALTER TABLE campaign_narrative_nodes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'players'));
  `,

  // v42 — Audiencia de las consecuencias de objetos y trampas. El texto
  // sigue siendo privado del DM hasta resolver la interacción o recoger el
  // objeto; entonces puede mostrarse solo al personaje implicado o a todo el
  // grupo mediante el chat filtrado del servidor.
  `
  ALTER TABLE map_tokens ADD COLUMN consequence_scope TEXT NOT NULL DEFAULT 'player'
    CHECK (consequence_scope IN ('player', 'party'));
  `,

  // v43 — Iconos editables del archivo narrativo. NULL conserva el modo
  // automático: el servidor infiere un icono contextual por tipo y título,
  // por lo que los archivos existentes no necesitan una actualización masiva.
  `
  ALTER TABLE campaign_narrative_nodes ADD COLUMN icon TEXT
    CHECK (icon IS NULL OR icon IN (
      'folder', 'book', 'scroll', 'document', 'users', 'flag', 'pin', 'map',
      'castle', 'crown', 'shield', 'sword', 'skull', 'gem', 'potion', 'sparkles'
    ));
  `,

  // v44 — Iniciativa auditable y concentración.
  //
  // initiative_source distingue los tres estados que initiative (INTEGER NOT
  // NULL DEFAULT 0) no puede expresar por sí sola: NULL = todavía sin tirar,
  // 'auto' = la tiró el servidor, 'manual' = la escribió el DM. Hace falta
  // porque 0 es un total legítimo (un 1 natural con DES -1), así que no se
  // puede usar como centinela de "sin tirar" al respetar tiradas previas.
  //
  // initiative_d20/initiative_mod guardan el desglose de la tirada automática
  // para que la mesa pueda comprobar de dónde sale cada valor mucho después
  // de que el mensaje de chat se haya perdido en el scroll. NULL con
  // source='manual': un número escrito a mano no tiene desglose.
  //
  // concentration_spell guarda el nombre del hechizo al que se concentra un
  // combatiente (NULL = no concentra). Se guarda el nombre y no un booleano
  // porque la mesa necesita saber QUÉ se cae cuando falla la salvación.
  `
  ALTER TABLE combatants ADD COLUMN initiative_source TEXT
    CHECK (initiative_source IS NULL OR initiative_source IN ('auto', 'manual'));
  ALTER TABLE combatants ADD COLUMN initiative_d20 INTEGER;
  ALTER TABLE combatants ADD COLUMN initiative_mod INTEGER;
  ALTER TABLE combatants ADD COLUMN concentration_spell TEXT;
  `,

  // v45 — Clases y razas personalizables del DM (Fase 26, corte 1). Mismo
  // patrón que custom_items/custom_spells (v15): por usuario, reutilizables en
  // cualquier campaña, con `data` JSON que la ficha consumirá igual que una
  // entrada del SRD. La forma del `data` (bonos de característica, velocidad,
  // destrezas, resistencias, rasgos…) la valida el servidor en routes/library;
  // aquí solo se guarda el blob, como con objetos y hechizos.
  `
  CREATE TABLE custom_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_custom_classes_user ON custom_classes(user_id);

  CREATE TABLE custom_races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_custom_races_user ON custom_races(user_id);
  `,

  // v46 — Exploración v2 (Corte A): descubrimiento del mapa de mundo. Estado
  // 'visitada' por ubicación, marcado al viajar allí (world.js). A diferencia
  // de `hidden`, NO es secreto: viaja a todos los jugadores y alimenta la
  // "penumbra" del mapa (las ubicaciones aún no visitadas se pintan atenuadas).
  // La ubicación actual del grupo se marca ya visitada aquí para que las
  // campañas existentes no arranquen con el mapa entero a oscuras.
  `
  ALTER TABLE world_locations ADD COLUMN visited INTEGER NOT NULL DEFAULT 0;
  UPDATE world_locations SET visited = 1 WHERE id IN
    (SELECT current_location_id FROM game_tables WHERE current_location_id IS NOT NULL);
  `,

  // v47 — Resolución mecánica del combate. Los PG temporales de los PJ ya
  // vivían en characters; el tracker necesita el equivalente para enemigos.
  // multiattack_state guarda solo la secuencia restante del turno.
  `
  ALTER TABLE combatants ADD COLUMN hp_temp INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN multiattack_state TEXT NOT NULL DEFAULT '{}';
  `,

  // v48 — Índice de texto completo del compendio (FTS5). Tabla virtual con el
  // texto aplanado de cada entrada del SRD (nombres es/en, descripción
  // traducida y toda la prosa del `data`: rasgos, acciones, condiciones,
  // reglas…). category/idx quedan UNINDEXED (se guardan para localizar la fila
  // en srd_entries, no se tokenizan). remove_diacritics 2 pliega acentos para
  // que "hidra" encuentre "Hidra" y "bola de fuego" ignore las tildes. La
  // tabla se POBLA fuera de la migración (services/srdSearch.js), al arrancar
  // el servidor y al sincronizar, porque el aplanado necesita lógica JS que no
  // cabe en SQL puro; así las bases ya sincronizadas se rellenan sin re-sync.
  `
  CREATE VIRTUAL TABLE IF NOT EXISTS srd_fts USING fts5(
    category UNINDEXED,
    idx UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,

  // v49 — Exploración v2 (Corte B): red de rutas por capa del mapa de
  // mundo. El sentido natural es from → to; one_way=0 permite recorrerla en
  // ambos sentidos. Las rutas desaparecen con su capa o cualquiera de sus
  // extremos. La pertenencia de ambos pins a la misma campaña/capa y la
  // ausencia de duplicados se validan en routes/world.js.
  `
  CREATE TABLE world_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    world_map_id INTEGER NOT NULL REFERENCES world_maps(id) ON DELETE CASCADE,
    from_location_id INTEGER NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
    to_location_id INTEGER NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
    cost INTEGER NOT NULL DEFAULT 1 CHECK (cost >= 1),
    label TEXT NOT NULL DEFAULT '',
    one_way INTEGER NOT NULL DEFAULT 0 CHECK (one_way IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (from_location_id <> to_location_id)
  );
  CREATE INDEX idx_world_routes_campaign ON world_routes(campaign_id);
  CREATE INDEX idx_world_routes_map ON world_routes(world_map_id);
  CREATE INDEX idx_world_routes_from ON world_routes(from_location_id);
  CREATE INDEX idx_world_routes_to ON world_routes(to_location_id);
  `,

  // v50 — Referencias del compendio dentro del chat. El texto sigue en
  // `body` para conservar compatibilidad con todo el historial; esta columna
  // guarda únicamente los rangos y las claves SRD validadas por el servidor.
  // No se permiten referencias a la biblioteca privada del DM.
  `
  ALTER TABLE chat_messages ADD COLUMN srd_references TEXT NOT NULL DEFAULT '[]';
  `,

  // v51 — Ataques de oportunidad detectados por el camino real. La decisión
  // es opcional y puede sobrevivir a una recarga: se guarda quién reacciona,
  // a quién alcanza y las opciones cuerpo a cuerpo que cruzaron su alcance.
  `
  CREATE TABLE opportunity_attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    attacker_combatant_id INTEGER NOT NULL REFERENCES combatants(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('personaje', 'marcador')),
    target_character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    target_map_token_id INTEGER REFERENCES map_tokens(id) ON DELETE CASCADE,
    attacker_name TEXT NOT NULL,
    target_name TEXT NOT NULL,
    attacks TEXT NOT NULL DEFAULT '[]',
    created_round INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
      (target_kind = 'personaje' AND target_character_id IS NOT NULL AND target_map_token_id IS NULL) OR
      (target_kind = 'marcador' AND target_map_token_id IS NOT NULL AND target_character_id IS NULL)
    )
  );
  CREATE INDEX idx_opportunity_campaign ON opportunity_attacks(campaign_id);
  CREATE INDEX idx_opportunity_attacker ON opportunity_attacks(attacker_combatant_id);
  `,

  // v52 — Exploración v2 (Corte C): reloj narrativo acumulado por campaña y
  // eventos asociados a rutas. El enlace polimórfico no puede tener una FK
  // directa a world_routes; el trigger evita enlaces huérfanos cuando una
  // ruta desaparece directamente o por cascada al borrar su capa/extremos.
  `
  ALTER TABLE campaigns ADD COLUMN elapsed_days INTEGER NOT NULL DEFAULT 0
    CHECK (elapsed_days >= 0);

  CREATE TABLE event_links_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES dm_events(id) ON DELETE CASCADE,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('campana', 'sala', 'marcador', 'ubicacion', 'ruta')),
    target_id INTEGER,
    last_fired_round INTEGER,
    fired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO event_links_new (id, event_id, campaign_id, target_type, target_id, last_fired_round, fired, created_at)
    SELECT id, event_id, campaign_id, target_type, target_id, last_fired_round, fired, created_at FROM event_links;
  DROP TABLE event_links;
  ALTER TABLE event_links_new RENAME TO event_links;
  CREATE INDEX idx_event_links_campaign ON event_links(campaign_id);

  CREATE TRIGGER cleanup_world_route_event_links
  AFTER DELETE ON world_routes
  BEGIN
    DELETE FROM event_links WHERE target_type = 'ruta' AND target_id = OLD.id;
  END;
  `,

  // v53 — Capa decorativa de fluidos por sala. Cada entrada se guarda como
  // [columna, fila, tipo] y se serializa junto al resto de capas del mapa.
  `
  ALTER TABLE map_rooms ADD COLUMN fluid_cells TEXT NOT NULL DEFAULT '[]';
  `,

  // v54 — Dirección artística reutilizable para todas las imágenes de una
  // campaña. Las restricciones técnicas se siguen añadiendo en el servidor.
  `
  ALTER TABLE campaigns ADD COLUMN art_style TEXT NOT NULL DEFAULT '';
  `,

  // v55 — Reglas mecánicas de los fluidos por mapa. Un objeto vacío usa
  // siempre los valores recomendados definidos en el servidor.
  `
  ALTER TABLE maps ADD COLUMN fluid_effects TEXT NOT NULL DEFAULT '{}';
  `,

  // v56 — Condiciones temporales añadidas por fluidos. Se separa su origen
  // para no retirar por accidente una condición que el DM puso a mano.
  `
  ALTER TABLE combatants ADD COLUMN fluid_conditions TEXT NOT NULL DEFAULT '[]';
  `,

  // v57 — Ciclo completo de muerte y condiciones con caducidad. El estado
  // explícito distingue a un PJ estabilizado de uno que sigue agonizando a
  // 0 PG; los temporizadores son independientes de las condiciones de fluidos.
  `
  ALTER TABLE combatants ADD COLUMN death_state TEXT NOT NULL DEFAULT 'normal'
    CHECK (death_state IN ('normal', 'dying', 'stable', 'dead'));
  ALTER TABLE combatants ADD COLUMN condition_timers TEXT NOT NULL DEFAULT '[]';

  UPDATE combatants
     SET death_state = CASE
       WHEN kind = 'pj'
        AND character_id IS NOT NULL
        AND COALESCE((SELECT hp_current FROM characters WHERE id = combatants.character_id), 1) <= 0
       THEN CASE WHEN death_failures >= 3 THEN 'dead' ELSE 'dying' END
       ELSE 'normal'
     END;
  `,

  // v58 — Una salvación de muerte por turno sin consumir la acción. Se usa
  // la ronda porque cada combatiente recibe un turno ordinario por ronda.
  `
  ALTER TABLE combatants ADD COLUMN death_save_round INTEGER;
  `,

  // v59 — Recursos de jefe: las acciones legendarias se recargan al inicio
  // de su turno y la guarida solo puede actuar una vez por ronda.
  `
  ALTER TABLE combatants ADD COLUMN legendary_points_max INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN legendary_points INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN lair_action_round INTEGER;
  `,

  // v60 — Zonas de peligro temporales sobre casillas absolutas del tablero.
  // Son visibles para toda la mesa; la resolución de daño/salvación vive en
  // servidor y su caducidad se expresa en rondas del combate.
  `
  CREATE TABLE combat_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    visual_type TEXT NOT NULL DEFAULT 'fuego',
    cells TEXT NOT NULL DEFAULT '[]',
    trigger_timing TEXT NOT NULL DEFAULT 'both'
      CHECK (trigger_timing IN ('enter', 'start', 'both')),
    save_ability TEXT CHECK (save_ability IN ('str', 'dex', 'con', 'int', 'wis', 'cha')),
    save_dc INTEGER,
    damage_dice TEXT NOT NULL DEFAULT '',
    damage_type TEXT,
    half_on_save INTEGER NOT NULL DEFAULT 1,
    condition TEXT,
    expires_round INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_combat_zones_map ON combat_zones(map_id, expires_round);
  `,

  // v61 — Ambiente persistente por escena (cada mapa es una escena).
  `
  ALTER TABLE maps ADD COLUMN weather TEXT NOT NULL DEFAULT 'despejado'
    CHECK (weather IN ('despejado', 'lluvia', 'nieve', 'niebla'));
  ALTER TABLE maps ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'dia'
    CHECK (time_of_day IN ('amanecer', 'dia', 'atardecer', 'noche'));
  ALTER TABLE maps ADD COLUMN weather_intensity REAL NOT NULL DEFAULT 0.55;
  `,

  // v62 — Bestiario de campaña descubierto automáticamente. No guarda
  // estadísticas secretas: solo la identidad pública y cuántas apariciones
  // ha tenido, de modo que la ruta de jugador nunca necesita filtrar PG/CA.
  `
  CREATE TABLE campaign_bestiary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    creature_key TEXT NOT NULL,
    monster_index TEXT,
    display_name TEXT NOT NULL,
    appearances INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (campaign_id, creature_key)
  );
  CREATE INDEX idx_campaign_bestiary_campaign ON campaign_bestiary(campaign_id, last_seen_at);
  `,

  // v63 — Normaliza datos históricos creados cuando la interfaz permitía
  // PG negativos. Las reglas nuevas ya impiden volver a guardarlos.
  `
  UPDATE characters SET hp_current = 0 WHERE hp_current < 0;
  UPDATE combatants SET hp_current = 0 WHERE hp_current < 0;
  `,

  // v64 — El diario nace también con las criaturas que ya estaban en el
  // tracker al instalar la función; los descubrimientos futuros usan el
  // registro incremental normal.
  `
  INSERT OR IGNORE INTO campaign_bestiary
    (campaign_id, creature_key, monster_index, display_name, appearances)
  SELECT campaign_id,
         CASE WHEN monster_index IS NOT NULL AND monster_index <> ''
              THEN 'monster:' || monster_index
              ELSE 'custom:' || lower(name) END,
         monster_index,
         name,
         1
    FROM combatants
   WHERE kind = 'enemigo';
  `,

  // v65 — Automatización enemiga por mesa. Nace desactivada para no cambiar
  // campañas existentes; los tres escenarios de fábrica la activan al crearse
  // y el DM puede pausarla desde el tracker en cualquier momento.
  `
  ALTER TABLE game_tables ADD COLUMN enemy_ai_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (enemy_ai_enabled IN (0, 1));

  -- Los escenarios ya instanciados son snapshots. Reconocemos los tres mapas
  -- de fábrica por su nombre estable para que también reciban fondo e IA; las
  -- escaramuzas personales permanecen intactas y con la IA pausada.
  UPDATE map_rooms SET background_url = '/skirmishes/paso-del-cuervo.webp'
   WHERE name = 'El paso' AND floor_id IN (
     SELECT floor.id FROM map_floors floor
       JOIN maps map ON map.id = floor.map_id
       JOIN campaigns campaign ON campaign.id = map.campaign_id
      WHERE map.name = 'Paso del Cuervo' AND campaign.campaign_type = 'escaramuza'
   );
  UPDATE map_rooms SET background_url = '/skirmishes/cripta-anegada.webp'
   WHERE name = 'Nave anegada' AND floor_id IN (
     SELECT floor.id FROM map_floors floor
       JOIN maps map ON map.id = floor.map_id
       JOIN campaigns campaign ON campaign.id = map.campaign_id
      WHERE map.name = 'Cripta de los Doce Silentes' AND campaign.campaign_type = 'escaramuza'
   );
  UPDATE map_rooms SET background_url = '/skirmishes/puente-igneo.webp'
   WHERE name = 'Fosa de colada' AND floor_id IN (
     SELECT floor.id FROM map_floors floor
       JOIN maps map ON map.id = floor.map_id
       JOIN campaigns campaign ON campaign.id = map.campaign_id
      WHERE map.name = 'Fundición de Escoria Roja' AND campaign.campaign_type = 'escaramuza'
   );
  UPDATE game_tables SET enemy_ai_enabled = 1
   WHERE active_map_id IN (
     SELECT map.id FROM maps map JOIN campaigns campaign ON campaign.id = map.campaign_id
      WHERE campaign.campaign_type = 'escaramuza'
        AND map.name IN ('Paso del Cuervo', 'Cripta de los Doce Silentes', 'Fundición de Escoria Roja')
   );
  `,

  // v66 — Modo sin DM para los tres escenarios de fábrica. La cuenta que
  // crea la partida conserva la propiedad administrativa, pero el servidor
  // le aplica siempre la vista y los permisos de jugador durante la partida.
  `
  ALTER TABLE campaigns ADD COLUMN solo_mode INTEGER NOT NULL DEFAULT 0
    CHECK (solo_mode IN (0, 1));

  -- Solo se convierten instancias anteriores que ya tenían exactamente un PJ
  -- y ninguna otra persona: una mesa de grupo reconocida por el mismo mapa no
  -- debe cambiar de permisos al actualizar.
  UPDATE campaigns SET solo_mode = 1, max_players = 1
   WHERE campaign_type = 'escaramuza' AND id IN (
     SELECT map.campaign_id FROM maps map
      WHERE map.name IN ('Paso del Cuervo', 'Cripta de los Doce Silentes', 'Fundición de Escoria Roja')
   )
   AND (SELECT COUNT(*) FROM campaign_members member WHERE member.campaign_id = campaigns.id) = 1
   AND (SELECT COUNT(*) FROM characters character
         WHERE character.campaign_id = campaigns.id AND character.kind = 'pj') = 1;
  `,

  // v67 — Completa el fondo de la Cripta Anegada en las instancias ya
  // creadas. La v65 sólo lo asignó a la nave oculta, de modo que el jugador
  // empezaba en un vestíbulo sin imagen aunque el recurso sí estuviera en prod.
  `
  UPDATE map_rooms SET background_url = '/skirmishes/cripta-anegada.webp'
   WHERE name IN ('Vestíbulo derrumbado', 'Nave anegada', 'Sagrario')
     AND floor_id IN (
       SELECT floor.id FROM map_floors floor
         JOIN maps map ON map.id = floor.map_id
         JOIN campaigns campaign ON campaign.id = map.campaign_id
        WHERE map.name = 'Cripta de los Doce Silentes'
          AND campaign.campaign_type = 'escaramuza'
     );
  `,

  // v68 — Sonidos personalizados de la mesa. El catálogo (qué sonidos existen)
  // vive en el código; aquí solo se guarda QUIÉN ha sustituido cuál por un
  // fichero propio.
  //
  // `scope` nace preparado para las dos capas acordadas: hoy solo se usa
  // 'global' (los sonidos por defecto de toda la instalación, que cambia el
  // administrador) y más adelante entrará 'campaign' con el `scope_id` de la
  // mesa, para que cada DM pueda pisar los globales sin que estos desaparezcan.
  // Por eso el índice único incluye el ámbito: la misma clave puede tener un
  // sonido global y otro por campaña conviviendo.
  `
  CREATE TABLE IF NOT EXISTS sound_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id INTEGER,
    event_key TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sound_overrides_scope_key
    ON sound_overrides (scope, IFNULL(scope_id, 0), event_key);
  `,

  // v69 — Fase A de la rebanada vertical: slots de equipamiento reales en vez
  // de `equipped: bool`, y CA derivada de la armadura/escudo equipados.
  // `ac_override` (NULL = derivada) fuerza un valor manual para lo que las
  // reglas aún no cubren (ver server/src/rules/equipment.js).
  //
  // Migración de datos conservadora sobre fichas ya jugadas: el modelo
  // anterior permitía varias armas "equipadas" a la vez (sin slots
  // exclusivos), así que solo la primera pasa a la mano principal y el resto
  // vuelve a la mochila en vez de arriesgarse a violar los slots nuevos.
  (db) => {
    db.exec('ALTER TABLE characters ADD COLUMN ac_override INTEGER');
    const rows = db.prepare('SELECT id, inventory FROM characters').all();
    const update = db.prepare('UPDATE characters SET inventory = ? WHERE id = ?');
    for (const row of rows) {
      let inventory;
      try {
        inventory = JSON.parse(row.inventory);
      } catch {
        continue;
      }
      if (!Array.isArray(inventory)) continue;
      let mainHandTaken = false;
      const migrated = inventory.map((item) => {
        const { equipped, ...rest } = item ?? {};
        let slot = null;
        if (equipped && rest.weapon && !mainHandTaken) {
          slot = 'mano-principal';
          mainHandTaken = true;
        }
        return { ...rest, slot, armor: rest.armor ?? null };
      });
      update.run(JSON.stringify(migrated), row.id);
    }
  },

  // v70 — Fase B de la rebanada vertical: competencia real de armas y
  // armaduras. `weapon_proficiencies`/`armor_proficiencies` guardan tokens
  // del compendio ("simple-weapons", "dagger", "light-armor", "all-armor"...)
  // resueltos desde la clase (server/src/services/classProficiencies.js).
  //
  // Esa competencia nunca se guardó antes, pero SÍ se puede reconstruir: la
  // concede la clase, que la ficha ya tiene. Así que se deriva del compendio
  // para cada personaje en vez de borrar las fichas de la beta — una
  // migración jamás debe llevarse por delante datos de partidas jugadas.
  //
  // Una ficha sin clase, con una clase propia del DM o creada antes de
  // sincronizar el SRD se queda con la lista vacía: es exactamente lo que
  // significa (no consta competencia), y basta con reelegir la clase en la
  // ficha para que el servidor la vuelva a derivar.
  (db) => {
    db.exec(`
      ALTER TABLE characters ADD COLUMN weapon_proficiencies TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE characters ADD COLUMN armor_proficiencies TEXT NOT NULL DEFAULT '[]';
    `);
    const characters = db.prepare("SELECT id, class_index FROM characters WHERE kind = 'pj'").all();
    if (characters.length === 0) return;
    const classRow = db.prepare("SELECT data FROM srd_entries WHERE category = 'classes' AND idx = ?");
    const profRow = db.prepare("SELECT data FROM srd_entries WHERE category = 'proficiencies' AND idx = ?");
    const update = db.prepare('UPDATE characters SET weapon_proficiencies = ?, armor_proficiencies = ? WHERE id = ?');
    for (const character of characters) {
      const weapon = new Set();
      const armor = new Set();
      const index = character.class_index;
      if (typeof index === 'string' && index && !index.startsWith('custom:')) {
        const row = classRow.get(index);
        for (const ref of row ? JSON.parse(row.data || '{}').proficiencies ?? [] : []) {
          if (!ref?.index) continue;
          if (ref.index === 'all-armor') {
            armor.add('all-armor');
            continue;
          }
          const found = profRow.get(ref.index);
          if (!found) continue;
          const data = JSON.parse(found.data || '{}');
          const token = data.reference?.index;
          if (!token) continue;
          if (data.type === 'Weapons') weapon.add(token);
          else if (data.type === 'Armor') armor.add(token);
        }
      }
      update.run(JSON.stringify([...weapon]), JSON.stringify([...armor]), character.id);
    }
  },

  // v71 — Fase C de la rebanada vertical: progresión de clase por nivel, que
  // el SRD publica en /api/2014/classes/{index}/levels (dentro de la clase
  // llegaba solo como una URL sin expandir). 12 clases × 20 niveles.
  //
  // Vive en su propia tabla y NO en `srd_entries` a propósito: la lista de
  // categorías del compendio alimenta también el buscador transversal, el
  // índice FTS y las referencias del chat, así que 240 entradas tipo
  // «wizard-3» solo ensuciarían las búsquedas (riesgo 5 de
  // docs/VERTICAL-SLICE.md). Los rasgos narrativos siguen viniendo de la
  // categoría `features`, que ya trae `class` y `level`.
  //
  // `spell_slots` es el array de 9 posiciones (nivel 1 → 9) tal cual lo
  // publica el SRD; `class_specific` guarda sin tocar lo propio de cada clase
  // (usos de furia, dados de superioridad, ki…) para que la subida de nivel
  // pueda leerlo sin otra migración.
  `
  CREATE TABLE IF NOT EXISTS class_levels (
    class_index TEXT NOT NULL,
    level INTEGER NOT NULL,
    prof_bonus INTEGER NOT NULL,
    ability_score_bonuses INTEGER NOT NULL DEFAULT 0,
    cantrips_known INTEGER,
    spells_known INTEGER,
    spell_slots TEXT NOT NULL DEFAULT '[]',
    class_specific TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (class_index, level)
  );
  `,

  // v72 — Fase D de la rebanada vertical: el nivel de un PJ deja de ser un
  // campo libre. La campaña fija el nivel INICIAL con el que se crean los
  // personajes y el nivel CONCEDIDO al que puede subir el grupo; el modo por
  // defecto es milestone (el DM concede, no hay XP).
  //
  // `character_levelups` guarda el histórico: qué nivel se ganó, cuántos PG y
  // por qué camino (valor fijo o tirada del dado de golpe), y qué mejora de
  // característica se eligió. Es lo que permite explicar una ficha meses
  // después sin fiarse de la memoria de nadie.
  //
  // Migración de datos conservadora: el nivel concedido de una campaña ya en
  // marcha arranca en el nivel más alto que tenga su grupo, para que nadie
  // baje de nivel ni se quede sin poder subir al que ya tenía.
  (db) => {
    db.exec(`
      ALTER TABLE campaigns ADD COLUMN starting_level INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE campaigns ADD COLUMN granted_level INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE campaigns ADD COLUMN level_mode TEXT NOT NULL DEFAULT 'milestone';
      CREATE TABLE IF NOT EXISTS character_levelups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        from_level INTEGER NOT NULL,
        to_level INTEGER NOT NULL,
        hp_gained INTEGER NOT NULL,
        hp_method TEXT NOT NULL,
        hp_roll INTEGER,
        ability_increases TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_levelups_character ON character_levelups(character_id, to_level);
      UPDATE campaigns SET granted_level = MAX(1, IFNULL((
        SELECT MAX(level) FROM characters
         WHERE characters.campaign_id = campaigns.id AND characters.kind = 'pj'
      ), 1));
      UPDATE campaigns SET starting_level = granted_level;
    `);
  },

  // v73 — Fase F de la rebanada vertical: descansos y reloj de campaña.
  //
  // `hit_dice_spent` es el único dato nuevo del personaje: los dados de golpe
  // disponibles son su nivel menos los gastados, así que no hay que migrar
  // nada en fichas existentes (nadie ha gastado ninguno todavía).
  //
  // El reloj es una CAPACIDAD OPCIONAL y nace apagada (invariante 7 de
  // docs/ARQUITECTURA.md): ninguna regla puede depender de él. Extiende el
  // contador de jornadas que ya existía (`elapsed_days`, v52) con la hora del
  // día en minutos; encenderlo o apagarlo a mitad de campaña no cambia nada
  // más, el valor se conserva y deja de verse.
  `
  ALTER TABLE characters ADD COLUMN hit_dice_spent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN clock_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN day_minutes INTEGER NOT NULL DEFAULT 480;
  `,

  // v74 — Fase 4c del programa de gameplay: los dados en manos del jugador.
  //
  // `users.auto_rolls`: preferencia de cada jugador. Con ella activa, el
  // servidor no espera a que pulse «Tirar» en sus salvaciones, iniciativa ni
  // tiradas pedidas: las tira al instante como antes. Nace apagada.
  //
  // `combatants.help_from_id`: la acción Ayudar (SRD 5.1). Quien ayuda deja su
  // id en el combatiente ayudado; la ventaja se consume al usarla y vence al
  // empezar el siguiente turno de quien ayudó. Sin FK a propósito: el tracker
  // borra combatientes a menudo y una ayuda huérfana simplemente no aplica.
  `
  ALTER TABLE users ADD COLUMN auto_rolls INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE combatants ADD COLUMN help_from_id INTEGER;
  `,

  // v75 — Fase 4d del programa de gameplay: el DM como narrador.
  //
  // Nombre oculto hasta conocerlo: mientras `map_tokens.true_name` no es NULL,
  // el marcador se llama como lo ve la mesa («Criatura escamosa») y su nombre
  // real vive aquí, que solo se sirve al DM. Guardarlo al revés (el visible
  // aparte) obligaría a sustituirlo en cada narración del servidor; así, todo
  // lo que ya narra con `name` usa el visible sin tocarlo, y no hay fuga.
  //
  // Presentación de jefe: `boss_intro` (la activa el DM por marcador),
  // `boss_title` (subtítulo opcional) y `boss_intro_shown` (se presenta una
  // sola vez, la primera que la mesa lo ve).
  //
  // `chat_messages.style`: narración del DM y «¿cómo quieres hacerlo?» son
  // mensajes con otra presentación (subtítulo sobre el tablero), no otro tipo:
  // el CHECK de `type` no admite valores nuevos sin reconstruir la tabla.
  `
  ALTER TABLE map_tokens ADD COLUMN true_name TEXT;
  ALTER TABLE map_tokens ADD COLUMN boss_intro INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE map_tokens ADD COLUMN boss_title TEXT;
  ALTER TABLE map_tokens ADD COLUMN boss_intro_shown INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chat_messages ADD COLUMN style TEXT;
  `,

  // v76 — Añadidos del 23-sep-2026 a la Fase 4 (registro de juego).
  //
  // `roll_reactions`: una reacción por usuario y tirada, de un conjunto
  // cerrado de emojis. Se borra con el mensaje.
  //
  // `chat_messages.recipient_user_id`: susurros. Un susurro es un mensaje
  // oculto (hidden = 1) con destinatario: lo reciben el autor, el destinatario
  // y el DM, con el mismo filtrado en servidor que las tiradas ocultas.
  `
  CREATE TABLE roll_reactions (
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id)
  );
  ALTER TABLE chat_messages ADD COLUMN recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  `,
];

export function runMigrations() {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      const migration = migrations[v];
      if (typeof migration === 'function') migration(db);
      else db.exec(migration);
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`[db] migración aplicada: v${v + 1}`);
  }
}
