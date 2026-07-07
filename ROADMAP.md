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

- [ ] **Fase 7.5 — Mesa del DM (editor de campaña) y mapas multi-sala** *(en curso; prioritaria: el resto de la Fase 7 se apoya en su modelo de datos)*
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

- [ ] **Fase 7 (resto)** — Herramientas de mesa sobre el tablero
  - [x] **Ping compartido** (doble clic): pulso efímero por socket que ve toda la mesa, sin tocar la base de datos
  - [x] **Medir distancia** (modo "Medir"): dos clics, distancia en casillas y pies con la regla simplificada de 5e
  - [x] **Cruzar puertas con el token**: pisar el umbral abre la puerta (si puede abrirse), revela el otro lado —enemigos al tracker— y teletransporta al otro extremo, también entre plantas por escaleras/portales; las puertas del DM cerradas no ceden
  - [ ] Selector de planta en el tablero en vivo (hoy muestra la primera planta con salas visibles; al bajar al sótano el jugador sigue viendo la planta 1)
  - [ ] Pathing automático que rodea obstáculos + dibujo libre del DM

- [ ] **Fase 8** — Obstáculos, trampas y niebla de guerra (refinamiento del revelado por salas de la Fase 7.5)
  - Filtrado de datos **en el backend** según rol y área revelada (ver patrón ya usado con tiradas ocultas en `sockets.js`)
  - Visión compartida (unión de lo visible por el grupo) vs. individual, configurable por escena
  - Línea de visión bloqueada por obstáculos; el DM ajusta el radio de visión dentro de las salas ya reveladas

- [ ] **Fase 9** — Hub de campañas + Campamento (escenas de menú fijo con hotspots y focus)
  - Sustituye las listas actuales de `HubPage` por la escena ilustrada estilo "menú de misión" (Suikoden/Kingdom Hearts)
  - react-img-mapper + Framer Motion para el halo/zoom al hover y transición de entrada a escena
  - Diseño del Campamento: mapa de región con hoguera central, tiendas (ficha propia/compañeros), camino a la mesa, diario de campaña, cofre/inventario

- [ ] **Fase 10** — Vista rápida "modo presencial"
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
