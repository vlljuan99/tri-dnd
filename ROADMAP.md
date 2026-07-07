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
