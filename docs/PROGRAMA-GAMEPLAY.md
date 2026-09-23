# Programa «Pulir el gameplay» — fases de implementación

Este documento es el **prompt de implementación** del siguiente tramo de TriDnD. Está
escrito para la sesión de código (Claude Code o Codex) que ejecute cada fase, y para
Astra, que lo dirige y verifica. Decisiones tomadas con Juan el 21-sep-2026.

- Contexto y reglas permanentes: [../CLAUDE.md](../CLAUDE.md)
- Visión e invariantes: [ARQUITECTURA.md](ARQUITECTURA.md)
- Lo que ya está hecho y su deuda: [VERTICAL-SLICE.md](VERTICAL-SLICE.md)
- Estado e historial: [../ROADMAP.md](../ROADMAP.md)

## Cómo usar este documento

Cada sesión de código recibe **una sola fase**: «Lee `docs/PROGRAMA-GAMEPLAY.md` y ejecuta
la Fase N». La sesión lee las reglas globales, la fase, y nada más. Termina cuando los
criterios de aceptación de esa fase están cumplidos y verificados, y **para**: no empieza
la siguiente. Entre fase y fase Juan confirma.

Orden: **1 → 2 → 3 → 4 → 4b → 4c → 4d → HITO (jugar con el grupo) → 5 → 5b → 6 → 7 →
8 → 9 → 10**. Las fases 4b, 4c y 4d se añadieron el 23-sep-2026 (ver su introducción).
Las tareas «en paralelo» del final no son de código y no bloquean nada.

---

## Reglas globales para la sesión que implementa

1. **Lee antes de tocar**: `CLAUDE.md`, esta fase completa, y el código que la fase
   nombra. Si el repositorio contradice este documento, manda el repositorio: anótalo en
   tu informe final.
2. **Alcance cerrado.** Si algo queda fuera de «Qué entra», no se hace aunque quede a
   mano; se anota en dos líneas en el backlog de `docs/ARQUITECTURA.md` §4.
3. **Reglas D&D 5e 2014 (SRD 5.1)**, tal cual. Nada de 2024, nada inventado. Cuando el
   SRD no diga algo, se elige la lectura más simple y se deja escrita en un comentario.
4. **El servidor es la autoridad.** Todo consumo, recuperación, coste y validación se
   resuelve en servidor; el cliente pinta y anticipa. Ningún campo derivado lo escribe
   el cliente.
5. **Migraciones append-only** al final del array de `server/src/db.js`. Nunca se edita
   una aplicada. Las migraciones de datos sobre fichas existentes son conservadoras.
6. **Privacidad**: lo que el jugador no debe ver no llega a su socket. Reutiliza el
   filtrado que ya existe; no inventes uno nuevo.
7. **Español** en código orientado al usuario, comentarios y mensajes. La interfaz
   bilingüe entra en las fases 7 y 8, no antes.
8. **Un solo motor 3D** (three + react-three-fiber). Nada de Babylon.
9. **Lo visual nunca es fuente de verdad.** Un icono, un sonido o una animación leen el
   estado; no lo deciden.
10. **Sonido y animación siempre opcionales**: respeta `prefers-reduced-motion` y el
    silencio del usuario; nada de gameplay depende de que suenen o se muevan.
11. **Pruebas**: cada regla nueva lleva prueba de servidor; cada espejo cliente, prueba
    de dominio. `npm test` en verde al cerrar. Si la fase toca la interfaz, verifícala
    en el navegador (móvil 390 px y escritorio) antes de darla por cerrada.
12. **Al cerrar la fase**: actualiza `ROADMAP.md` (marca la fase, resume lo hecho en el
    estilo del documento), la tabla de deuda de `docs/VERTICAL-SLICE.md` si pagas alguna
    fila, y `CLAUDE.md`/`AGENTS.md` solo si nace una regla permanente. Entrega un
    informe: archivos tocados, decisiones tomadas por el camino, qué queda fuera.
13. **No hagas commit, push ni despliegue** sin que Juan lo pida en esa sesión.

---

## Fase 1 — Consumo de espacios de conjuro

**Objetivo**: lanzar un conjuro gasta un espacio, el sistema lo lleva solo y el jugador lo
ve claro, como en un videojuego.

**Qué entra**

- Modelo: `characters.spells.slotsUsed` ya existe (`{ "1": n, … }`) y `services/rest.js`
  lo pone a cero en el descanso largo; nadie lo incrementa. Los máximos por nivel salen de
  `services/classProgression.js` (tabla `class_levels`). Para clases personalizadas de la
  Fase 26 sin progresión, no hay espacios: se lanza sin límite y la ficha lo dice.
- **Todo lanzamiento de nivel ≥ 1 pasa por el servidor** y consume un espacio: el del
  tablero (`sockets.js`, donde `spellDataForCharacter` comprueba «preparado») y el de la
  ficha (hoy `lib/spellcasting.js` tira en cliente y publica; debe pedir primero al
  servidor que consuma, con una ruta o socket nuevo, y solo entonces tirar). Los trucos
  no consumen.
- **Lanzar con espacio superior**: al lanzar, el jugador elige el nivel del espacio entre
  los disponibles ≥ nivel del conjuro. El escalado de daño por espacio ya existe en
  `services/spellAreas.js` (`damage_at_slot_level`); úsalo con el nivel elegido. Si solo
  hay un nivel posible, no se pregunta.
- **Sin espacio, no se lanza**: rechazo en servidor con mensaje claro («No te quedan
  espacios de nivel 2»), y en cliente el conjuro aparece atenuado con el motivo antes de
  intentarlo.
- **Descansos**: largo restaura todos; corto no restaura nada **salvo la magia de pacto
  del brujo** (`class_index === 'warlock'`, sus espacios de `class_levels`). Nada más.
- **Ajuste manual solo del DM**, desde la ficha de cualquier PJ, con mensaje de sistema en
  el chat («El DM ajusta los espacios de X»). El jugador no edita espacios a mano.
- **Interfaz**: sección «Espacios de conjuro» en la ficha con pips por nivel (llenos /
  gastados); en el HUD del tablero, los mismos pips junto a los conjuros; mensaje de chat
  al lanzar: «X lanza Y (espacio de nivel N, quedan k)».

**Qué queda fuera**: recursos de clase (Fase 2), recuperación arcana del mago (Fase 2),
puntos de hechicería, conjuros rituales, componentes, concentración (ya existe).

**Código que probablemente cambia**: `server/src/sockets.js` (lanzamiento),
`server/src/services/rest.js`, `services/classProgression.js`, `routes/characters.js`
(ajuste del DM), `client/src/lib/spellcasting.js`, `pages/CharacterSheetPage.jsx`,
`features/tactical-map/components/PlayerHud.jsx` y el panel de conjuros del tablero.

