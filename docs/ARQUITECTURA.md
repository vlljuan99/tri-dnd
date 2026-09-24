# TriDnD — visión de producto y arquitectura

Este documento recoge **hacia dónde va TriDnD** y las decisiones estructurales que no
deben romperse por el camino. No es un plan de trabajo: nada de lo que hay aquí está
planificado ni autorizado a implementarse por el simple hecho de estar escrito.

- Lo **planificado** vive en [VERTICAL-SLICE.md](VERTICAL-SLICE.md) (el objetivo actual)
  y en [../ROADMAP.md](../ROADMAP.md) (estado e historial por fases).
- Las **reglas permanentes de desarrollo** viven en [../CLAUDE.md](../CLAUDE.md) y su
  gemelo [../AGENTS.md](../AGENTS.md).

La regla de oro sigue siendo la de siempre: **desarrollo por fases, confirmando con el
usuario entre fases**, y preferir terminar una rebanada jugable de extremo a extremo
antes que dejar veinte sistemas a medias.

---

## 1. Base de reglas: D&D 5e edición 2014

El motor de reglas usa **D&D 5e 2014 (SRD 5.1)** como referencia normativa, coherente
con la API que ya sincronizamos (`https://www.dnd5eapi.co/api/2014/...`, ver
`server/scripts/sync-srd.js` y `server/src/services/srdShape.js`).

- **No se mezclan reglas 2014 y 2024.** Si una regla existe en las dos ediciones con
  distinta forma (competencia con armas, trasfondos, dotes, preparación de conjuros,
  descansos), manda la de 2014.
- Cualquier regla que **no** venga del SRD es **homebrew explícito**: capacidad
  activable por campaña, apagada por defecto, y dicho en la mesa cuando se dispare. El
  precedente ya acordado es la Fase 27 (efectos elementales por tipo de daño).

### Principio de reparto: el SRD define las reglas, el DM define el mundo

| El SRD manda en… | El DM manda en… |
| --- | --- |
| Personajes, clases, niveles y progresión | Qué existe en su campaña y dónde |
| Competencia con armas y armaduras | Qué hay disponible y a qué precio |
| Cálculo de ataques, CA y salvaciones | Qué recompensas aparecen y cuándo |
| Conjuros: aprender, preparar, lanzar | Quién enseña, quién vende, quién cobra |
| Descansos, condiciones y recursos | Excepciones y contenido propio |

El DM puede **sobrescribir** casi cualquier dato del mundo (precio, disponibilidad,
stock, botín, estadísticas de una instancia concreta — ya lo hace con los overrides de
la Fase 17), pero no reescribe las reglas: para eso está el contenido propio de la
biblioteca (Fases 15 y 26), que se expresa **con la misma forma de datos que el SRD**.

---

## 2. Los cuatro dominios

El producto se piensa como cuatro dominios y una capa transversal. Hoy el código no está
separado así: esta es la dirección a la que deben tender los movimientos nuevos, no una
refactorización pendiente que haya que hacer de golpe.

### Rules Engine — *cómo funcionan las cosas*
Personajes, clases, niveles, reglas de equipo, combate, conjuros, condiciones,
descansos, competencia, progresión.

> **Hoy**: repartido entre `client/src/lib/dnd.js` (modificadores, competencia, ataques)
> y varios servicios del servidor (`combatRules.js`, `damageResolution.js`,
> `concentration.js`, `opportunityAttacks.js`, `perception.js`, `turnEconomy.js`).
> `abilityModifier` y `proficiencyBonus` están **duplicados en cinco archivos**.
> **Dirección**: un núcleo de reglas en el servidor como única autoridad, con el cliente
> como espejo de *presentación y predicción*, nunca de decisión.

### World Engine — *qué existe y dónde*
Ubicaciones, NPCs, servicios y establecimientos, economía, misiones, tiempo, botín,
estado del mundo.

> **Hoy**: `routes/world.js`, tablas `world_maps` / `world_locations` / `world_routes`,
> `campaignArchive.js`, `events.js`, `loot.js`. **Falta** todo lo económico, los
> servicios y una entidad NPC propia.

### Game / VTT Engine — *cómo se juega en la mesa*
Mapas, movimiento, iniciativa, combate táctico, visión, niebla, interacciones,
encuentros.

