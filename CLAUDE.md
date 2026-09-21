# TriDnD — contexto para Claude

Mesa de juego virtual de D&D 5e para un grupo de ~4-6 amigos: fichas de personaje siempre a mano (también en el móvil, en partidas presenciales), sesiones online con chat, tiradas compartidas, tracker de iniciativa y mapa táctico con niebla de guerra. La voz va aparte (Discord); esta app no la gestiona.

**Desplegado en el VPS Hetzner compartido** (mismo host que tilestudio/teacherflow/friendlyflights, gestionado por Caddy en `/opt/tilestudio`) en `https://tridnd.167-233-99-156.sslip.io`, sin dominio propio todavía. El redeploy se lanza a mano desde GitHub Actions (`workflow_dispatch`, no en cada push): primero prueba y audita, después crea un backup, publica `tridnd:<commit-sha>` y valida versión/SQLite/Socket.IO con rollback de código si falla. Ver [deploy/README.md](deploy/README.md), "Despliegue" en [ROADMAP.md](ROADMAP.md) y `.github/workflows/deploy.yml`. El desarrollo del día a día sigue siendo local (`npm run dev`).

## Documentación

- [ROADMAP.md](ROADMAP.md) — estado, historial por fases y el objetivo de desarrollo actual
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — visión de producto, los cuatro dominios, invariantes de arquitectura y backlog (economía, servicios del mundo, interactivos, motor de tiradas, contenedores, misiones, disparadores…)
- [docs/VERTICAL-SLICE.md](docs/VERTICAL-SLICE.md) — la rebanada vertical 1 (cerrada): alcance, criterios de aceptación y la tabla de deuda técnica que sigue viva
- [docs/PROGRAMA-GAMEPLAY.md](docs/PROGRAMA-GAMEPLAY.md) — el programa en curso «Pulir el gameplay»: diez fases de implementación, una por sesión, con reglas globales y criterios de aceptación
- [docs/MINIATURA-3D.md](docs/MINIATURA-3D.md) — rebanada 2 «Mi miniatura 3D», diseñada; su G1 es la última fase del programa

## Decisiones de producto ya confirmadas (no volver a preguntar)

- **Reglas: D&D 5e edición 2014 (SRD 5.1)**, coherente con la API que sincronizamos (`/api/2014/...`). **No se mezclan reglas 2014 y 2024.** Cualquier regla que no venga del SRD es homebrew explícito: capacidad activable por campaña, apagada por defecto y anunciada en la mesa al dispararse.
- **El SRD define las reglas; el DM define el mundo.** Las reglas determinan cómo funcionan personajes, clases, competencia, armas, armaduras, conjuros, descansos y condiciones; el DM determina qué existe en su campaña, dónde, cuánto cuesta, qué recompensas aparecen y qué excepciones introduce.
- **El nivel de un PJ no es un campo libre**: lo fija la campaña como nivel inicial y lo concede el DM por milestone; el jugador completa la subida. Los personajes del DM (jefes, PNJ, enemigos) conservan el nivel editable. Decisión tomada, se implementa en la Fase D de la rebanada vertical.
- **Prioridad de desarrollo: cerrar la rebanada vertical antes de abrir superficie nueva.** Lo que no esté en su alcance no se implementa aunque quede a mano; se anota en el backlog de `docs/ARQUITECTURA.md`.
- **Idioma: español por defecto, inglés seleccionable por usuario** (decidido el 21-sep-2026; se implementa en las fases 7 y 8 del [programa de gameplay](docs/PROGRAMA-GAMEPLAY.md); hasta entonces la interfaz es solo en español). El código, los comentarios, los mensajes de error y la documentación siguen en español. Los datos de dnd5eapi.co llegan en inglés y se traducen mediante `server/data/translations/es.json` al ejecutar `npm run sync-srd`. Las entradas sin traducir se muestran en inglés con una etiqueta "EN" — es un estado esperado, no un bug, hasta que se traduzcan por lotes.
- **Ficha semiautomática**: el jugador elige clase y raza del SRD y escribe las 6 características; la app calcula modificadores, competencia, salvaciones y habilidades automáticamente. Los rasgos de clase/subclase **narrativos** son texto libre (campo `features`) y los narra la mesa; los efectos **estructurados** (bonos de característica, velocidad, competencias, resistencias, sentidos) sí se aplican solos y con desglose transparente (matizado en la Fase 26). Queda fuera un motor de efectos con disparadores.
- **Una mesa de juego persistente por campaña**: cada campaña tiene una fila en `game_tables` con `is_live` y `state`. El DM la abre/cierra por sesión; el mapa, tokens e iniciativa deben persistir entre sesiones (no son efímeros).
- **Tiradas ocultas del DM desde el principio**: en `chat_messages`, `hidden=1` significa que el backend (no el frontend) filtra el mensaje — ver `server/src/sockets.js`, solo lo reciben el autor y el DM de la campaña. Esto es el patrón a seguir para toda la seguridad de datos ocultos, incluida la niebla de guerra en fases futuras: si un dato no debe verse, no debe llegar al socket del jugador.
- **Desarrollo por fases, confirmando con el usuario entre fases.** Ver [ROADMAP.md](ROADMAP.md) para el estado y lo que queda.

## Stack