**Criterios de aceptación**

1. Un mago de nivel 2 (2 espacios de nivel 1) lanza dos conjuros de nivel 1; el tercero
   lo rechaza el servidor. Prueba de servidor.
2. Un descanso largo le devuelve los dos; un descanso corto, ninguno. Prueba.
3. Un brujo de nivel 2 recupera su espacio de pacto en un descanso corto. Prueba.
4. Un clérigo de nivel 3 lanza *Curar heridas* con un espacio de nivel 2 y el daño/curación
   escala; el espacio consumido es el de nivel 2, no el de nivel 1. Prueba.
5. Un truco se lanza sin límite y no toca `slotsUsed`. Prueba.
6. Lanzar desde la ficha fuera del tablero consume igual que desde el tablero.
7. El DM ajusta espacios y queda el mensaje en el chat; un jugador que intenta el mismo
   `PUT` recibe 403.
8. En el navegador: los pips se ven en ficha y HUD, y un conjuro sin espacio aparece
   atenuado con el motivo en su tooltip.

**Al cerrar**: tachar la parte de espacios de la fila 19 de la tabla de deuda.

---

## Fase 2 — Recursos de clase

**Objetivo**: los recursos de clase del SRD existen en la ficha, se gastan con un botón
que hace lo oficial, y los descansos los devuelven según la regla.

**Qué entra**

- Nuevo `server/src/rules/classResources.js`: **tabla estática** de los once recursos, con
  clave, nombre, clase, cómo se calcula el máximo, recuperación y coste de acción **según
  el SRD 2014**. Fuente numérica: `class_levels.class_specific` cuando exista.

| Recurso | Clase | Máximo | Recupera | Coste de acción |
| --- | --- | --- | --- | --- |
| Furia | Bárbaro | `rage_count` | largo | acción adicional |
| Puntos de ki | Monje | `ki_points` | corto | variable |
| Oleada de acción | Guerrero | `action_surges` | corto | ninguno (**concede una acción extra este turno**) |
| Indomable | Guerrero | `indomitable_uses` | largo | ninguno (repetir salvación) |
| Aliento de combate | Guerrero | 1 | corto | acción adicional (cura 1d10 + nivel) |
| Canalizar divinidad | Clérigo / Paladín | `channel_divinity_charges` (clérigo); paladín 1 desde nivel 3 | corto | acción |
| Inspiración bárdica | Bardo | máx(1, mod. CAR) | largo; **corto desde nivel 5** | acción adicional |
| Forma salvaje | Druida | 2 (desde nivel 2) | corto | acción |
| Imposición de manos | Paladín | reserva de 5 × nivel PG | largo | acción (gasta la cantidad elegida) |
| Puntos de hechicería | Hechicero | `sorcery_points` | largo | variable |
| Recuperación arcana | Mago | 1 al día | largo | durante un descanso corto: recupera espacios que sumen ≤ ⌈nivel/2⌉, ninguno de nivel 6+ |

- **Modelo**: `characters.resources` JSON `{ clave: { max, used } }`, **derivado en
  servidor** al terminar el asistente, al subir de nivel y al cambiar una característica
  (la inspiración depende de CAR). Nunca lo escribe el cliente.
- **Usar** (`POST /characters/:id/recursos/:clave/usar` o socket equivalente): el servidor
  comprueba usos, descuenta, aplica el efecto **solo cuando es economía de turno o
  números puros** (oleada de acción → acción extra en `turnEconomy.js`; aliento de combate
  → tira y cura; imposición de manos → cura la cantidad; recuperación arcana → devuelve
  espacios elegidos), y consume la acción o acción adicional que diga la tabla si hay
  combate y es su turno. Fuera de combate solo descuenta. El efecto narrativo de furia,
  ki, hechicería, canalizar o forma salvaje **se narra**, no se automatiza (decisión de la
  Fase 26). Mensaje de sistema en el chat en todos los casos.
- **Variable** (ki, hechicería): el botón pide cuántos puntos y no toca la economía de
  turno; el jugador gasta la acción a mano como con cualquier rasgo narrativo.
- **Descansos**: `services/rest.js` restaura según `recupera`. Esto es lo que la Fase F no
  pudo hacer; ahora sí.
- **Interfaz**: sección «Recursos» en la ficha (pips + «Usar»); en el HUD, slots de recurso
  en el hotbar con contador e icono; tooltip con qué hace y qué cuesta.
- **Clases personalizadas** de la Fase 26: sin recursos en esta versión; la ficha no
  enseña la sección.

**Qué queda fuera**: efectos mecánicos de furia/forma salvaje/metamagia, dotes, recursos de
subclase, cualquier recurso que no esté en la tabla.

**Código que probablemente cambia**: `server/src/rules/classResources.js` (nuevo),
`db.js` (migración: columna `resources`), `routes/characters.js`, `sockets.js`,
`services/rest.js`, `services/turnEconomy.js` (acción extra), `services/levelUp` (o donde
viva la subida de nivel de la Fase D), `pages/CharacterSheetPage.jsx`, `PlayerHud.jsx`.

**Criterios de aceptación**

1. Un guerrero de nivel 2 usa oleada de acción en su turno: gana una segunda acción ese
   turno; no puede usarla otra vez; un descanso corto se la devuelve. Prueba de servidor.
2. Un bárbaro de nivel 1 tiene 2 furias; las usa; solo el descanso largo las devuelve.
   Prueba.
3. Un bardo con CAR 16 tiene 3 inspiraciones; a nivel 5 las recupera en corto, a nivel 4
   no. Prueba.
4. Un paladín de nivel 3 cura 7 PG con imposición de manos: la reserva baja de 15 a 8 y el
   objetivo sube 7. Prueba.
5. Un mago de nivel 4 con espacios gastados usa recuperación arcana en un descanso corto y
   recupera hasta 2 niveles de espacio; no puede usarla dos veces al día. Prueba.
6. Un usuario que hace `PUT` de `resources` recibe rechazo: el campo no es escribible.
7. En el navegador: pips en ficha, slots en el HUD, mensaje en el chat al usar.

**Al cerrar**: tachar la fila 19 entera de la tabla de deuda.

---

## Fase 3 — Pulido de mesa (nueve arreglos, un solo corte)

**Objetivo**: cerrar los huecos visibles que quedaron tras la reforma del HUD.

**Qué entra**

1. **Tumba sobre el muerto definitivo.** `deathState` ya viaja al cliente
   (`sockets.js:206`). `domain/tokens.js#isTokenDowned` mira solo `hp <= 0`; distinguir
   *caído* (agonizando/estable) de *muerto* y pintar el muerto como tumba en
   `MapToken.jsx`. Sin cambiar qué datos viajan.
