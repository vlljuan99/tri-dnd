# Rebanada vertical 1 — «Del equipo inicial al primer nivel ganado»

**Rebanada COMPLETADA y desplegada** (fases A, B, E, C, D y F). Sustituyó a «implementar
veinte sistemas a medias»: la prioridad era **una rebanada jugable de extremo a extremo**
que demostrara que las abstracciones centrales funcionan juntas, y el recorrido de la §1
ya funciona entero en la beta.

Este documento se conserva como registro del alcance acordado, los criterios de
aceptación y —sobre todo— la **tabla de deuda técnica de la §6**, que es lo que sigue
vivo: lo pagado está tachado y lo que queda es material para las siguientes rebanadas.

- Visión y backlog arquitectónico: [ARQUITECTURA.md](ARQUITECTURA.md)
- Estado e historial del proyecto: [../ROADMAP.md](../ROADMAP.md)

> **Regla de esta rebanada**: si algo no aparece en «Dentro del alcance», no se
> implementa aunque quede a mano. Lo que se descubra por el camino se anota en el
> backlog arquitectónico, no se cuela en la fase.

---

## 1. El flujo que debe funcionar

| # | Paso | Fase |
| --- | --- | --- |
| 1-2 | El DM crea una campaña y configura nombre, nivel inicial, milestone y reloj on/off | D (nivel) · F (reloj) |
| 3 | Un jugador entra en la campaña | ya funciona |
| 4 | Crea un personaje con el asistente | ya funciona |
| 5-6 | Recibe las opciones correctas de equipo inicial y elige | **A** |
| 7 | Se calculan CA, competencias, ataques y slots de equipo | **A** + **B** |
| 8 | El personaje entra en un mapa | ya funciona |
| 9 | Interactúa con al menos un objeto sencillo del mundo | ya funciona (`InteractPanel`) |
| 10-11 | Saquea un cofre y el objeto entra **de verdad** en su inventario | **E** |
| 12 | Lo equipa si es válido | **A** + **E** |
| 13-15 | Entra en combate, iniciativa, mover / atacar / recibir daño / usar un recurso / terminar turno | ya funciona |
| 16 | Competencia y equipamiento afectan correctamente al ataque | **B** |
| 17 | Recibe al menos una condición básica | ya funciona |
| 18 | Termina el combate | ya funciona |
| 19 | Realiza un descanso | **F** |
| 20-21 | Con reloj activado el descanso avanza el tiempo; sin reloj funciona igual | **F** |
| 22 | El DM concede un nivel por milestone | **D** |
| 23-24 | El jugador sube de nivel: PG, rasgos, competencia y progresión de conjuros | **C** + **D** |
| 25 | Todo persiste al salir y volver a entrar | transversal |

Los seis cortes están hechos: cada fila de la tabla funciona en la beta desplegada.

---

## 2. Alcance de validación

Subconjunto deliberadamente pequeño para que la rebanada sea viable. **La arquitectura
no puede quedar acoplada a estos ejemplos**: son los casos que se prueban, no los casos
que se soportan.

- **Personajes**: un marcial (guerrero) y un lanzador (mago o clérigo), nivel 1 → 2.
- **Armas**: daga (simple, sutil, arrojadiza), espada larga (marcial, versátil),
  espadón (marcial, a dos manos), arco corto (a distancia) y el golpe desarmado.
- **Armaduras**: cuero (ligera), cota de escamas (media, tope de DES +2), cota de malla
  (pesada, sin DES, requisito de FUE) y escudo.
- **Condiciones**: las que ya existen; basta con que una se aplique y afecte.
- **Mundo**: un cofre, un encuentro, descanso corto y largo, una subida de nivel.

---

## 3. Fuera del alcance (explícito)

Tiendas y economía · crafting · reputación · sistema de misiones · diario/timeline ·
automatizaciones y motor de disparadores · calendario avanzado y viajes con tiempo ·
servicios mágicos y aprendizaje de conjuros · objetos mágicos (rareza, sintonización,
cargas, identificación) · iluminación dinámica y niebla por visión avanzada ·
interactivos genéricos (solo el mínimo del cofre) · NPCs como entidad propia ·
multiclase · dotes · trasfondos con mecánica · XP · munición consumible · reglas de CA
sin armadura (monje/bárbaro) · cobertura · todas las clases y todos los objetos.

