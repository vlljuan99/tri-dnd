# TriDnD

Mesa de juego virtual para D&D 5e pensada para un grupo de amigos: fichas de personaje siempre a mano (también en el móvil, en partidas presenciales), sesiones online con chat, tiradas compartidas, tracker de iniciativa y mapa táctico con niebla de guerra. La voz va aparte (Discord).

**Estado**: beta privada avanzada. Ya están operativos el taller y archivo del DM, fichas semiautomáticas, compendio en español, mapas de mundo y tácticos, niebla de guerra filtrada en servidor, combate por turnos, conjuros, eventos, botín, plantillas y escaramuzas preparadas. El cierre real sigue siendo el pulido y la prueba completa con el grupo; consulta [ROADMAP.md](ROADMAP.md) para el detalle.

**Documentación**: [ROADMAP.md](ROADMAP.md) (estado e historial), [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) (visión de producto, dominios y backlog arquitectónico) y [docs/VERTICAL-SLICE.md](docs/VERTICAL-SLICE.md) (el objetivo de desarrollo en curso). El motor de reglas usa **D&D 5e edición 2014 (SRD 5.1)**.

## Stack

- **Frontend**: React + Vite, Tailwind CSS, Zustand, Framer Motion, react-three-fiber (mapa táctico 3D)
- **Backend**: Node.js + Express + Socket.io
- **Base de datos**: SQLite (better-sqlite3)
- **Datos de D&D**: SRD 5e vía [dnd5eapi.co](https://www.dnd5eapi.co), sincronizado a la base de datos local con una capa de traducción al español

## Requisitos

- Node.js 20 o superior (probado con Node 24)

## Instalación

```bash
npm run install:all
```

Instala las dependencias de la raíz, del servidor y del cliente.

## Sincronizar el compendio SRD 5e (una vez, con conexión a internet)

```bash
npm run sync-srd
```

Descarga clases, razas, hechizos, monstruos, equipo, condiciones, etc. del SRD 5e y los guarda en SQLite aplicando las traducciones de `server/data/translations/es.json`. Es re-ejecutable: si se añaden traducciones o cambia la API, basta con volver a lanzarlo. La app **nunca** llama a la API externa en caliente; todo se sirve desde la base local.

## Ejecutar en local

```bash
npm run dev
```

Arranca a la vez:

- Servidor API + Socket.io en <http://localhost:4000>
- Cliente (Vite) en <http://localhost:5173> — esta es la URL para jugar

La base de datos se crea automáticamente en `server/data/tri-dnd.db` al arrancar el servidor.

## Verificación

```bash
npm test
npm run build --prefix client
npm audit --omit=dev --prefix server
npm audit --omit=dev --prefix client
```

Las pruebas del servidor incluyen una integración aislada que arranca la API
real contra una SQLite temporal. Nunca utiliza la base local del desarrollador.

## Producción

La beta está disponible en <https://tridnd.167-233-99-156.sslip.io>. El
despliegue se inicia manualmente desde el workflow `Deploy to Hetzner`, pero el
artefacto es reproducible y queda identificado por commit:

- dependencias instaladas con `npm ci`, pruebas, build y auditoría antes de publicar;
- imagen Docker inmutable `tridnd:<commit-sha>`;
- backup consistente de SQLite y medios antes del reinicio;
- `/api/health` expone versión, commit y migración activa;
- smoke test del frontend, SQLite y Socket.IO, con rollback de código si falla.

La operación y recuperación están documentadas en [deploy/README.md](deploy/README.md).

## Estructura del proyecto

```
tri-dnd/
├── docs/              # Visión y arquitectura, y el alcance de la rebanada vertical en curso
├── client/            # Frontend React (Vite + Tailwind)
│   └── src/
│       ├── pages/       # Pantallas generales (acceso, personajes, compendio…)
│       ├── features/    # Hub, taller, archivo, mundo, editor y tablero táctico
│       ├── components/  # Tirador de dados, tarjetas de tirada, selector SRD…
│       ├── lib/         # Reglas 5e (modificadores, ataques) y motor de dados
│       └── store/       # Estado global (Zustand): sesión, sala, dados
├── server/            # Backend Express + Socket.io
│   ├── src/
│   │   ├── index.js   # Punto de entrada (HTTP + Socket.io)
│   │   ├── db.js      # SQLite + migraciones
│   │   ├── auth.js    # Registro/login con cookie de sesión (JWT)
│   │   ├── sockets.js # Tiempo real: chat, tiradas, presencia, sesión en vivo
│   │   ├── routes/    # API: compendio, biblioteca, campañas, mapas y mundo
│   │   └── services/  # Reglas, visión, combate, plantillas y escaramuzas
│   ├── scripts/
│   │   └── sync-srd.js        # Sincronización manual del SRD 5e
│   └── data/
│       ├── translations/es.json  # Traducciones del SRD al español
│       └── tri-dnd.db            # Base de datos (generada, no en git)
└── README.md
```

## Traducciones del SRD

La interfaz es 100 % en español. Los datos del SRD llegan en inglés y se traducen mediante `server/data/translations/es.json` al sincronizar. Ya traducidos: clases, razas, características, habilidades, condiciones (con descripción), tipos de daño, escuelas de magia, propiedades de armas (con descripción), todas las armas y armaduras y el equipo de aventura más común. Pendiente (se irá completando por lotes): nombres y descripciones de hechizos y monstruos, resto de equipo. Las entradas sin traducir se muestran en inglés con un indicador.

El SRD 5.1 se publica bajo licencia CC-BY-4.0, que permite la traducción con atribución a Wizards of the Coast.