2. **Cartel de combate en escaramuzas.** En una escaramuza los enemigos nacen con
   `startCombat: false` (`services/skirmishes.js`) y el cartel «¡Combate!» solo salta desde
   `combat:start` o el revelado en modo libre. Disparar `notifyCombatStarted` en el punto
   en que la escaramuza pasa a turnos de verdad. «¡Tu turno!» ya existe.
3. **La cámara sigue al enemigo que actúa.** El servidor emite `combat:acting` (solo el
   id). Consumirlo en `store/socket.js` y deslizar `TacticalCamera.jsx` hasta su token
   **solo si ese token está en la vista filtrada del jugador**; si no lo ve, la cámara no
   se mueve (moverla revelaría dónde está).
4. **Sonidos enganchados.** El catálogo (`lib/sfx/catalog.js`) tiene 15 efectos y solo
   suenan los dados. Enganchar impacto / fallo / crítico, daño recibido, curación, puerta,
   inicio de combate, «tu turno», caída y muerte, botín, subida de nivel — cada uno en el
   sitio donde el store recibe el evento del servidor, nunca al pulsar el botón. Además:
   la página `/configuracion/sonidos` debe **decir por qué** no puedes subir sonidos cuando
   no eres administrador («Solo el administrador de la instalación (usuario X) puede
   cambiar los sonidos por defecto; tu volumen y silencio sí son tuyos»).

*Añadido el 23-sep-2026 (misma conversación que las fases 4b–4d):*

5. **El golpe se ve en el tablero.** Al resolverse un ataque, el token atacante embiste
   un instante hacia el objetivo; si impacta, el objetivo parpadea en rojo y se sacude;
   si falla, se aparta. Los proyectiles (`Projectiles.jsx`) se encadenan con esto. Lee
   el evento del store, no decide nada; solo con tokens visibles para ese jugador.
6. **Cuando te atacan a ti**: rótulo «El orco te ataca», la cámara al atacante (punto 3)
   y tu retrato se sacude al recibir el golpe.
7. **Puertas y trampas que revelan.** Al abrir una puerta, la niebla se levanta con un
   barrido desde la puerta y un sonido, en lugar de apagarse de golpe. Una trampa
   descubierta con Percepción se ilumina poco a poco solo para quien la encontró (ya es
   quien la recibe del servidor).
8. **«¡Tu turno!» aunque estés en otra ventana**: con Discord delante se pierde el turno.
   Si la pestaña no está visible, el título parpadea («⚔ ¡Tu turno! · TriDnD») hasta
   volver, y hay una notificación del navegador si el usuario la activa (pedida con un
   botón, nunca al entrar).
9. **Vibración en móvil** (`navigator.vibrate`, si existe) al impactar, al recibir daño,
   en críticos y en «tu turno». Se apaga con el silencio del usuario.

**Qué queda fuera**: samples reales (los consigue Juan y se suben por la página), música,
Spotify.

**Criterios de aceptación**: prueba de dominio para `isTokenDowned`/muerto; prueba de
servidor de que el cartel salta en escaramuza; prueba de que la cámara no se mueve hacia
un token no visible; en el navegador, cada evento suena una vez y `prefers-reduced-motion`
no lo bloquea (el silencio sí). Además: la embestida no se reproduce hacia tokens que el
jugador no ve; con la pestaña oculta, el título avisa del turno y se restaura al volver;
el barrido de niebla no revela celdas que el servidor no haya enviado.

---

## Fase 4 — Registro de juego: que te enteres de todo

**Objetivo**: el registro de la mesa cuenta **todo lo que ha pasado con los dados**, se ve,
y se lee como el log de un videojuego, no como prosa.

**Qué entra**

- **Desglose completo en cada tirada**: cada dado (con el descartado tachado en
  ventaja/desventaja), cada modificador por separado (característica, competencia,
  otros), el objetivo (CA/CD) **cuando ya se ha revelado**, el resultado (impacto, fallo,
  crítico, pifia) y el daño por tipo con los ajustes de resistencia/inmunidad aplicados.
  `serverDice.js` ya produce `groups` con `rolls`/`kept`; `RollCard.jsx` los pinta a medias.
- **Agrupado por ronda** durante el combate, con cabecera de ronda, y entradas de sistema
  como filas propias: inicio/fin de combate, turno de X, condición aplicada/vencida,
  descanso, subida de nivel, botín, uso de recurso, espacio de conjuro gastado.
- **Filtro**: todo / tiradas / combate / sistema. Búsqueda no.
- **Más visible**: abierto por defecto en escritorio como panel lateral plegable; en
  móvil, contador de no leídos y la última entrada como toast breve sobre el tablero.
- **Privacidad intacta**: tiradas ocultas siguen ocultas; los PG exactos de enemigos no se
  muestran al jugador (hoy tampoco). Nada de datos nuevos hacia el jugador: solo mejor
  presentación de lo que ya recibe.

*Añadido el 23-sep-2026:*

- **Reacciones a las tiradas**: un toque sobre una entrada de tirada añade una reacción
  de un conjunto cerrado (🔥 😱 😂 👏 💀), visible para quien ve esa tirada; una por
  usuario y tirada. Se guardan en servidor (migración) y nunca se exponen sobre mensajes
  que el usuario no pueda ver.
- **Susurros**: `/s <nombre> <texto>` manda un mensaje privado a un jugador (o al DM).
  Usa **el mismo filtrado en servidor que las tiradas ocultas**: solo llega al autor, al
  destinatario y al DM. Al destinatario le aparece además como nota breve sobre el
  tablero.
- **Resumen de combate**: al terminar un combate, una tarjeta para toda la mesa con el
  daño hecho por cada PJ, los críticos y pifias, el golpe final y quién cayó. Se calcula
  con los mensajes del registro de ese combate; los números de los enemigos solo los ve
  el DM. No es el resumen de sesión (sigue fuera).

**Qué queda fuera**: exportar el registro, resumen de sesión, diario de campaña (backlog
§4.12). La narración del DM en pantalla y «¿cómo quieres hacerlo?» son de la Fase 4d.

**Código que probablemente cambia**: `components/RollCard.jsx`, el cajón de la mesa
(`GameDrawer.jsx`), `store/socket.js`, los mensajes de sistema de `sockets.js` si les
falta estructura (añadir campos, nunca quitar).