> **Hoy**: `client/src/features/tactical-map/` y `features/map-editor/`,
> `routes/maps.js`, `services/mapLibrary.js`, `vision.js`, `pathfinding.js`, `walls.js`,
> `turnEconomy.js`, `hazardZones.js`. Es la parte más madura del proyecto.

### Realtime / Session Layer — *quién ve qué y cuándo*
Jugadores, DM, sockets, sincronización, estado autoritativo, permisos.

> **Hoy**: `server/src/sockets.js`, `services/liveMap.js`, tabla `game_tables`, salas
> `campaign:<id>`.

### DM Tools (capa transversal)
El DM crea, modifica, oculta, concede y sobrescribe elementos de cualquiera de los
cuatro dominios: biblioteca propia, plantillas, editor de mapas y de mundo, archivo de
campaña, gestión y overrides por instancia.

---

## 3. Invariantes de arquitectura

Reglas que ningún desarrollo futuro debe romper. Las tres primeras ya son norma; las
demás son la extensión natural de esa misma norma a lo que viene.

1. **El servidor es la autoridad** de todo lo que afecte a reglas o a información
   oculta. Si un dato no debe verse, no debe llegar al socket del jugador.
2. **Migraciones append-only** (`PRAGMA user_version`, `server/src/db.js`): nueva entrada
   al final del array, nunca editar una ya aplicada.
3. **Contenido propio con forma SRD**: cuando el SRD contempla un dato, se usa su forma,
   no un formato paralelo.
4. **El cliente predice, no decide.** Los espejos cliente de reglas (`domain/*.js`,
   `lib/dnd.js`) existen para pintar y anticipar; el servidor revalida siempre.
5. **Los campos derivados no los escribe el cliente.** CA, PG máximos, bonificador de
   competencia, competencias efectivas y nivel son *resultado* de las reglas. A partir de
   ahora todo campo derivado nuevo se calcula en servidor; los que hoy son editables
   migran con la fase que los toca (ver deuda técnica en la rebanada vertical).
6. **La lógica de dominio no vive en el render.** `features/tactical-map/domain/` ya es
   el patrón: nada de reglas dentro de componentes react-three-fiber. Los servicios del
   mundo y los interactivos futuros no pueden depender del tablero 3D.
7. **Las capacidades opcionales por campaña nacen apagadas y nadie depende de ellas.**
   Ninguna regla del Rules Engine puede *requerir* una capacidad opcional (precedentes:
   `game_tables.enemy_ai_enabled`, `campaigns.solo_mode`).
8. **Los objetos se transfieren, no se copian.** En cuanto existan contenedores, mover un
   objeto es una operación transaccional del servidor, nunca un envío del inventario
   completo desde el cliente.

---

## 4. Backlog arquitectónico

Dirección acordada para **después** de la rebanada vertical. Cada bloque dice qué
queremos, qué hay hoy y qué **no** se hace todavía.

### 4.1 Economía
Monedas de D&D (po/pe/pp/pc), saldo por personaje, compra, venta, transferencias entre
personajes y recompensas. Precios base del SRD (`equipment.cost`, ya sincronizado),
**sobrescribibles por el DM**, con stock limitado o ilimitado por establecimiento.

- **Hoy**: no existe dinero en el modelo. El botín (`services/loot.js`) inserta objetos
  directamente en el JSON del inventario.
- **Decisión**: nada de disponibilidad por `requiredLevel`. Lo que se puede conseguir lo
  decide el DM, no el nivel del personaje.

### 4.2 Servicios del mundo (World Services)
Una sola abstracción reutilizable en lugar de un sistema por tipo de tienda:
`merchant`, `blacksmith`, `inn`, `temple`, `healer`, `stable`, `arcane library`,
`alchemist`, `trainer`, `transport`, `bank`, `custom`.

Un servicio puede colgar de una ubicación del mundo, de un NPC o de un objeto del mapa:

```
Objeto del mapa ─▶ interacción ─▶ referencia de servicio ─▶ World Service
```

- **Decisión**: la lógica del establecimiento **no** puede depender del tablero táctico
  ni de three.js. Un servicio debe poder abrirse desde el mapa de mundo, desde el
  campamento o desde un marcador sin cambiar nada.

