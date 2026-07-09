# Hoja de ruta de TriDnD

Desarrollo por fases, confirmando con el usuario entre fases (ver contexto completo en [CLAUDE.md](CLAUDE.md)). Alcance actual: **solo local**, sin despliegue.

## Completadas

- [x] **Fase 1** — Estructura base, autenticación, modelo de datos y sincronización del SRD 5e
- [x] **Fase 2** — Ficha de personaje (crear, editar, ver), mobile-first, con autoguardado
- [x] **Fase 3** — Cálculo de ataques (armas y hechizos) usando los datos sincronizados del SRD
- [x] **Fase 4** — Tirador de dados con overlay flotante y animaciones
- [x] **Fase 5** — Campañas + mesa de juego persistente + chat en tiempo real + tiradas compartidas (incluidas ocultas del DM)
- [x] **Fase 6** — Tracker de iniciativa + panel de enemigos del DM
- [x] **Asistente guiado de creación de personaje (primera iteración)** — pasos Identidad, Clase, Raza, Características, Competencias y Resumen; borrador/completo, autoguardado, recuperación, ayuda contextual, vista previa y tutorial posterior básico. Pendiente para siguientes iteraciones: paso de equipo inicial, paso de hechizos, paso de rasgos/recursos, compra por puntos avanzada y multiclase.
- [x] **Fase 7 (parcial)** — Tablero táctico con cámara cenital (`client/src/features/tactical-map/`, **react-three-fiber/three.js**, no Konva como decía el plan original — mapa renderizado en 3D visto desde arriba, no en canvas 2D)
  - Imagen de fondo del mapa: el DM puede subir una imagen propia o generarla con IA (OpenAI/Google), con el prompt refinado en el servidor a vista cenital estilo mapa de batalla (`server/src/services/mapImageGeneration.js`). Persiste por campaña en `game_tables`
  - Icono de personaje: cada jugador puede subir una foto o generarlo con IA, con un prompt refinado a un estilo visual común para toda la mesa (`server/src/services/avatarImageGeneration.js`). Persiste en `characters.avatar_path` y se ve en su token del tablero
  - Rejilla, selección y movimiento de tokens por clic ya funcionan; los tokens de enemigos/aliados siguen siendo datos de prueba en el cliente (no persistidos en el backend)

## Pendientes

- [x] **Fase 7.5 — Mesa del DM (editor de campaña) y mapas multi-sala**
  - [x] Modelo de datos (migración v8): `maps` (biblioteca por campaña) → `map_floors` (plantas) → `map_rooms` (salas NxM con forma, suelo, notas y revelado) + `map_doors` (puerta/escalera/portal, control jugador/dm, abierta/cerrada). El mapa único de `game_tables` migrado a un mapa de una sala; `active_map_id` marca cuál está en la mesa
  - [x] **Editor en página aparte** (`/campanas/:id/editor`, solo DM): biblioteca de mapas (crear/renombrar/activar/borrar), plantas en pestañas, lienzo 2D con plantillas de sala (habitación/salón/pasillo/N×M libre), arrastrar salas para combinarlas, puertas entre salas y entre plantas, panel de sala (revelado, notas del DM, suelo subido o generado con IA)
  - [x] **Vista filtrada por rol en servidor** (`GET /mapa-activo`): el DM lo ve todo; el jugador solo salas reveladas, sin notas, y sin puertas del DM cerradas (una puerta secreta cerrada no existe para él). El tablero 3D compone las salas visibles de la planta en un único board
  - [x] Borrado de mapas (incluido el activo) y de campañas enteras (solo DM, las fichas se conservan)
  - [x] **Revelado en tiempo real por socket**: el servidor emite `mapa:actualizado` (solo la señal, nunca datos) y cada tablero repide su vista filtrada; re-unión automática a la sala tras reconectar
  - [x] **Puertas en el tablero 3D**: marcadores clicables (dorado = jugador, rojo = DM); el jugador abre las suyas y descubre la sala del otro lado en vivo, el DM alterna cualquiera (`POST /puertas/:id/abrir`)
  - [x] **Suelo por sala en el tablero 3D**: cada sala pinta su imagen recortada a su forma, o piedra lisa
  - [x] **Marcadores por sala** (migración v9, `map_tokens`): enemigos (con `monster_index` SRD opcional), aliados, objetos y trampas; las trampas nacen ocultas (solo DM). Se colocan y arrastran en el editor y aparecen en el tablero filtrados por rol; el DM los mueve con persistencia
  - [x] **Enemigos del compendio SRD en el editor** (SrdPicker en el modo Marcador) y **entrada automática al tracker de iniciativa al revelarse la sala** (HP/CA del SRD, sin duplicados vía `combatants.map_token_id`, migración v11)
  - [x] **Tokens de personaje persistidos por sala** (migración v10, `map_character_tokens`): aparición automática en la primera sala revelada, movimiento del dueño o el DM validado en servidor (casillas activas, salas reveladas para el jugador), avatar del personaje. El tablero ya no tiene datos de prueba
  - Usuarios de prueba locales: `dm-demo` / `jugador-demo` (contraseña `demo1234`), campaña "La Cripta del Umbral (demo)"