Todo eso vive en el backlog de [ARQUITECTURA.md](ARQUITECTURA.md).

---

## 4. Las seis fases

### Fase A — Equipo inicial guiado y slots de equipamiento

**Qué entra**

- Paso **Equipo** en el asistente de personaje, entre Competencias y Resumen,
  construido con `starting_equipment` y `starting_equipment_options` de la clase
  (opciones del manual: «(a) cota de malla o (b) armadura de cuero, arco largo y 20
  flechas», incluidas las de tipo «elige un arma marcial de esa categoría»).
- **Inventario separado del equipamiento**: `equipped: bool` desaparece como concepto y
  entra un `slot` real — `mano-principal`, `mano-secundaria`, `armadura`, `escudo`, o
  `null` (mochila).
- Validación de empuñadura: a dos manos ocupa las dos, escudo ocupa la secundaria,
  versátil usa el dado mayor solo si la secundaria está libre, no se equipan dos
  armaduras.
- **La armadura equipada determina la CA** (`armor_class {base, dex_bonus, max_bonus}`
  del SRD) + escudo. Sin armadura, 10 + DES como hasta ahora.
- El hotbar del tablero solo muestra lo realmente empuñado.

**Decisiones tomadas**

- Las opciones del manual son el único camino de la primera versión: nada de oro
  inicial ni de compra libre (fuera de alcance, ver §3).
- `characters.ac` se conserva como columna pero pasa a ser **derivada**; se añade un
  `ac_override` (NULL = derivada) para los casos que las reglas aún no cubren, que
  seguirá siendo del DM.
- La compatibilidad se resuelve con **migración de datos** (normalizar los inventarios
  existentes), no con lectura retrocompatible perpetua.
- La munición no se consume todavía: el arco funciona sin contar flechas.

**Código que cambia**

- Servidor: `db.js` (migración: forma del inventario + `ac_override`),
  `routes/characters.js` (validación real de la forma del inventario, hoy es
  `Array.isArray` y poco más), `sockets.js` → `characterWeapon()` filtra hoy por
  `candidate.equipped`, `services/loot.js` (alta de objeto con la forma nueva).
- Cliente: `components/wizard/StepEquipo.jsx` (nuevo), `lib/wizard.js` (parser de
  opciones de equipo), `pages/CharacterWizardPage.jsx` (paso nuevo y `finish()`),
  `pages/CharacterSheetPage.jsx` (`addItem`, `updateItem`, sección de equipo),
  `features/tactical-map/domain/weaponSlots.js`, `hooks/useCharacterWeapons.js`,
  `components/InventoryPanel.jsx`, `components/AttackPanel.jsx`, `StepResumen.jsx`.
- Nuevo módulo de reglas de equipo compartido (servidor autoritativo + espejo cliente).

**Criterios de aceptación**

1. Un guerrero recién creado sale del asistente con las opciones del manual aplicadas y
   con su equipo en los slots correctos.
2. Equipar un espadón libera/bloquea la mano secundaria; un escudo no convive con él.
3. La CA que muestra la ficha coincide con la armadura equipada y su tope de DES, y
   cambia al equipar y desequipar.
4. El hotbar del tablero muestra exactamente las armas empuñadas (más el desarmado).
5. Un personaje creado **antes** de esta fase sigue funcionando: su arma equipada acaba
   en la mano principal y su ficha no pierde objetos.

---

### Fase B — Competencias reales

**Qué entra**

- Set efectivo de competencias derivado de clase + raza + otras fuentes existentes
  (contenido propio del DM incluido), **persistido en la ficha** para que el servidor
  valide sin volver a resolver la fuente SRD.
- Un arma no competente **no suma el bonificador de competencia** al ataque, en cliente
  y en servidor.