### 4.3 Conjuros y lugares de aprendizaje
**No** habrá un sistema genérico «academia → comprar conjuro → aprenderlo»: en 5e cada
clase adquiere conjuros de forma distinta. El **Rules Engine** decide si un personaje
puede aprender, copiar, preparar, conocer o lanzar un conjuro concreto.

Un establecimiento mágico solo aporta **recursos**: pergaminos, acceso a un conjuro para
transcribir, libros de conjuros, componentes, identificación, investigación y servicios
mágicos.

Ejemplo (mago, reglas 2014): el conjuro pertenece a la lista de mago → su nivel es
accesible → hay libro de conjuros → hay coste en oro y tiempo → se copia al libro.

### 4.4 Interactivos genéricos (Interactables)
Un modelo reusable con tipo, posición, estado, visibilidad, permisos, requisitos,
acciones disponibles y referencias a otras entidades. Debe poder representar puerta,
cofre, mercader, NPC, palanca, trampa, portal, altar, tablón de anuncios, cama y tipos
propios.

- **Hoy**: cada interactivo es su propia tabla o su propio campo — `map_doors` (con `dc`
  y `skill`), `map_tokens` con `loot`/`dc`/`skill`, y el cliente los distingue a mano en
  `InteractPanel`.
- **Decisión**: no se implementa ahora, pero **nada nuevo debe cerrar la puerta** a
  unificarlos. Toda interacción nueva pasa por el mismo camino: acción propuesta por el
  cliente → validación de adyacencia, turno y permisos en servidor → consecuencia.

### 4.5 Roll Engine universal
Converger hacia una sola forma de **pedir** y **resolver** tiradas: `RollRequest` con
actor, característica, habilidad, competencia, ventaja/desventaja, modificadores, CD,
visibilidad, solicitante y resultado. Debe cubrir prueba de característica, prueba de
habilidad, salvación, ataque, daño, salvación de muerte y tirada libre.

Y debe servir igual en combate, exploración, trampas, interacciones, puertas, diálogos,
conjuros y peticiones directas del DM («todos, Percepción»), con resultado público,
privado o solo-DM.

- **Hoy**: hay tres caminos distintos — `client/src/lib/dice.js` (el cliente tira y
  publica), `server/src/services/serverDice.js` (el servidor tira y narra) y las
  validaciones sueltas de cada acción. La privacidad ya está resuelta en origen
  (`chat_messages.hidden`), que es la parte difícil.
- **Decisión**: el servidor sigue siendo autoridad de todo resultado con consecuencia
  mecánica. Una petición de tirada del DM es un mensaje dirigido, no un permiso para que
  el cliente decida.

### 4.6 Contenedores e inventarios
Modelo real de contenedores: inventario de personaje, cofre, cadáver, inventario de
mercader, contenedor compartido y botín en el suelo. Los objetos **se mueven** entre
contenedores sin duplicarse:

```
Contenedor del mundo ─▶ inventario del personaje ─▶ slot de equipo
```

Habilita cofres, saqueo, botín compartido, comercio, soltar y entregar objetos.

### 4.7 Objetos mágicos
Rareza, sintonización (con su límite y su relación con los descansos), cargas, usos
limitados, identificación y **estado desconocido**: el jugador ve «espada ornamentada» y
el DM sabe que es una *Lengua de Fuego* hasta que se identifica.

### 4.8 Descansos, recursos y condiciones
Núcleo del Rules Engine: descanso corto y largo, dados de golpe, recuperación de recursos
y espacios de conjuro, condiciones, concentración, salvaciones de muerte, acción /
acción adicional / reacción, movimiento y recursos por turno.

- **Hoy**: la economía de turno está resuelta (`turnEconomy.js`), y las condiciones y la
  concentración también. **No existen los descansos ni los dados de golpe**, y los
  espacios de conjuro (`characters.spells.slots`) están en el modelo pero **nadie los
  consume**.

### 4.9 Reloj de campaña (capacidad opcional)
El DM elige **al crear la campaña** si quiere reloj, y puede cambiarlo después sin romper
la partida en curso.

- **Apagado**: no hay avance temporal obligatorio, no aparecen controles de reloj, y toda
  regla que pueda resolverse sin él sigue funcionando igual (mesa tradicional/manual).