- [x] **Fase 7 (resto)** — Herramientas de mesa sobre el tablero
  - Ping compartido (doble clic, socket efímero), regla de medir (casillas/pies, regla 5e), cruzar puertas pisando el umbral (abre, revela, teletransporta; entre plantas por escaleras/portales), selector de planta en el tablero, velocidad del personaje visible, dado flotante arrastrable, y el jugador nunca pierde de vista la sala donde está su personaje (el DM ve atenuado lo no revelado)
  - Pospuesto a la fase de pulido (14): pathing automático que rodea obstáculos y dibujo libre del DM

- [x] **Fase 8** — Obstáculos, trampas y niebla de guerra
  - **Obstáculos por sala** (migración v12): se pintan en el editor, bloquean el paso y se ven como bloques en el tablero 3D
  - **Niebla fina con línea de visión en servidor** (migración v13): visión por mapa 'sala' (clásica), 'compartida' (lo que ve el grupo) o 'individual' (cada cual lo suyo), con radio en casillas ajustable por el DM en el editor. Paredes y obstáculos bloquean la visión (Bresenham); las casillas fuera de visión viajan como desactivadas y marcadores/personajes/puertas fuera de visión no llegan al socket del jugador. La visión nunca añade salas: recorta sobre el revelado por salas
  - Las trampas y objetos ocultos solo-DM existen desde la Fase 7.5
  - **"Ojo jugador"** en el tablero del DM: alterna su vista completa con la vista filtrada del grupo (`?vista=jugador`) para comprobar qué están viendo
  - Mejora futura (fase 12/pulido): memoria de zonas ya exploradas en penumbra

- [x] **Combate en el tablero (primera iteración)** — con tu personaje seleccionado, pulsar un enemigo u otro PJ abre el panel de ataque con tus armas equipadas (y el golpe desarmado)
  - El cliente tira los dados (se comparten en el chat), pero el **impacto lo resuelve el servidor contra la CA**, que el jugador nunca recibe; valida propiedad del personaje, planta y adyacencia en cuerpo a cuerpo
  - El daño se aplica en servidor: enemigos por el tracker (al caer desaparecen del tablero y del tracker), personajes por su ficha (inconsciente a 0 HP); mensajes de sistema narran el combate
  - **Feedback completo**: el panel desglosa los d20 (con el descartado tachado en ventaja/desventaja) + bonificador = total contra la CA (revelada solo al resolver el ataque), y tras el daño muestra cuánta vida quita y cuánta queda. **Barras de vida** sobre los tokens del tablero 3D y HP actual/total en la lista de tokens, refrescadas por socket con cada golpe, cura o edición del tracker
  - Siguientes iteraciones: alcance real y línea de visión para armas a distancia, hechizos como ataque desde el tablero, ataques de monstruos con daño automático (hoy el DM usa su bloque de estadísticas y edita el tracker)