- Armadura sin competencia (regla 2014): desventaja en pruebas, salvaciones y ataques de
  FUE y DES, y no se pueden lanzar conjuros.
- La ficha y el panel de ataque lo explican; equipar sigue permitido, lo que cambia es
  el resultado.

**Código que cambia**

- Nuevo `server/src/rules/` con `abilityModifier`, `proficiencyBonus` y competencias —
  **consolidando las cinco copias actuales** (`lib/dnd.js`, `concentration.js`,
  `opportunityAttacks.js`, `perception.js`, `turnEconomy.js`).
- `client/src/lib/dnd.js` → `weaponAttackBonus` deja de presuponer competencia.
- `sockets.js` (resolución de ataque), `services/opportunityAttacks.js`,
  `services/combatRules.js`.
- `db.js` (migración: competencias efectivas en `characters`),
  `components/wizard/StepCompetencias.jsx`, `pages/CharacterSheetPage.jsx`.

**Criterios de aceptación**

1. Un mago con espada larga ataca **sin** bonificador de competencia; con daga, **con**.
2. El número que enseña el panel de ataque y el que valida el servidor coinciden en
   ambos casos (una prueba por camino).
3. Un guerrero con cota de malla no sufre penalización; un mago con la misma armadura sí,
   y no puede lanzar conjuros mientras la lleve.
4. `abilityModifier` y `proficiencyBonus` tienen **una sola definición** en el servidor.

---

### Fase C — Sincronización completa de la progresión de clase

**Qué entra**

- Ampliar `server/scripts/sync-srd.js` con `/api/2014/classes/{index}/levels`, que hoy
  llega como una URL sin expandir dentro del `data` de la clase.
- Normalizar por clase y nivel lo necesario para progresar: rasgos, bonificador de
  competencia, mejoras de característica, espacios de conjuro, trucos conocidos,
  conjuros conocidos y recursos de clase que el SRD publique.
- Ruta de lectura para el cliente y servicio de progresión en el servidor.

**Decisiones tomadas**

- Esta fase va **antes** del level-up para no escribir reglas temporales (tabla fija de
  4/8/12/16/19, espacios de conjuro a mano) que luego haya que rehacer.
- Es una fase **sin interfaz**: solo datos, servicio y pruebas. Se acepta que no se vea
  nada en pantalla al terminarla.
- Las 407 entradas de `features` ya sincronizadas (con `level` y `class`) siguen siendo
  la fuente de los rasgos; los niveles de clase aportan la progresión numérica.

**Código que cambia**

- `server/scripts/sync-srd.js`, `server/src/services/srdShape.js` (categoría nueva:
  cuidado, `SRD_CATEGORIES` alimenta también el buscador y el índice FTS),
  `server/src/routes/srd.js`, nuevo `services/classProgression.js`.

**Criterios de aceptación**

1. `npm run sync-srd` deja en la base la progresión de las 12 clases del SRD y es
   re-ejecutable sin duplicar.
2. Consultar «mago, nivel 3» devuelve sus espacios (4/2), sus trucos y sus rasgos.
3. El buscador de compendio y el índice FTS siguen funcionando igual que antes.

---

### Fase D — Nivel concedido por el DM (milestone)

**Qué entra**

- La campaña tiene **nivel inicial** y **nivel concedido**; el modo por defecto es
  milestone.
- El asistente deja de pedir el nivel como número libre: lo toma de la campaña y lo
  explica (sin campaña, nivel 1).
- En la ficha desaparece el campo de nivel editable para PJ; entra **«Subir de nivel»**,
  habilitado solo si el DM ya concedió ese nivel.
- Botón del DM «conceder nivel al grupo» + aviso por socket a los conectados.
- Mini-asistente de subida: PG, rasgos nuevos, mejora de característica cuando toca,
  espacios de conjuro y conjuros conocidos/preparados según la clase, recursos derivados.
- **Histórico de subidas** por personaje.

**Decisiones tomadas**

- **PG**: el jugador elige entre valor fijo (por defecto) y tirada del dado de golpe.
- **Enemigos, jefes y PNJ del DM conservan el nivel libre** (`characters.kind='boss'`,
  `dm_category`); el bloqueo aplica solo a `kind='pj'`.