- **Encendido**: la campaña mantiene día y hora (y calendario si se amplía), y el DM
  controla el avance: «Viajar a Phandalin → +7 h», «Descanso largo → +8 h».

Sirve más adelante para duración de antorchas y conjuros, viajes, descansos, eventos,
horarios de establecimientos y downtime.

- **Hoy**: existe un contador narrativo de **jornadas** (`campaigns.elapsed_days`,
  migración v52) que avanza con el coste de las rutas del mapa de mundo. El reloj opcional
  **extiende ese contador**; no se crea un segundo reloj.
- **Invariante**: ninguna regla puede depender del reloj. Las duraciones mecánicas se
  cuentan en rondas (como ya hacen `condition_timers` y las zonas de peligro) o en
  descansos, nunca en horas.

### 4.10 Iluminación, visión y niebla
Evolucionar la visibilidad hacia `posición + visión + iluminación + visión en la
oscuridad + condiciones`, con el servidor como autoridad. Concepto `LightSource` con
radio brillante, radio tenue, duración, mágica o no, y estado activo.

- **Hoy**: la niebla y la línea de visión ya se filtran en servidor (`vision.js`); las
  luces del mapa (v33) son **decorado** y no afectan a lo que se ve.
- **Decisión**: no tocarlo mientras interfiera con la rebanada vertical.

### 4.11 NPCs y actores del mundo
No todo NPC necesita ficha de personaje completa. Una entidad de actor del mundo tendría
identidad, facción, actitud, diálogo, servicios, inventario, información pública, notas
solo-DM, secretos y **opcionalmente** un bloque de combate.

- **Hoy**: un NPC es un personaje del DM (`characters.kind='boss'` con
  `dm_category='pnj'`, Fase 16) enlazado a un marcador aliado. Un tabernero arrastra hoy
  una ficha de combate entera.

### 4.12 Misiones y diario
Misiones con estado (activa, completada, fallada, oculta, opcional), objetivos solo-DM y
recompensas. Y un **diario de campaña** construido con eventos que el servidor **ya
conoce**: llegada a una ubicación, misión aceptada, compra, inicio y fin de combate,
botín, subida de nivel, descanso. Más adelante puede alimentar un resumen de sesión
editable por el DM.

- **Decisión**: la IA no es dependencia del sistema. El diario debe funcionar entero sin
  ella.

### 4.13 Encuentros
Encuentros configurables: participantes, puntos de aparición, disparador manual o
automático, iniciativa y estado del encuentro.

- **Hoy**: los enemigos aparecen al revelarse la sala (`spawnRoomEnemies`) y el combate
  arranca solo; las escaramuzas de fábrica ya son, de facto, encuentros predefinidos en
  código (`services/skirmishPresets.js`).
- La primera versión **no** necesita disparadores automáticos.

### 4.14 Motor de disparadores (dirección lejana)
`Disparador → condiciones → acciones`. «Cuando un jugador entre en el área X, si la misión
Y está activa: cerrar la puerta, invocar esqueletos, revelar el área e iniciar el
encuentro». «Cuando muera Gundren: fallar la misión A y activar la B».

Acabaría tocando mapas, interactivos, NPCs, misiones, mercaderes, combate, diálogo,
botín, descanso y tiempo de campaña.

- **Hoy**: `dm_events` + `event_links` ya son una versión acotada — tres disparadores
  (manual, cada N rondas, al revelarse) con consecuencia narrativa en el chat.
- **Decisión explícita**: **no** se construye un motor de scripting ahora. Queda
  documentado solo para no tomar decisiones que lo hagan imposible: los disparadores
  nuevos se añaden al modelo de eventos existente en vez de inventar otro sistema
  paralelo.

### 4.15 Miniatura 3D del personaje (CharacterVisual)
Cada PJ tendrá una **miniatura 3D personalizable sobre peana**, creada dentro de la app y
reutilizada como **la misma representación** en ficha, asistente y mapa táctico. Diseño
completo y rebanada en **[MINIATURA-3D.md](MINIATURA-3D.md)** (rebanada vertical 2).

- **Motor**: **three.js + react-three-fiber** (el stack 3D real; **no** Babylon, que no
  existe en el proyecto). Reutiliza la escena, la cámara, la peana y los estados de token que
  ya dibuja `features/tactical-map/`.