**Criterios de aceptación**: un ataque con ventaja muestra los dos d20 con el descartado
tachado, +FUE +competencia por separado, «contra CA 15» tras resolverse, e «impacta»;
un daño de fuego contra una criatura resistente muestra «12 fuego → 6 (resistencia)»; las
entradas quedan bajo «Ronda 3»; la tirada oculta del DM no aparece al jugador (prueba de
privacidad existente sigue en verde). Prueba de servidor: un susurro no llega al socket
de un tercero, y una reacción sobre una tirada oculta no llega a quien no la ve; el
resumen de combate no enseña al jugador daño o PG de enemigos que no conociera.

---

## Fases 4b, 4c y 4d — Que los dados se vivan

Decididas con Juan el 23-sep-2026 tras una partida de prueba. El diagnóstico: **el juego se
siente automatizado, como si no hubiera dados de por medio**. Causas comprobadas en el
código en esa fecha:

- **El que ataca no ve sus propios dados.** La bandeja 3D (`features/dice-tray/`) solo
  rueda las tiradas que pasan por `store/dice.js#submitRoll` (el tirador y la ficha
  completa). El panel de ataque del tablero (`AttackPanel.jsx`), el de monstruo del DM
  (`MonsterAttackPanel.jsx`) y la ficha rápida (`CharacterQuickView.jsx`) tiran por su
  cuenta; los conjuros, los ataques de oportunidad, la concentración, la IA enemiga y los
  fluidos los tira el servidor. Todas llegan como mensaje `roll` con autor = quien actúa,
  y `dice-tray/lib/incoming.js` descarta a propósito las propias: **ruedan para los
  demás, nunca para quien las hace**.
- **El resultado llega sin suspense**: el panel pinta total, CA y «¡Impacta!» en cuanto
  responde el servidor, todo a la vez.
- **Todo pasa en el centro, encima del objetivo**: panel de ataque abajo-centro, ficha
  rápida como modal centrado con fondo oscuro y bandeja también centrada. El token al que
  atacas queda tapado.
- **El jugador no tira en sus momentos más tensos**: las salvaciones de un PJ contra un
  conjuro (`sockets.js`, `combate:lanzar-conjuro`) y la iniciativa (`combat:start`,
  `combat:add-party`) se tiran solas.
- **Los tiempos del servidor y del cliente no se conocen**: los turnos de la IA ya tienen
  ritmo (`services/turnPacing.js`, `BEATS`, escala `TRIDND_TURN_PACE`), pero si el
  cliente tarda más en revelar un dado que el hueco entre dos ataques, las tiradas se
  pisan.

Tres fases, en este orden, antes del HITO: **4b** hace que cada tirada sea un momento;
**4c** pone los dados en manos del jugador; **4d** le da voz al DM como narrador.

---

## Fase 4b — La tirada como momento

**Objetivo**: toda tirada que te afecta se ve rodar, se revela por pasos y se lee sobre el
tablero, al ritmo que cada uno elija.

**Qué entra**

- **Todas tus tiradas ruedan.** Ataque y daño del tablero (PJ y monstruo del DM), ficha
  rápida, conjuros, oportunidad y concentración pasan por la bandeja. Las tiradas del
  cliente, llamando a `submitRoll` (o a un punto único equivalente). Las del servidor,
  dejando de descartar las propias en `incoming.js` cuando el mensaje es la
  **respuesta** a una acción tuya que no rodó en local. Regla: **cada tirada rueda una
  sola vez en cada pantalla**. Las del DM con la IA ruedan para el DM igual que para los
  jugadores. Las tiradas ocultas siguen sin llegar a quien no debe verlas: el cliente no
  vuelve a decidir la privacidad.
- **Revelado por pasos, nunca antes que el dado.** Los paneles muestran «Rodando…» hasta
  el `onSettled` de la bandeja. Después, en secuencia: número natural → «+5 = 19» →
  «contra CA 15» → sello **¡IMPACTA! / FALLA / ¡CRÍTICO! / PIFIA**. El daño igual:
  dados → total → ajuste por resistencia o inmunidad, si lo hay. El resultado ya lo
  conoce el cliente: es **presentación**, no se retrasa ninguna regla ni ninguna
  respuesta del servidor. La red de seguridad de `DiceOverlay.jsx` (enseñar pasado el
  tiempo máximo si la bandeja no carga) se mantiene.
- **Margen visible tras resolver**: «impacta por 1», «falla por los pelos» (a 1 o 2),
  «supera la CD por 10». Solo cuando el objetivo (CA/CD) ya se ha revelado en esa
  tirada; nunca adelanta la CA de una criatura.
- **Motivos de ventaja o desventaja antes de tirar.** En el panel de ataque, junto a
  los botones: «Ventaja: objetivo derribado», «Desventaja: objetivo esquivando». Salen
  de `domain/combatRules.js` (ya los calcula). Cuando caen los dos d20, el descartado
  se atenúa y el motivo sigue visible.
- **Resultado sobre el tablero.** Texto flotante sobre el token afectado: «−8», «FALLA»,
  «¡CRÍTICO!», «+6» de curación, con color por tipo. Vive en un componente de
  react-three-fiber que **solo lee** un evento del store (regla global 9) y se ancla a
  la posición del token. Un token fuera de la vista filtrada del jugador no muestra
  nada.
- **Los paneles dejan ver.** Mientras rueda una tirada, el panel de ataque o de conjuro
  se pliega a una tira pequeña y la ficha rápida se aparta a un lateral (o se minimiza
  en móvil) sin cerrarse. Al terminar el revelado vuelven solos. El objetivo del ataque
  no puede quedar tapado a 390 px ni en escritorio.
- **Ritmo configurable por usuario: cinemático / normal / rápido.** Escala el reposo de
  la bandeja (hoy `REPOSO_MS` 850 y `REPOSO_DRAMATICO_MS` 1500 en `DiceTray.jsx`), las
  pausas del revelado y el texto flotante. Es preferencia de cada visor (se guarda en su
  navegador, con `try/catch`), por defecto «normal». `prefers-reduced-motion` equivale a
  «rápido» sin bandeja. Selector en el tirador de dados y en `/configuracion/sonidos`
  (que pasa a llamarse «Sonido y ritmo»).
- **Cola de revelados.** Las tiradas que llegan mientras otra se revela esperan su turno
  en una cola del cliente y no se pisan. Si la cola acumula más de dos, las siguientes se
  revelan al ritmo «rápido» hasta ponerse al día: nunca se va más de unos segundos por
  detrás de la mesa. Los `BEATS` de `turnPacing.js` (`entreAtaques`, `trasAtaque`) se
  ajustan para que, a ritmo «normal», un ataque de la IA quepa entero en su hueco.
- **Críticos con ceremonia**: medio segundo de cámara lenta en la bandeja, sello dorado y
  un leve empujón de cámara hacia el objetivo si está en tu vista. La pifia, sello rojo
  apagado. Todo con `prefers-reduced-motion`.

