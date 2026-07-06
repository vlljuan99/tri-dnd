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

## Pendientes

- [ ] **Fase 7** — Mapa táctico: rejilla + subida de imagen + tokens + pathing automático + medir + ping + dibujo libre
  - Konva.js + react-konva. Rejilla cuadrada calculada sobre la imagen subida por el DM
  - Tokens con color por clase, avatar/iniciales, movimiento con pathing que rodea obstáculos, animado y sincronizado
  - Herramientas del DM: obstáculos, trampas (invisibles para jugadores), medir distancia, ping, dibujo libre

- [ ] **Fase 8** — Obstáculos, trampas y niebla de guerra
  - Filtrado de datos **en el backend** según rol y área revelada (ver patrón ya usado con tiradas ocultas en `sockets.js`)
  - Visión compartida (unión de lo visible por el grupo) vs. individual, configurable por escena
  - Línea de visión bloqueada por obstáculos; el DM ajusta el radio de visión

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