- **Capa nueva `CharacterVisual`**: `(Appearance, Equipment) → representación`. La apariencia
  es elección estética del jugador; el equipamiento visual **lee** el inventario con slots
  (Fase A), nunca lo duplica.
- **Invariantes que añade** (VIS-1…VIS-7, extienden §3): el estado visual no es fuente de
  verdad de gameplay; **ninguna regla depende de que exista un asset** (fallback
  exacto→categoría→genérico→ocultar); la resolución visual es dominio puro fuera del render;
  los estados de gameplay son overlays de three.js, nunca van dentro del GLB; **`Creature
  Size` (reglas) ≠ `Visual Height` (cosmético)**; **60 FPS manda sobre la fidelidad visual**;
  y el gameplay **no conoce rutas de GLB** (todo pasa por el `VisualAssetRegistry`).
- **Estilo y alcance**: low-poly fantasy estilizado, legibilidad a distancia, **sin caras
  detalladas ni editor facial**. Las **9 especies** del asistente se distinguen por silueta y
  proporción, no por textura. Personalización modular por presets (altura, complexión, piel,
  pelo, barba, rasgos de especie, ropa base, peana, pose), sin sliders continuos.
- **Decisiones permanentes**: sin `lookAt`/seguimiento de mirada, sin ragdoll (al morir,
  animación `death` y pose estable), sin físicas cosméticas (cloth/hair), sin VFX ni voces en
  el MVP.
- **Hoy**: el token es un cilindro (peana) con un retrato 2D (`avatar_path`/`TokenIcon`).
  **No existe pipeline glTF, ni animación, ni skinning, ni `@react-three/drei`**: todo ese
  subsistema (loader, rig, `AnimationMixer`, cache, LOD) es nuevo y es la parte cara de la
  rebanada. Dependencia nueva propuesta: `@react-three/drei` (aporta `useGLTF`,
  `useAnimations`, `GLTFLoader` y `SkeletonUtils` vía `three-stdlib`).
- **Decisión**: la Fase A (slots) ya está cerrada, así que no hay bloqueo; conviene no solapar
  las fases de ficha/tablero con las fases D y F de la rebanada 1. No se implementa por estar
  aquí escrito.

### 4.16 Notas de la Fase 5b (creador de personaje)
- **Habilidades a elegir que concede la especie** (la «Versatilidad» del semielfo son dos
  habilidades a elegir): el asistente solo aplica las habilidades fijas de la especie. Las
  opcionales (`starting_proficiency_options` en dnd5eapi) ni siquiera llegan al SQLite con
  `sync-srd`, así que hoy nadie las concede. Es una regla del SRD que falta, no un cambio de
  presentación: entra con una fase propia (sincronizar el campo + elección en el creador).
- **Rasgos de clase con variantes** (estilos de combate del guerrero): el creador los enseña
  agrupados bajo su rasgo padre, pero la elección sigue haciéndose desde la ficha como texto
  libre, porque los rasgos narrativos no tienen motor de efectos.
- **Autoridad de PG al finalizar**: el asistente anterior calcula y envía los PG iniciales;
  conservar esa ruta evita cambiar reglas en la 5b. Centralizar y validar ese cálculo en servidor queda para una fase propia.

### 4.17 Ideas de mesa aparcadas (23-sep-2026)
Salieron al diseñar las fases 4b–4d del programa de gameplay; Juan decidió dejarlas fuera.

- **Inspiración** (SRD 5.1): el DM la concede por interpretar bien y el jugador la gasta
  para tener ventaja en una tirada. Regla oficial, no homebrew: campo booleano en el PJ que
  solo escribe el DM, consumo en servidor y motivo «Ventaja: inspiración» en el revelado de
  la 4b. Premia el rol; entra cuando se abra superficie nueva.
- **Tirar con dados físicos**: el jugador escribe el número que le ha salido en la mesa real
  y queda registrado como «dado físico», marcado así ante la mesa. Es del modo presencial
  (Fase 10 del ROADMAP, aparcada). Rompe la autoridad del servidor sobre el d20, así que
  necesita decisión explícita (capacidad por campaña, apagada por defecto).