- **Escaramuzas**: el nivel recomendado del escenario se usa como nivel inicial; un PJ
  que ya existe entra con el suyo y no se recalcula.
- **XP fuera**: puede llegar después como modo alternativo, no es prioridad.
- Las dotes quedan fuera: la mejora de característica es lo único que se aplica.

**Código que cambia**

- `db.js` (migración: nivel inicial/concedido y modo en `campaigns`, histórico de
  subidas, dados de golpe del personaje), `routes/campaigns.js` (conceder nivel),
  `routes/characters.js` (`level` sale de los campos escribibles para PJ; ruta nueva de
  subida), `sockets.js` (aviso), `services/skirmishes.js` (nivel del escenario).
- Cliente: `components/wizard/StepIdentidad.jsx` (nivel bloqueado y explicado),
  `pages/CharacterSheetPage.jsx` (fuera el `NumberField` de nivel, dentro el botón),
  mini-asistente nuevo, y la sección de campaña del DM.

**Criterios de aceptación**

1. Un jugador no puede cambiar su nivel por ningún camino de la API.
2. El DM concede nivel 2 y los jugadores conectados lo ven sin recargar.
3. Al subir, un guerrero gana PG coherentes con su dado de golpe y CON, y su
   bonificador de competencia se recalcula solo donde toca.
4. Un mago que sube a nivel 2 gana el espacio de conjuro que le corresponde.
5. Un jefe del DM sigue teniendo el nivel editable a mano.

---

### Fase E — Cofre y transferencia real de objetos

**Qué entra**

- Cofre colocable por el DM con contenido, saqueable desde la mesa.
- **Transferencia transaccional en servidor**: el objeto sale del contenedor y entra en
  la ficha en la misma operación. Nunca se duplica ni se pierde.
- El arma saqueada llega con sus datos de ataque (hoy entra como nombre suelto — ya
  estaba anotado como pendiente en la Fase 20 del roadmap) y se puede equipar.

**Decisión de acotación**

No se migra todavía el inventario a tablas de contenedores. La rebanada exige
*transferencia real sin duplicación*, y eso se consigue con un único endpoint
transaccional; el modelo completo de contenedores (cadáveres, mercaderes, contenedor
compartido, suelo) es backlog. **Lo que sí se prohíbe desde ya**: que una transferencia
se resuelva enviando el inventario entero desde el cliente.

**Código que cambia**

- `services/loot.js` (`lootMarkerInto` como única puerta de entrada de objetos),
  `routes/maps.js` / `routes/campaigns.js` (cofre con contenido en el editor),
  `components/InteractPanel.jsx`, `InventoryPanel.jsx`.

**Criterios de aceptación**

1. Saquear un cofre con una espada larga la deja en la mochila con sus datos de arma, y
   se puede equipar sin volver a buscarla en el compendio.
2. Dos saqueos simultáneos del mismo cofre no duplican el objeto.
3. El cofre vacío deja de ofrecer saqueo.

---

### Fase F — Descanso corto y largo, y reloj de campaña opcional

**Qué entra**

- **Descanso corto**: gastar dados de golpe para curar; recuperar los recursos que el
  SRD devuelve en descanso corto.
- **Descanso largo**: PG al máximo, mitad de los dados de golpe, espacios de conjuro y
  recursos.
- **Reloj de campaña como capacidad opcional**: se elige al crear la campaña y el DM
  puede cambiarlo después. Encendido, el descanso corto avanza 1 h y el largo 8 h;
  apagado, no aparece ningún control de reloj y el descanso funciona exactamente igual.

**Decisiones tomadas**

- El reloj **extiende** el contador de jornadas que ya existe (`campaigns.elapsed_days`,
  migración v52, que hoy avanza con las rutas del mapa de mundo). No se crea un segundo
  reloj y el comportamiento actual de viaje no cambia.
- Activarlo o desactivarlo a mitad de campaña no rompe nada: al encenderlo la hora
  arranca en un valor por defecto, al apagarlo el valor se conserva pero deja de verse.