**Qué queda fuera**: lanzar el dado a mano (arrastrar o agitar; ver 4c), cambios de
reglas, cualquier dato nuevo hacia el jugador, animaciones de token (embestida y
esquiva: Fase 3).

**Código que probablemente cambia**: `components/DiceOverlay.jsx`,
`features/dice-tray/` (componente, `incoming.js` y una cola nueva en `lib/`),
`store/dice.js`, `AttackPanel.jsx`, `MonsterAttackPanel.jsx`, `CharacterQuickView.jsx`,
el panel de conjuros, `TacticalMap.jsx` (colocación de los paneles), un componente nuevo
de texto flotante en `features/tactical-map/components/`, `services/turnPacing.js`,
`pages/SoundSettingsPage.jsx`.

**Criterios de aceptación**

1. Prueba de dominio de la cola: tres tiradas que llegan casi a la vez se revelan en
   orden, sin solaparse, y la tercera acelera si la cola pasa de dos.
2. Prueba de dominio: una tirada propia rueda exactamente una vez, tanto si nace en el
   cliente como si la hace el servidor en respuesta a tu acción.
3. En el navegador: un ataque desde el tablero enseña los dados, «Rodando…», el revelado
   por pasos y el «−N» sobre el token enemigo. Otro jugador ve lo mismo con el nombre de
   quien tira.
4. Un ataque con ventaja muestra el motivo antes de tirar y los dos d20 con el
   descartado atenuado; tras resolver, «impacta por N».
5. A 390 px y en escritorio, el token objetivo sigue visible durante todo el revelado.
6. Los tres ritmos se notan; `prefers-reduced-motion` enseña el resultado directo; la
   prueba de privacidad de tiradas ocultas sigue en verde.

---

## Fase 4c — Los dados en manos del jugador

**Objetivo**: en los momentos que importan a un PJ (su salvación, su iniciativa, lo que
pide el DM, su muerte), el jugador pulsa y tira. **El servidor sigue tirando**: el botón
solo le pide la tirada, y si el jugador tarda, la hace él solo.

**Mecánica común: la tirada pendiente**

- El servidor crea una **tirada pendiente** para un PJ (tipo, característica o
  habilidad, CD si procede, origen, **fecha límite a 8 s**), la envía **solo** al socket
  del dueño del PJ y al DM, y espera. Al pulsar «Tirar», el cliente manda
  `tirada:resolver`; el servidor tira con `serverDice.js` como hoy y continúa. Pasados
  8 s, el servidor tira solo y lo dice en el registro («tirada automática»). **Ninguna
  resolución queda colgada**: el plazo lo impone el servidor, no el cliente, y al
  reiniciarse el servidor las pendientes se resuelven automáticamente.
- Preferencia por jugador «Tirar mis salvaciones automáticamente» (apagada por defecto)
  para quien prefiera ir rápido: con ella activa, el servidor no espera.
- Los PNJ y monstruos siguen tirando solos, sin espera.
- **Panel de pendientes del DM**: «Salvación de DES: Aria ✓ 14 · Bruno ⏳ 5 s · Cira ✓ 8»
  con «Tirar ya» por fila y para todos.
- Todas las tiradas de esta fase pasan por la bandeja y el revelado de la 4b.
- **Agitar para tirar** (opcional, solo móvil): con una tirada pendiente en pantalla,
  agitar el teléfono equivale a pulsar «Tirar». Detrás de un permiso explícito del
  navegador y apagado por defecto.

**Qué entra**

- **Salvaciones propias**: las de un PJ contra un conjuro (`combate:lanzar-conjuro`) y
  contra una zona de peligro o fluido (`services/fluidEffects.js`,
  `services/hazardZones.js`). Un conjuro de área con varios objetivos espera a todas
  sus pendientes y se resuelve una sola vez con todos los resultados.
- **Salvación de concentración** (`combat:concentration-save`): pendiente para el dueño
  del PJ.
- **Iniciativa como ritual**: al empezar el combate (`combat:start` con tirada,
  `combat:add-party`), cada PJ recibe su pendiente de iniciativa. La tira de iniciativa
  aparece y los retratos se ordenan con animación según llegan los resultados. Los
  enemigos tiran solos, como hoy (con su desglose oculto). La iniciativa manual del DM se
  respeta.
- **Salvación de muerte con tensión**: ya la pulsa el jugador (`combat:death-save`).
  Ahora, a pantalla oscurecida, con latido si hay sonido y los tres huecos de éxito y
  fallo grandes, y el resultado revelado por pasos. Un 20 natural, cerrando con
  ceremonia.
- **Tirada pedida por el DM**: el DM elige tipo (prueba de característica, habilidad o
  salvación), objetivo (uno, varios o todo el grupo), CD opcional y si **revela la CD**
  al terminar. Cada PJ recibe su pendiente; **los resultados los ve toda la mesa**
  (decisión de Juan). La CD, solo si el DM la revela.
- **Tirada de grupo** (SRD 5.1, «Group Checks»): variante de la anterior. Todos tiran, y
  si **al menos la mitad** supera la CD, el grupo la supera. El resultado colectivo se
  revela al final, después de todos los dados.
- **Trampas con susto**: al disparar una trampa con salvación, suena un «¡Clic!», el
  tablero se oscurece un instante y salta la salvación pendiente de cada PJ afectado. La
  consecuencia se aplica cuando llegan todas.
- **Acción Ayudar** (SRD 5.1, «Help»): nueva acción especial junto a Correr, Esquivar y
  Destrabarse (`turnEconomy.js`, `combat:special-action`). Gasta la acción y da
  **ventaja** a un aliado en su siguiente prueba de característica para esa tarea, o en
  su siguiente tirada de ataque contra una criatura a 5 pies o menos de quien ayuda,
  antes del siguiente turno de quien ayuda. El servidor guarda la ayuda en el
  combatiente, la consume al usarla y la vence al empezar el turno de quien ayudó. El
  motivo aparece en la 4b («Ventaja: te ayuda Bruno»). Tecla de atajo junto a las demás
  (`domain/shortcuts.js`).

**Qué queda fuera**: tirar con dados físicos e introducir el número (modo presencial,
backlog), reacciones a ataques enemigos (conjuro *Escudo* y similares), inspiración
(backlog), salvaciones del DM por sus monstruos con botón.