- [x] **Fase 8.5** — Movimiento y combate por turnos de verdad (migración v14, `server/src/services/turnEconomy.js`)
  - **Modo por turnos activo por defecto**, con un botón claro del DM en el tablero para alternarlo a "modo libre" en cualquier momento (sin borrar el tracker, a diferencia de terminar el combate del todo)
  - **Arranque e iniciativa automáticos**: en cuanto hay combatientes con el modo activo, el servidor tira 1d20+DES por cada uno y arranca el orden solo, sin que el DM tenga que teclear nada (se puede ajustar después a mano, como ya se podía)
  - **Fin automático**: al morir el último combatiente de tipo enemigo, se vuelve a movimiento libre solo, con aviso en el chat; el botón del DM sigue disponible para forzarlo antes
  - **Economía de turno** por combatiente: movimiento acumulado (casillas gastadas en el turno, repartibles antes/después de actuar), 1 acción, 1 acción adicional y 1 reacción (esta por ronda, no por turno, utilizable fuera de tu turno) — la reacción se marca a mano con un botón "usar reacción" cuando el DM narra que corresponde, no hay detección automática de disparadores (ataque de oportunidad, etc.)
  - El bloqueo de movimiento/acción aplica también a los **enemigos**: arrastrar su marcador descuenta su movimiento (velocidad del monstruo del compendio SRD) y se bloquea fuera de su turno o al agotarlo, igual que a un jugador — el DM sigue siendo quien lo arrastra, pero ya no puede moverlo más de la cuenta
  - **Terminar turno**: botón para quien tiene el turno (jugador o DM controlando un enemigo) y para el DM siempre, que fuerza el avance
  - **Área de movimiento visible**: al seleccionar el token del combatiente activo se resaltan en verde las casillas a las que aún llega con el movimiento que le queda, respetando obstáculos y paredes (misma regla Chebyshev que valida el servidor)
  - **Ciclo de encuentro automático**: al caer el último enemigo, vuelta a modo libre sola; al revelarse un enemigo nuevo en modo libre, turnos reactivados como encuentro fresco (iniciativas y recursos re-tirados). El banner del tablero muestra ronda, turno, movimiento restante y acción, con "Terminar turno" y el alternador del DM tanto en el tablero como en el tracker
  - Siguiente iteración: coste de movimiento por camino real (pathing, fase 14) en vez de distancia en línea, y ataques de oportunidad automáticos

- [x] **Fase 8.6** — Mesa de juego unificada: el tablero como pantalla principal
  - **Una sola pantalla** (`/campanas/:id`): el tablero táctico ocupa toda la vista, con paneles superpuestos para chat/registro, iniciativa, inventario y notas — nada de navegar entre "mesa" (chat) y "tablero" (mapa) como hasta ahora. `/campanas/:id/tablero` redirige a la nueva pantalla única, que conserva el nombre "Mesa de juego"
  - **"¡Tu turno!"** destacado en el banner de ronda cuando te toca a ti, frente a "Turno de X" para los demás — reutiliza la economía de turno de la Fase 8.5
  - **Orden de iniciativa** siempre accesible desde el tablero (ya lo veía cualquier jugador, pero solo en la pestaña de la página de chat, oculta en móvil)
  - **Ficha de personaje**: enlace directo desde el tablero al personaje seleccionado (el tuyo, o el de cualquiera si eres DM)
  - **Panel de inventario** aparte del de ataque: objetos usables solo en tu turno (gasta la acción, como atacar), con desglose de cantidad; el DM ve el inventario de cualquiera pero solo su dueño puede usarlo
  - **Notas privadas por personaje** (migración nueva): varias, con título y fecha de sesión — a diferencia de todo lo demás en la app, ni el DM las ve; solo su dueño
  - **HUD de estado permanente** (pulido, tras probarlo en real): retrato, HP, CA, movimiento restante y si ya usaste la acción en una barra compacta que abraza su contenido (no estirada a todo el ancho), apilada en flujo normal con los controles del mapa para que nunca se solapen, en desktop y en móvil
  - El HUD muestra al **combatiente activo** (para el DM: el enemigo o PJ a quien le toca el turno, no siempre su propio personaje si tiene uno) — Ficha/Inventario se ofrecen para cualquiera mostrado (solo lectura si no es tuyo), Notas solo viendo tu propio personaje
  - "Modo DM" en la cabecera junto a "EN VIVO" (visible solo al DM); "Ojo jugador" pasa a ser un switch con las dos vistas nombradas ("Vista DM" / "Vista jugador"); botón "Volver" eliminado (redundante con "← Hub")