- Ninguna regla depende del reloj: las duraciones siguen contándose en rondas.

**Código que cambia**

- `db.js` (migración: dados de golpe gastados, `clock_enabled` y minutos del día),
  `routes/campaigns.js` (descanso y ajuste del reloj), `services/turnEconomy.js`
  (recursos), `sockets.js` (aviso a la mesa), asistente de creación de campaña y panel
  de gestión, HUD de la mesa.

**Criterios de aceptación**

1. Un descanso largo devuelve PG, dados de golpe y espacios de conjuro correctos.
2. Con el reloj activado, un descanso largo avanza 8 h y cruza de día cuando toca.
3. Con el reloj desactivado, el mismo descanso funciona y **no aparece ningún control de
   reloj** en la interfaz.
4. Cambiar el interruptor a mitad de campaña no rompe el estado existente.

---

## 5. Dependencias y orden recomendado

```
A (equipo y slots) ──▶ B (competencias) ──▶ E (cofre)
                                    │
C (progresión SRD) ──▶ D (level-up) ─┴──▶ F (descansos + reloj)
```

**Orden recomendado: A → B → E → C → D → F.**

- **A primero** porque casi todo lo demás toca el inventario: hacerlo después obligaría a
  migrar dos veces.
- **B pegado a A**: comparten el módulo de reglas de equipo y el mismo camino de ataque.
- **E después de B** porque es corto y es el primer momento en que la rebanada se
  demuestra entera en la mesa: saqueo → inventario → equipar → atacar con el número
  correcto.
- **C antes que D**, sin excepción: es la fase que evita reglas temporales.
- **F al final** porque necesita los espacios de conjuro de C y cierra el bucle jugable.

Cada fase se cierra confirmando con el usuario antes de empezar la siguiente, como el
resto del proyecto.

---

## 6. Deuda técnica y conflictos con este diseño

Detectado al revisar el repositorio. Cada punto dice dónde está y qué fase lo paga.