**Código que probablemente cambia**: `server/src/sockets.js` (pendientes, eventos nuevos
`tirada:pedir` / `tirada:resolver`, conjuros, concentración, iniciativa),
un servicio nuevo `services/pendingRolls.js` (plazos, puro y probado sin sockets),
`services/fluidEffects.js`, `services/hazardZones.js`, `services/turnEconomy.js` (Ayudar),
`db.js` (migración si la ayuda o las pendientes se persisten), `store/socket.js`,
componentes nuevos del aviso de tirada y del panel del DM, `InitiativeStrip.jsx`, la vista
de salvación de muerte.

**Criterios de aceptación**

1. Prueba de servidor: una *bola de fuego* sobre dos PJ y un goblin crea dos pendientes y
   ninguna para el goblin; si un PJ no tira en 8 s, el servidor tira por él y el conjuro
   se resuelve una sola vez con los tres resultados.
2. Prueba de servidor: una pendiente solo llega al dueño del PJ y al DM; `tirada:resolver`
   de otro usuario sobre una pendiente ajena se rechaza.
3. Prueba de servidor: una tirada de grupo de cuatro PJ con dos éxitos se supera; con uno,
   no.
4. Prueba de servidor: Ayudar da ventaja al siguiente ataque del aliado contra una
   criatura adyacente a quien ayuda, se consume al usarla y vence al empezar el turno de
   quien ayudó.
5. Prueba de servidor: con «tirar automáticamente» activo, no se crea espera.
6. En el navegador: al empezar un combate, cada jugador tira su iniciativa y la tira se
   ordena al llegar; el DM ve el panel de pendientes y «Tirar ya» funciona.

---

## Fase 4d — El DM como narrador

**Objetivo**: lo que el DM cuenta y cómo acaba una pelea se ve en la mesa como en un
videojuego, en vez de perderse en el chat.

**Qué entra**

- **Narración en pantalla**: el DM marca un mensaje como narración (botón en el cajón o
  comando `/n`) y aparece a todos como **subtítulo** sobre el tablero, con tipografía de
  la casa, durante un tiempo proporcional a su longitud (y ritmo de la 4b). Además queda
  en el registro como entrada propia.
- **«¿Cómo quieres hacerlo?»**: cuando un PJ deja a 0 PG a un enemigo, a su jugador le
  salta un aviso para describir el golpe final en una frase (opcional, se puede cerrar).
  La frase se muestra a todos como subtítulo y queda en el registro. No toca ninguna
  regla.
- **Presentación de jefe**: la **primera vez** que un enemigo marcado como jefe por el DM
  entra en la vista filtrada de los jugadores, aparece un cartel a pantalla completa con
  su nombre, un título opcional y su imagen o retrato, y sonido si lo hay. El DM lo activa
  por criatura (apagado por defecto). Si el jugador no lo ve, no salta (se decide en el
  servidor, con el mismo filtrado de visión que el tablero).
- **Nombre oculto hasta conocerlo**: el DM puede dar a un enemigo un **nombre visible**
  («Criatura escamosa») distinto del real, y revelarlo cuando quiera. **El servidor manda
  al jugador solo el nombre visible** (también en tiradas, registro, iniciativa y diario
  de bestiario) hasta la revelación. Por defecto el nombre visible es el real.
- **Estado de salud del enemigo con palabras**: el jugador ve *ileso* (PG al máximo),
  *herido* (por encima de la mitad), *malherido* (la mitad o menos), *a punto de caer*
  (un cuarto o menos) y *caído*. El servidor calcula la etiqueta y **manda solo la
  etiqueta**, nunca los PG. Umbrales en un módulo de dominio con prueba. Se ve en el
  tooltip del combatiente, en la tira de iniciativa y tras el texto flotante de daño.
  No es una regla del SRD, es presentación: no la usa ninguna regla.

**Qué queda fuera**: narración leída en voz alta, textos preparados por sala que saltan
solos al entrar (motor de disparadores, §4.14), música.

**Código que probablemente cambia**: `server/src/sockets.js` (tipo de mensaje de
narración, aviso del golpe final, serialización del nombre visible), `db.js` (migración:
nombre visible, marca de jefe con presentación, «ya presentado»), `GameDrawer.jsx`, un
componente de subtítulos y otro de cartel en `features/tactical-map/components/`,
`BestiaryJournalPanel.jsx`, `InitiativeStrip.jsx`.

**Criterios de aceptación**

1. Prueba de privacidad: con el nombre oculto, ningún evento que llegue al socket del
   jugador (combatientes, tiradas, mensajes, bestiario) contiene el nombre real; tras
   revelarlo, sí.
2. Prueba de servidor: la presentación de jefe se emite una sola vez por criatura y solo
   a quien la ve.
3. En el navegador: una narración del DM se ve como subtítulo en las dos pantallas y
   queda en el registro; al derrotar a un enemigo aparece el aviso del golpe final y la
   frase llega a todos.
4. Prueba de servidor: la etiqueta de salud cambia en los umbrales y el jugador nunca
   recibe `hpCurrent`/`hpMax` de un enemigo (la prueba de privacidad actual sigue).

---

## HITO — Jugar con el grupo (Fase 14 del ROADMAP)

No es código. Con las fases 1–4d desplegadas, Juan juega **una sesión real con el grupo**
y recoge fricciones en una lista corta: qué no se entendió, qué se buscó y no se encontró,
qué se sintió lento o plano. Esa lista **corrige el orden y el contenido de las fases 5 y
6** antes de empezarlas. Astra la convierte en criterios concretos.

---

## Fase 5 — El HUD como videojuego

**Objetivo**: que el HUD de la mesa se sienta como el de un videojuego, sin cambiar ni una
regla. La reforma anterior ordenó las zonas; esta les da respuesta, icono y estado.

**Qué entra**

- **Hotbar unificado por slots**: armas (ya), conjuros (por nivel, con los pips de espacios
  de la Fase 1), recursos de clase (Fase 2) y objetos usables — todos como slots con
  **icono propio (SVG, no emoji ni texto)**, estado *disponible / usado / no disponible
  con motivo en tooltip*, y la tecla asignada visible.
- **Retrato con estado**: marco que cambia con «tu turno», herido (< 50 %), agonizando,
  muerto; barra de PG con daño «fantasma» que se drena tras el golpe; PG temporales
  visibles como capa; CA con el escudo si lo lleva.
- **Recursos del turno** (acción, acción adicional, reacción, movimiento) como pips que se
  apagan con animación al gastarse y se encienden al empezar el turno.
- **Respuesta a cada gesto**: usar un slot pulsa + suena; no poder, sacude + motivo; el
  daño recibido tiñe el borde un instante. Todo con `prefers-reduced-motion`.
- **Tira de iniciativa**: retratos con el activo grande, el siguiente resaltado y las
  condiciones como iconos con tooltip.