- **Frontend**: React + Vite + Tailwind CSS v4 + Zustand (estado de sala/dados) + Framer Motion. El mapa táctico es react-three-fiber/three.js y la escena de campamento son hotspots posicionados en % sobre una ilustración fija (el plan original preveía Konva y react-img-mapper; no se usan).
- **Backend**: Node.js (ESM) + Express + Socket.io + better-sqlite3 (SQLite, WAL). Migraciones incrementales controladas por `PRAGMA user_version` en `server/src/db.js` — añadir nuevas migraciones al final del array `migrations`, nunca editar una ya aplicada.
- **Auth**: usuario/contraseña simple (bcrypt), cookie httpOnly con JWT (`server/src/auth.js`). Sin OAuth.
- **Tiempo real**: Socket.io autenticado por la misma cookie de sesión (`server/src/sockets.js`). Los sockets se unen a una sala `campaign:<id>`.

## Estructura

```
client/src/
  pages/       # Pantallas: AuthPage, CharactersPage, CharacterSheetPage, CompendiumPage, BibliotecaPage
  features/hub/ # Zona de campañas (/campanas): sub-navegación y secciones (Campañas, Escaramuzas, Escenarios, Donde juego, Crear)
  components/  # DiceOverlay (FAB + tirador), RollCard, SrdPicker (buscador de compendio), ParchmentShell
  lib/         # dnd.js (reglas 5e: modificadores, competencia, ataques), dice.js (motor de tiradas)
  store/       # Zustand: auth.js (sesión), socket.js (sala/chat/tiradas), dice.js (overlay de dados)

server/src/
  index.js     # Punto de entrada HTTP + Socket.io
  db.js        # SQLite + migraciones (fuente de verdad del modelo de datos)
  auth.js      # Registro/login/me, middleware requireAuth
  sockets.js   # Chat, tiradas (con filtrado de ocultas), presencia, estado en vivo de la mesa
  routes/      # srd.js (compendio), characters.js, campaigns.js, maps.js (editor de mapas, solo DM)
  services/    # mapLibrary.js (consultas/serialización de mapas, filtrado por rol), generación de imágenes IA

server/scripts/sync-srd.js       # Sincronización manual del SRD 5e (re-ejecutable, con concurrencia)
server/data/translations/es.json # Traducciones al español aplicadas al sincronizar
```

## Comandos

```bash
npm run install:all   # instala raíz + server + client
npm run sync-srd       # descarga/traduce el SRD 5e a SQLite (requiere internet, no llama a la API en runtime)
npm run dev             # arranca server (puerto 4000) + client (puerto 5173) a la vez
```

La base de datos vive en `server/data/tri-dnd.db` (generada, ignorada por git). El secreto JWT se autogenera en `server/data/jwt-secret.txt` si no hay variable de entorno `JWT_SECRET` (también ignorado por git).

**Generación de imágenes con IA (opcional)**: la imagen de fondo del mapa táctico y los iconos de personaje se pueden generar con OpenAI o Google. Para que funcione localmente hace falta un archivo `server/.env` (ignorado por git, cada dev usa el suyo) con:

```
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

Sin este archivo la app funciona igual, pero el botón "Generar" del suelo de sala en el editor de mapas (`features/map-editor/components/RoomPanel.jsx`) y del icono de personaje (`CharacterAvatarPanel.jsx`) devuelve un error explicando que falta la clave; subir una imagen o foto propia no requiere ninguna clave.

## Convenciones a mantener

- Todo el código, comentarios y mensajes de error orientados al usuario están **en español**.
- Nuevas tablas/columnas → nueva entrada en el array `migrations` de `server/src/db.js`, nunca modificar las existentes.
- Cualquier dato que un jugador no deba ver (trampas ocultas, HP exacto de enemigos fuera de su niebla, tiradas ocultas del DM) se filtra **en el servidor**, nunca solo en el cliente.
- **Los campos derivados de las reglas los calcula el servidor**, no los escribe el cliente (CA, PG máximos, bonificador de competencia, competencias efectivas, nivel). Los espejos de reglas del cliente (`lib/dnd.js`, `features/*/domain/`) sirven para pintar y anticipar; el servidor revalida siempre.
- **Las capacidades opcionales por campaña nacen apagadas y ninguna regla puede depender de ellas** (reloj de campaña, homebrew, IA enemiga). Precedentes: `game_tables.enemy_ai_enabled`, `campaigns.solo_mode`.
- **La lógica de dominio no vive en el render**: nada de reglas dentro de componentes react-three-fiber (`features/tactical-map/domain/` es el patrón). Los servicios del mundo y los interactivos futuros no pueden depender del tablero 3D.
- **Un solo motor 3D: `three` + `@react-three/fiber`.** No se introduce Babylon.js ni ningún segundo motor 3D, ni siquiera para una funcionalidad aislada. Todo lo 3D nuevo (incluida la miniatura del personaje) se construye sobre el stack existente y reutiliza su escena, cámara, luces y patrón de disposal.
- **Lo visual nunca es fuente de verdad de gameplay** y **ninguna regla depende de que exista un asset**: la representación visual *lee* el equipamiento real, jamás lo duplica, y un objeto sin modelo se equipa y funciona igual (fallback exacto → categoría → genérico → ocultar). El tamaño de criatura (reglas) y la altura visual (cosmética) son campos distintos. Ver [docs/MINIATURA-3D.md](docs/MINIATURA-3D.md).
- Los nombres de rutas/páginas de usuario están en español (`/personajes`, `/campanas/:id`, `/acceso`), aunque el código interno (variables, funciones) esté en inglés como es habitual en JS.
