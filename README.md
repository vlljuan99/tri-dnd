# TriDnD

Mesa de juego virtual para D&D 5e pensada para un grupo de amigos: fichas de personaje siempre a mano (también en el móvil, en partidas presenciales), sesiones online con chat, tiradas compartidas, tracker de iniciativa y mapa táctico con niebla de guerra. La voz va aparte (Discord).

**Estado**: en desarrollo por fases. Completadas las fases **1-5**: base + autenticación + SRD 5e en español, ficha de personaje mobile-first con autoguardado, cálculo de ataques, tirador de dados flotante y salas de campaña con chat y tiradas compartidas en tiempo real (incluidas tiradas ocultas del DM). Siguiente: fase 6 (tracker de iniciativa + panel de enemigos del DM).

## Stack

- **Frontend**: React + Vite, Tailwind CSS, Zustand, Framer Motion (más adelante: Konva para el mapa táctico, react-img-mapper para las escenas de campamento/hub)
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

## Estructura del proyecto

```
tri-dnd/
├── client/            # Frontend React (Vite + Tailwind)
│   └── src/
│       ├── pages/       # Pantallas (acceso, hub, personajes, ficha, mesa)
│       ├── components/  # Tirador de dados, tarjetas de tirada, selector SRD…
│       ├── lib/         # Reglas 5e (modificadores, ataques) y motor de dados
│       └── store/       # Estado global (Zustand): sesión, sala, dados
├── server/            # Backend Express + Socket.io
│   ├── src/
│   │   ├── index.js   # Punto de entrada (HTTP + Socket.io)
│   │   ├── db.js      # SQLite + migraciones
│   │   ├── auth.js    # Registro/login con cookie de sesión (JWT)
│   │   ├── sockets.js # Tiempo real: chat, tiradas, presencia, sesión en vivo
│   │   └── routes/    # API: compendio SRD, personajes, campañas
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