- **Banner de turno** con ronda y cuenta atrás visual de lo que queda por gastar.
- **Aviso al terminar turno con recursos sin gastar** (añadido el 23-sep-2026): «Te quedan
  la acción adicional y 15 pies. ¿Terminar turno?», con «no volver a preguntar» por
  usuario.
- **Objetivos a tu alcance** (añadido el 23-sep-2026): con un arma o conjuro
  seleccionado, los enemigos que puedes atacar desde donde estás (alcance y línea de
  visión, de `domain/combatGeometry.js`) se resaltan y el resto se atenúa.
- Verificación a los mismos ocho tamaños y dos roles que la reforma anterior.

**Qué queda fuera**: reglas, datos nuevos hacia el jugador, iconos generados por IA (SVG
propios en `client/src/features/tactical-map/icons/`).

**Criterios de aceptación**: sin errores de consola; ningún slot tapado a 390 px; cada
slot tiene icono, estado y tooltip; un jugador que no ha jugado antes identifica en la
captura qué puede hacer ahora y qué no; `npm test` en verde (las pruebas de dominio del
hotbar y de atajos siguen).

---

## Fase 5b — Creación de personaje como videojuego

**Objetivo**: el asistente de creación se siente como el creador de personaje de un
videojuego (referencia: Baldur's Gate 3) sin cambiar ni una regla ni el modelo de datos
de la ficha. Hoy es un formulario por pasos correcto pero plano.

**Qué entra**

- **Orden de un videojuego**: campaña (solo la elección, porque decide qué clases y
  especies del DM aparecen) → especie → clase → características → competencias → equipo
  → **identidad al final** (nombre, retrato, pronombres, alineamiento, notas) → resumen.
  El nombre deja de ser obligatorio en el primer paso y pasa a serlo en el penúltimo.
  Los borradores existentes deben abrirse en un paso coherente (`wizard_step` se
  reasigna al cargar, sin migración de datos).
- **Tarjetas con arte** para especies y clases: ilustración propia curada y versionada en
  `client/public/creador/` (nada generado en tiempo de ejecución), emblema, nombre, rol y
  dificultad (ya existen `CLASS_SUMMARY` y `PRIMARY_ABILITY` en `lib/dnd.js`). Al
  seleccionar, panel de detalle: dado de golpe, salvaciones, competencias automáticas,
  rasgos de nivel 1 leídos de `features`/`traits`.
- **Vista previa viva** (`WizardPreview.jsx`) siempre visible, también en móvil como
  cajón: retrato o silueta, PG, CA, velocidad, salvaciones, habilidades y **ataques con
  las armas elegidas**, recalculado al instante; al pasar el ratón o el dedo sobre una
  opción, el delta que produciría («+2 DES → CA 14, Sigilo +4»).
- **«Reparto recomendado»** por clase en el paso de características: aplica el array
  estándar con la característica principal más alta y sugiere las habilidades típicas de
  la clase; el jugador puede ajustar todo después. **«Personaje aleatorio»**: especie,
  clase, características (tirada) y competencias válidas en un clic; el nombre no.
- **Compra por puntos** como tercer método junto a array y tirada (27 puntos, valores de
  8 a 15 antes de bonos raciales): es regla oficial del Manual del Jugador 2014 pero **no
  está en el SRD 5.1**, así que se rotula como tal en la interfaz y no requiere activación
  por campaña porque solo afecta a la creación. La introducción manual queda como
  «avanzado». Decisión tomada con Juan; si no la quiere, se quita este punto.
- **Validación que explica**: cada paso dice qué falta y por qué, junto al campo, no en
  un aviso general. Los términos llevan `StatTooltip`.
- **Transiciones** entre pasos (Framer Motion), progreso con iconos por paso, y todo con
  `prefers-reduced-motion`. Verificado a 390 px y en escritorio.
- Retrato: el panel actual (subir o generar) se integra en el paso de identidad. Se deja
  el hueco para el paso «Apariencia» de la miniatura (G2 de `MINIATURA-3D.md`), que irá
  entre equipo e identidad, sin implementarlo.

**Qué queda fuera**: multiclase, dotes, trasfondos con mecánica (el SRD solo trae uno),
subrazas y subclases nuevas, la miniatura 3D, cualquier cambio en cómo se calculan PG,
CA, competencias o equipo (todo eso es de la rebanada 1 y ya está).

**Código que probablemente cambia**: `pages/CharacterWizardPage.jsx` (orden y
`wizard_step`), `components/wizard/*` (todos), `WizardPreview.jsx`, `lib/wizard.js`
(recomendado, aleatorio, compra por puntos), arte en `client/public/creador/`.
`routes/characters.js` no cambia de modelo: el método de características ya se guarda
en `wizard_data`.

**Criterios de aceptación**

1. Prueba de dominio: «reparto recomendado» produce un personaje válido para las 12
   clases del SRD y «aleatorio» produce uno válido en 100 ejecuciones.
2. Prueba de dominio: la compra por puntos rechaza repartos fuera de 27 puntos o del
   rango 8–15.
3. Un borrador guardado con el orden antiguo se abre en un paso coherente y no pierde
   datos (prueba con `wizard_data` de una ficha real anonimizada).
4. La vista previa cambia al instante al elegir especie, clase, característica y arma;
   los deltas aparecen al pasar por encima.
5. Una persona que no ha jugado crea un guerrero completo en menos de cinco minutos sin
   abrir la ayuda (Juan lo prueba con alguien del grupo).
6. Móvil 390 px sin desbordes; `npm test` en verde.

---

## Fase 6 — Portada como menú principal y transiciones

**Objetivo**: entrar en TriDnD se parece a entrar en un juego.

**Qué entra**

- **Portada en `/`** con el arte de `client/public/menu-principal-tridnd.png`:
  «Continuar» (la mesa en vivo si la hay; si no, la última campaña) como protagonista,
  y debajo Campañas, Personajes, Compendio, Sonido. Las mesas como tarjetas con estado
  (en vivo, en combate, esperando al DM, borrador). El hub sigue en `/campanas`.
- **Transiciones** entre portada → hub → campamento → mundo → tablero: fundido o
  desplazamiento con Framer Motion (ya en el stack), coherente, corto, con
  `prefers-reduced-motion`. Pantalla de carga con el nombre de la campaña al entrar al
  tablero mientras cargan mapa y texturas.
- **Autenticación** intacta: `/acceso` sigue igual; la portada sin sesión muestra
  «Entrar».

**Qué queda fuera**: música de menú, ajustes nuevos, rediseño del hub.

**Criterios de aceptación**: `/` pinta la portada con las mesas reales del usuario; todos
los «← Hub» de la app siguen funcionando; móvil y escritorio verificados.

---

## Fase 7 — Idioma: preferencia por usuario y contenido del compendio en inglés o castellano

**Objetivo**: cada usuario elige idioma; el compendio se enseña en ese idioma. Es la mitad
barata de la decisión «que se pueda elegir en inglés o castellano».

**Decisión de producto nueva** (sustituye a «TODO en español»): **español por defecto,
inglés seleccionable por usuario**. El código, los comentarios y la documentación siguen en
español. Actualizar `CLAUDE.md` y `AGENTS.md` en esta fase.

**Qué entra**

- Migración: `users.locale` (`'es'` | `'en'`, por defecto `'es'`). Selector en ajustes y en
  la portada.
- El servidor sirve el compendio según el idioma del usuario: en `'en'`, `name_en` y el
  `data` original (que ya es inglés); en `'es'`, `name_es`/`desc_es` con el respaldo a
  inglés y la etiqueta «EN» como hoy. En modo inglés la etiqueta no aparece.
- Las **traducciones al español** de las categorías vacías (`features` 407,
  `magic-items` 362, `traits` 38, `rule-sections` 33, `languages` 16, `subclasses` 12,
  `alignments` 9, `rules` 6, `subraces` 4, `backgrounds` 1, `feats` 1) **las produce
  Astra**, fuera de esta fase, en `server/data/translations/es.json`, y se aplican con
  `npm run sync-srd`. Esta fase solo deja el comando que lista lo pendiente por
  categoría (`npm run srd:pendientes` o equivalente) y la estructura del archivo
  documentada para que los lotes encajen.

**Qué queda fuera**: la interfaz en inglés (Fase 8), la narración del servidor en inglés.

**Criterios de aceptación**: un usuario en `'en'` ve *Longsword* y su descripción
original sin etiqueta; en `'es'` ve *Espada larga*; el comando de pendientes devuelve los
recuentos anteriores; `CLAUDE.md`/`AGENTS.md` actualizados.

---

## Fase 8 — Idioma: interfaz bilingüe

**Objetivo**: la interfaz entera en español o inglés según `users.locale`.

**Qué entra**

- Infraestructura: `i18next` + `react-i18next`, diccionarios `client/src/locales/es.json`
  y `en.json`, español como respaldo. Convención `t('area.clave')`.
- Extracción **por áreas, un subcorte cada una**, en este orden: acceso y portada →
  personajes y asistente → mesa y HUD → taller/editor/mundo/archivo → compendio y
  biblioteca → ajustes. Cada subcorte se cierra verificado en los dos idiomas.
- **Limitación aceptada y documentada**: los mensajes que genera el servidor (narración
  del combate, mensajes de sistema, errores de la API) siguen en español en esta versión.
  Se les añade un `code` estable donde falte, para poder traducirlos en cliente en una
  fase posterior. Anotar en el backlog.

**Qué queda fuera**: más idiomas, traducción de la narración del servidor, detección
automática por navegador (se elige a mano).

**Criterios de aceptación**: ningún texto de interfaz hardcodeado en los componentes de
las áreas cerradas (comprobable con una búsqueda de cadenas en español dentro de JSX);
cambiar de idioma no recarga la página ni pierde estado; `npm test` en verde.

---

## Fase 9 — E2E solitario completo

**Objetivo**: una prueba de Playwright que proteja todo lo anterior.

**Qué entra**: crea un PJ con el asistente (equipo del manual incluido), monta una de las
tres escaramuzas de fábrica, confirma la vista de jugador, juega al menos una ronda
PJ → enemigo → PJ (mover, atacar, usar un recurso o lanzar un conjuro con espacio),
comprueba que el registro muestra el desglose, hace un descanso, y verifica derrota o
victoria y la reanudación del director automático. Sobre SQLite temporal, nunca la base
local. Se añade a `npm run test:e2e` y al workflow de despliegue como paso previo.

**Criterios de aceptación**: pasa en local y en CI; dura menos de tres minutos.

---

## Fase 10 — Miniatura 3D: G1 (fundamentos)

**Objetivo**: demostrar el pipeline de la miniatura con una especie, según
`docs/MINIATURA-3D.md` §13, sin abrir G2–G6.

**Condición previa obligatoria**: la **decisión de assets** (§17.1 de ese documento) la
investiga Astra y la cierra Juan **antes** de empezar. Sin assets validados (licencia y
rig), esta fase no arranca. Las otras siete decisiones del §17 van con la recomendación
por defecto salvo que Juan diga otra cosa: `@react-three/drei` sí; `gltfjsx` no en el
MVP; retrato 3D y avatar IA conviven y el jugador elige; BodyFamilies se confirman al ver
los assets; móvil solo retrato; calidad adaptativa automática con override; peanas por
campaña fuera.

**Qué entra**: exactamente G1 — migración (`appearance`, `portrait_path`), `domain/`
completo con pruebas puras (appearance, resolver, registry, fallback, bodyFamily),
`assetCache` + `MiniatureViewer`, **una especie** con cuerpo, peana e `idle`. Reutiliza la
escena, cámara, luces y patrón de disposal del tablero. Nada de esto entra en el tablero
todavía.

**Criterios de aceptación**: los del §15 de `MINIATURA-3D.md` que apliquen a G1, más:
un objeto sin modelo se equipa y funciona igual (fallback), y el visor libera memoria al
desmontar (auditoría de disposal).

---

## En paralelo (no es código de las fases)

- **Traducciones** (Astra): lotes por categoría en `es.json`, empezando por `features` y
  `magic-items` (86 % del total). Juan aplica `npm run sync-srd`.
- **Decisión de assets de la miniatura** (Astra investiga, Juan decide): Quaternius
  primero (CC0, humanoides riggeados), KayKit de reserva, encargo solo si ninguno da las
  nueve siluetas.
- **Administrador en el VPS** (Juan): añadir `TRIDND_ADMIN_USERS=<usuario>` a
  `/opt/tridnd/app.env` y reiniciar el contenedor; hasta entonces el administrador es la
  primera cuenta registrada en esa base.
- **Simulacro de rollback** (Astra prepara la lista, Juan la ejecuta) a partir de
  `deploy/README.md` y `.github/workflows/deploy.yml`.

## Fuera de este programa (decidido)

Fases 12 (luz dinámica), 12.5 (minimapa), 13 (Spotify), 22 (jefes N×N), 27 (homebrew
elemental), 10 (modo presencial); balance dinámico, táctica avanzada y ciclo de reintento
del director automático; economía, tiendas, misiones, diario, objetos mágicos, XP,
multiclase, dotes; G2–G6 de la miniatura; inspiración y tirar con dados físicos (anotados
en el backlog el 23-sep-2026). Aportan realismo, pero primero se pule el gameplay.