| # | Deuda / conflicto | Dónde | Se paga en |
| --- | --- | --- | --- |
| 1 | `equipped: bool` está asumido en cliente **y** servidor; el servidor filtra el arma por ese campo | `sockets.js` (`characterWeapon`), `weaponSlots.js`, ficha, `InventoryPanel` | A |
| 2 | El inventario es JSON casi sin validar (`Array.isArray` + límite de tamaño) | `routes/characters.js` | A |
| 3 | El ataque **presupone competencia siempre** | `lib/dnd.js` (`weaponAttackBonus`), `opportunityAttacks.js` | B |
| 4 | `abilityModifier` / `proficiencyBonus` duplicados en cinco archivos | `lib/dnd.js`, `concentration.js`, `opportunityAttacks.js`, `perception.js`, `turnEconomy.js` | B |
| 5 | La CA es un entero editable calculado **una sola vez** al terminar el asistente (10 + DES); la armadura del inventario no hace nada | `CharacterWizardPage.finish()`, ficha | A |
| 6 | `characters.spells.slots` existe en el modelo y **nadie lo consume**: los conjuros se lanzan sin límite | modelo + `sockets.js` | C → D → F |
| 7 | No existen descansos ni dados de golpe en ninguna parte | — | F |
| 8 | La progresión de clase (`class_levels`) llega como URL sin expandir: no hay espacios de conjuro ni mejoras por nivel | `sync-srd.js` | ~~C~~ pagada (tabla propia `class_levels`, v71, en vez de categoría nueva del compendio: ver riesgo 5) |
| 9 | El nivel es libre y editable, y cambiarlo no cambia nada salvo el bonificador de competencia | `StepIdentidad.jsx`, `CharacterSheetPage.jsx:510`, `routes/characters.js` | ~~D~~ pagada |
| 10 | El botín entra en el inventario **sin datos de arma** | `services/loot.js` | ~~E~~ pagada |
| 11 | El cliente hace `PUT` del **inventario completo**: con contenedores y comercio es duplicación o pérdida garantizada | ficha + `routes/characters.js` | A (forma) / E (transferencias) |
| 12 | `PUT /characters/:id` acepta campos derivados (CA, PG máximos, nivel) escritos por el cliente | `routes/characters.js` | A, B, D |
| 13 | `characters` mezcla PJ, jefes y PNJ; toda regla nueva debe distinguir `kind`/`dm_category` | modelo | D (y refuerza «NPC ligero» del backlog) |
| 14 | Los escenarios de fábrica declaran nivel recomendado en texto y vinculan un PJ existente | `services/skirmishPresets.js`, `skirmishes.js` | ~~D~~ pagada (`suggestedLevelFloor` lee el extremo bajo; el PJ que ya existe no se recalcula) |
| 15 | Regla de `CLAUDE.md` ya matizada por la Fase 26 («los rasgos de clase son texto libre») | `CLAUDE.md`, `AGENTS.md` | ya corregida en esta tarea |
| 16 | **Categorías de equipo y competencias sin traducir**: el asistente enseñaba «Martial Weapons», «All armor», «Simple Weapons» en inglés | `server/data/translations/es.json` + `npm run sync-srd` | **pagada**: 39 categorías y 117 competencias traducidas y resincronizadas; el paso de Competencias las pide al compendio en vez de leerlas del `data` inglés de la clase |
| 17 | **La migración v70 borraba la tabla `characters`**: el próximo despliegue al VPS se habría llevado por delante las fichas jugadas de la beta | `server/src/db.js` (v70) | **pagada**: ahora deriva la competencia de cada ficha desde su clase en vez de borrarlas, con prueba sobre base temporal (`migrations.test.js`) |
| 18 | La desventaja por armadura sin competencia solo llegaba a los ataques con arma y a lanzar conjuros | `rules/proficiency.js`, ficha | **pagada**: `armorPenaltyAppliesTo` cubre pruebas, salvaciones y habilidades de FUE/DES en la ficha y en las salvaciones ambientales del servidor (zonas de peligro y fluidos) |
| 19 | **Nada consume espacios de conjuro ni recursos de clase**: el descanso los restaura sin que nadie los haya gastado, y por eso la Fase F no pudo devolver recursos de clase | `characters.spells.slotsUsed`, lanzar conjuros en `sockets.js` | siguiente rebanada: es el hueco más visible del bucle |
| 20 | El compendio tiene categorías enteras sin traducir (rasgos, dotes, objetos mágicos, trasfondos): se enseñan en inglés con etiqueta «EN» | `server/data/translations/es.json` | traducción por lotes, pendiente |

---

## 7. Riesgos arquitectónicos

1. **Dos motores de reglas divergiendo.** Cliente y servidor calculan por separado; la
   competencia real es el primer sitio donde una divergencia cambia un número que el
   jugador ve. Mitigación: un solo módulo de reglas en el servidor como autoridad, con el
   espejo cliente probado contra los mismos casos.
2. **El inventario como JSON libre.** Es el cuello de botella de todo lo que viene
   (contenedores, economía, objetos mágicos). Mitigación: forma validada en la Fase A y
   transferencias solo por endpoint transaccional.
3. **Capacidades opcionales que se vuelven obligatorias.** Si una regla asume reloj, la
   campaña sin reloj se rompe. Mitigación: la invariante 7 de
   [ARQUITECTURA.md](ARQUITECTURA.md) y contar duraciones en rondas.
4. **Interactivos pegados al tablero.** `InteractPanel` habla hoy directamente con
   marcadores del mapa; si el cofre de la Fase E se construye así, el mercader del mundo
   no podrá reutilizarlo. Mitigación: la interacción se resuelve en servidor y el panel
   solo pinta el resultado.
5. **La ampliación del SRD toca el buscador.** `SRD_CATEGORIES` alimenta sincronización,
   rutas, buscador transversal y el índice FTS: añadir la progresión de clase sin cuidado
   puede ensuciar los resultados de búsqueda.
6. **Migrar inventarios de personajes reales.** Ya hay fichas jugadas en la beta. La
   migración de datos de la Fase A debe ser conservadora: ante la duda, a la mochila.
