# TriDnD — contexto para Codex

Mesa de juego virtual de D&D 5e para un grupo de ~4-6 amigos: fichas de personaje siempre a mano (también en el móvil, en partidas presenciales), sesiones online con chat, tiradas compartidas, tracker de iniciativa y mapa táctico con niebla de guerra. La voz va aparte (Discord); esta app no la gestiona.

**Alcance actual: solo local.** No hay que preocuparse por despliegue (VPS Hetzner + Caddy) hasta que el usuario lo pida explícitamente en una fase futura separada.

## Decisiones de producto ya confirmadas (no volver a preguntar)

- **Idioma: TODO en español**, incluida la interfaz y el contenido del SRD. Los datos de dnd5eapi.co llegan en inglés y se traducen mediante `server/data/translations/es.json` al ejecutar `npm run sync-srd`. Las entradas sin traducir se muestran en inglés con una etiqueta "EN" — es un estado esperado, no un bug, hasta que se traduzcan por lotes (fase 11, buscador de compendio).
- **Ficha semiautomática**: el jugador elige clase/raza/nivel del SRD y escribe las 6 características; la app calcula modificadores, competencia, salvaciones y habilidades automáticamente. Los rasgos de clase/subclase son texto libre (campo `features`), no se aplican automáticamente.
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
  pages/       # Pantallas: AuthPage, HubPage (campañas), CharactersPage, CharacterSheetPage, MesaPage
  components/  # DiceOverlay (FAB + tirador), RollCard, SrdPicker (buscador de compendio), ParchmentShell
  lib/         # dnd.js (reglas 5e: modificadores, competencia, ataques), dice.js (motor de tiradas)
  store/       # Zustand: auth.js (sesión), socket.js (sala/chat/tiradas), dice.js (overlay de dados)

server/src/
  index.js     # Punto de entrada HTTP + Socket.io
  db.js        # SQLite + migraciones (fuente de verdad del modelo de datos)
  auth.js      # Registro/login/me, middleware requireAuth
  sockets.js   # Chat, tiradas (con filtrado de ocultas), presencia, estado en vivo de la mesa
  routes/      # srd.js (compendio con filtros y meta por categoría), characters.js, campaigns.js

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

## Convenciones a mantener

- Todo el código, comentarios y mensajes de error orientados al usuario están **en español**.
- Nuevas tablas/columnas → nueva entrada en el array `migrations` de `server/src/db.js`, nunca modificar las existentes.
- Cualquier dato que un jugador no deba ver (trampas ocultas, HP exacto de enemigos fuera de su niebla, tiradas ocultas del DM) se filtra **en el servidor**, nunca solo en el cliente.
- Los nombres de rutas/páginas de usuario están en español (`/personajes`, `/campanas/:id`, `/acceso`), aunque el código interno (variables, funciones) esté en inglés como es habitual en JS.