- [x] **Fase 8.7** — Visión por personaje y objetos interactivos con coste de acción
  - **Visión en la oscuridad por personaje** (migración v16, `characters.darkvision`, casillas): campo manual en la ficha junto a CA/Velocidad, igual de espíritu que los rasgos de clase en texto libre — no se deduce de la raza automáticamente. `server/src/services/vision.js` calcula el radio por token en vez de uno único por mapa (`max(vision_radius del mapa, darkvision del personaje)`); el modo `'compartida'` sigue siendo la unión, ahora de radios distintos
  - **Puertas y trampas cuestan una acción** (migración v17, `map_doors.dc`/`skill` y `map_tokens.dc`/`skill` opcionales, asignables desde el editor): abrir una puerta o interactuar con un marcador de trampa/objeto pasa por un popup de confirmación (`InteractPanel`) que valida adyacencia y turno en servidor, gasta la acción vía `turnEconomy.js` (antes solo conectado a ataques, movimiento e inventario) tanto si aciertas como si fallas, y si el DM asignó una habilidad pide la tirada antes de resolver — la dificultad viaja oculta al jugador hasta entonces, igual que la CA en combate. El DM sigue abriendo cualquier puerta gratis y sin popup, como antes
- [x] **Fase 8.8** — Creación de campaña guiada: plazas, lore/objetivos y punto de aparición
  - Formulario de creación de campaña ampliado (migración v18, `campaigns.max_players`, `lore`, `objectives`): el DM define cuántas plazas hay, el lore de apertura y la lista de objetivos (uno por línea) al crear la campaña. `POST /campaigns/join` rechaza una vez llenas las plazas
  - **Punto de aparición marcado por el DM** (`map_rooms.spawn_cells`, mismo patrón que `obstacle_cells`): nuevo pincel "Aparición" en el editor de salas; `ensureCharacterTokens` lo usa como primer intento y cae al comportamiento anterior (primera casilla libre de la sala revelada) si no hay ninguno marcado
  - **Pantalla de espera del jugador** (`CampaignLobby`): mientras el DM no ha abierto la sesión, el jugador ve el lore/objetivos y cuántos se han unido en vez del tablero; el DM entra directo al tablero como siempre, para poder prepararlo antes. El botón de abrir sesión se bloquea en servidor y en cliente si no hay al menos 1 jugador unido
  - **Jefes/bosses como personaje** (migración v20, `characters.kind` 'pj'/'boss', `map_tokens.character_id`): en vez de un sistema de plantillas aparte, el DM crea un jefe desde la sección de Personajes ("+ Crear jefe"), que nace ya completo (sin pasar por el asistente guiado de PJ) y reutiliza toda la ficha — stats, avatar subido o generado por IA, notas. Al colocar un marcador `enemigo` en el editor de mapas, el DM elige entre el compendio SRD o uno de sus jefes; `spawnRoomEnemies` toma HP/CA de la ficha del jefe (prioridad sobre el SRD) y el tablero pinta su avatar en vez del marcador genérico
- [x] **Fase 8.9** — Mapa de campaña (mapa de mundo): una capa por encima del tablero
  - **Modelo de datos** (migración v19): `campaigns.has_world_map`/`world_map_url` (el lore reutiliza `campaigns.lore` de la v18), tabla `world_locations` (nombre, `x`/`y` en % sobre la imagen, `lore`, `map_id` REFERENCES maps ON DELETE SET NULL) y `game_tables.current_location_id` (ubicación actual del grupo, se limpia a mano al borrar la ubicación, como `active_map_id`)
  - **Creación de campaña**: nuevo check "Forma parte de un mapa de mundo" en el Hub; `PATCH /campaigns/:id` para editar lore/objetivos/plazas/mundo después
  - **Editor del mundo en página propia** (`/campanas/:id/mundo`, solo DM, `features/world-map/`): sube o genera con IA una imagen de región (`generateWorldMapImage`, prompt de cartografía de fantasía, no cenital de batalla), coloca ubicaciones clicando la imagen, las arrastra para recolocarlas, y por ubicación edita nombre, lore y el tablero enlazado de la biblioteca de mapas
  - **Router `world.js`** con guardas por ruta: el GET lo consulta cualquier miembro (todas las ubicaciones visibles en esta fase, sin ocultas); imagen/ubicaciones/`POST /viajar` son solo del DM. Viajar fija la ubicación actual y activa el mapa enlazado reutilizando la lógica de `activar`, y emite `mapa:actualizado` + `mundo:actualizado`
  - **Flujo en la mesa** (`CampaignGamePage`, máquina de pantallas): lore de campaña → mapa de mundo (solo el DM viaja; el jugador consulta) → lore de la ubicación con las especificaciones del tablero → tablero. Si ya hay ubicación activa se salta directo al tablero, con un botón "Mapa de mundo" en la cabecera para volver. Si la campaña no forma parte de un mapa, todo funciona como antes
- [ ] **Fase 9** — Hub de campañas + Campamento (escenas de menú fijo con hotspots y focus) *(pospuesta: se retoma más adelante, se adelanta la Fase 10)*
  - Sustituye las listas actuales de `HubPage` por la escena ilustrada estilo "menú de misión" (Suikoden/Kingdom Hearts)
  - react-img-mapper + Framer Motion para el halo/zoom al hover y transición de entrada a escena
  - Diseño del Campamento: mapa de región con hoguera central, tiendas (ficha propia/compañeros), camino a la mesa, diario de campaña, cofre/inventario

- [ ] **Fase 10 (en curso)** — Vista rápida "modo presencial"
  - HP, CA, ataques con tirada directa, inventario y hechizos desde el móvil sin sala online activa

- [ ] **Fase 11** — Buscador de compendio + comandos de chat (`/r 1d20+4`)
  - Buscador rápido con filtros sobre hechizos, monstruos, equipo y condiciones ya sincronizados
  - Aprovechar para completar la traducción al español de hechizos y monstruos (pendiente desde la fase 1)
  - Comandos de tirada directamente en el chat de la mesa

- [ ] **Fase 12** — Fuentes de luz dinámicas en el mapa (opcional, si el tiempo lo permite)
  - Dos niveles: revelado-pero-en-penumbra vs. iluminado, combinado con la niebla de guerra

- [ ] **Fase 13** — Aplicar la dirección de diseño y atmósfera de forma consistente en toda la app
  - Auditoría visual completa: paleta nocturna de mesa vs. paleta cálida de campamento, tipografías (Cinzel/Alegreya/JetBrains Mono), evitar clichés genéricos de IA

- [ ] **Fase 14** — Pulido y pruebas en local
  - Sesión de prueba completa con el grupo real, recoger fricciones antes de plantear el despliegue

## Fuera de alcance por ahora

- **Despliegue en VPS Hetzner + Caddy** — se abordará en una fase separada, solo cuando el usuario lo pida explícitamente.
