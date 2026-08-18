# Rebanada vertical 2 — «Mi miniatura: del creador 3D a la mesa»

Diseño de arquitectura del **Character Creator 3D propio** y de la **miniatura de tabletop
personalizable**: una figura low-poly sobre peana, creada dentro de la app, que es **la misma
representación** en el creador, la ficha, el visor ampliado, el mapa táctico y el retrato 2D.

Este documento **define la arquitectura y planifica la rebanada**. No implementa nada.

- Visión y backlog arquitectónico: [ARQUITECTURA.md](ARQUITECTURA.md)
- Rebanada vertical **1** (reglas/equipo): [VERTICAL-SLICE.md](VERTICAL-SLICE.md)
- Estado e historial: [../ROADMAP.md](../ROADMAP.md)

> **Regla de esta rebanada**: rendimiento por encima de fidelidad visual. Si mantener 60 FPS
> exige bajar calidad, se baja. Ver §7.

---

## 0. Estado real del stack 3D (verificado en el repositorio)

Punto de partida honesto, comprobado archivo por archivo. **Nada de esto es suposición.**

| Pregunta | Respuesta verificada |
| --- | --- |
| ¿Motor 3D? | **`three@^0.185.1` + `@react-three/fiber@^9.6.1`**. Nada de Babylon (y no se introduce). |
| ¿Existe `@react-three/drei`? | **NO.** Solo `fiber` está instalado (`client/node_modules/@react-three/`). |
| ¿`gltfjsx`, Draco, Meshopt, KTX2? | **NO.** Ninguno. |
| ¿Cómo se cargan GLB hoy? | **No se cargan.** No existe `GLTFLoader`, `useGLTF` ni ningún `.glb` en el proyecto. Lo único que se carga es **textura 2D**: `useLoader(THREE.TextureLoader, imageUrl)` en `TokenIcon.jsx`. |
| ¿Cómo se gestionan animaciones? | **No hay sistema de animación.** Cero `AnimationMixer`, cero `useAnimations`, cero clips. Todo el movimiento actual es **imperativo en `useFrame`** (lerp de posición, pulsos de opacidad, `THREE.MathUtils.lerp`). |
| ¿`SkinnedMesh` / `SkeletonUtils`? | **NO existen** en el proyecto. Todo son mallas estáticas procedurales. |
| ¿Cómo se representa un personaje en el mapa? | `MapToken.jsx`: **cilindro procedural (peana) + aro + retrato 2D** (`TokenIcon`, textura de `avatar_path`) + overlays. |
| ¿Cámaras? | `TacticalCamera.jsx` — cámara cenital **hecha a mano** (el propio comentario dice que `makeDefault` «es una convención de drei, no de fiber puro»). |
| ¿Luces? | `TacticalMapCanvas.jsx`: un `ambientLight` + un `directionalLight` (intensidades vía `sceneLighting()`), más `pointLight` por antorcha en `MapFloor`. |
| ¿Canvas? | `dpr={[1, 1.5]}`, `frameloop="always"`, `antialias`, `powerPreference: 'high-performance'`. |
| ¿Disposal? | **Patrón ya establecido y correcto**: `useEffect(() => () => x.dispose(), [x])` en 4 sitios (`MapFloor` ×2, `MapToken`, `TokenLabel`). |
| ¿Caching de assets? | **No existe** cache propio; solo el cache implícito de `useLoader`. |
| ¿Especies del wizard? | Las **9** del SRD, exactamente las pedidas: dragonborn, dwarf, elf, gnome, half-elf, half-orc, halfling, human, tiefling. |
| ¿Inventario/equipamiento? | **Fase A cerrada**: `inventory[].slot` real (`mano-principal`, `mano-secundaria`, `armadura`, `escudo`, `null`), validación de dos manos y CA derivada. Es la fuente de verdad del equipo. |
| ¿Modelo persistido de personaje? | `characters`: `abilities`, `hp_*`, `ac`, `speed`, `*_proficiencies`, `inventory`, `spells`, `features`, `notes`, **`avatar_path`**. **No hay ningún campo de apariencia.** |

**Conclusión**: se reutiliza mucho (escena, cámara, luces, peana, overlays, patrón de disposal),
pero **todo el pipeline de personajes skinned —loader GLB, rig, animación, cache, LOD— es
nuevo**. Es la parte cara de esta rebanada y hay que dimensionarla como tal.

---

## 1. Qué se reutiliza tal cual (componentes R3F existentes)

El encargo describe cosas que **ya están construidas**. No se rehacen:

| Concepto | Ya existe en | Uso en la miniatura |
| --- | --- | --- |
| Peana circular + aro | `MapToken.jsx` (cylinderGeometry) | Base de `MiniatureBase` (§5) |
| Estado *seleccionado* | `SelectionIndicator.jsx` | `GameplayOverlay` (§6) |
| Estado *turno actual* | `TurnIndicator` (aro pulsante, `MapToken`) | `GameplayOverlay` |
| Estado *objetivo/alcance* | `RangeIndicator` (`MapToken`) | `GameplayOverlay` |
| Estado *caído/muerto* | disco volcado + `GraveCross` + velo gris | `GameplayOverlay` + animación `downed`/`death` |
| Aliado/hostil | color del disco (`token.color`) | `GameplayOverlay` |
| Feedback de daño (*hit*) | `flashRef` + `FloatingCombatText` | animación `hit` + overlay existente |
| Barra de vida / etiqueta | `HpBar`, `TokenLabel.jsx` | sin cambios |
| Cámara cenital | `TacticalCamera.jsx` | referencia para la cámara del creador |
| Luces de escena | `sceneLighting()` en `TacticalMapCanvas` | referencia para la escena mínima |
| Carga de textura | `useLoader` en `TokenIcon` | mismo patrón, ahora con GLTF |
| Disposal | `useEffect` cleanup ×4 | patrón obligatorio, extendido en §7.6 |

**Lo verdaderamente nuevo**: `GLTFLoader` + cache, `SkinnedMesh` + `SkeletonUtils.clone`,
`AnimationMixer`, LOD, atlas/paletas de material, thumbnails, portrait offscreen.

---

## 2. Separación de responsabilidades (invariantes nuevas)

```
Rules Engine        ── ¿qué PUEDE hacer/equipar?        (servidor, autoridad)
Inventory/Equipment ── ¿qué POSEE y qué USA?  (slots)   (servidor, autoridad)
Appearance          ── ¿cómo ES físicamente?            (elección cosmética del jugador)
CharacterVisual     ── ¿cómo REPRESENTAMOS ambas?       (dominio puro, sin three)
R3F Renderer        ── ¿cómo lo DIBUJAMOS?              (three + fiber)
```

Reglas duras, que extienden las invariantes de [ARQUITECTURA.md](ARQUITECTURA.md) §3:

- **VIS-1** — El estado visual **nunca** es fuente de verdad de gameplay. La apariencia no da
  estadísticas; el equipo visual **lee** el inventario, jamás lo escribe.
- **VIS-2** — **Ninguna regla depende de que exista un asset.** Sin modelo, el objeto se equipa
  y funciona igual (§4.3). La biblioteca visual y el gameplay crecen por separado.
- **VIS-3** — La resolución visual es **dominio puro**: `(appearance, equipment, context) →
  VisualSpec`, sin three.js, testeable sin Canvas.
- **VIS-4** — Los estados de gameplay se pintan como **overlays desde three.js**, nunca dentro
  del GLB (§6).
- **VIS-5** — **`Creature Size` ≠ `Visual Height`.** La rejilla y el tamaño de peana los decide
  el Rules Engine; la altura visual es cosmética y no altera alcance, ocupación ni reglas.
- **VIS-6** — **60 FPS manda.** Ninguna decisión estética puede sostenerse si incumple el
  benchmark de §7.7.
- **VIS-7** — El gameplay **no conoce rutas de GLB**. Todo paso de «objeto» a «asset» ocurre en
  el `VisualAssetRegistry` (§4.2).

---

## 3. Estilo artístico y especies

### 3.1 Estilo
**Low-poly fantasy estilizado**, inspirado en la *legibilidad* de Project Zomboid: silueta
clara, lectura a distancia, pocos materiales, geometría contenida, color limpio. **No** realismo,
**no** detalle facial fino. El rendimiento web es prioritario.

### 3.2 Sin caras detalladas (decisión firme)
**No habrá editor de caras.** Nada de morph targets faciales, sliders de nariz/mandíbula/ojos ni
musculatura continua. El rostro es simple. **No se invierte geometría ni textura en la cara.**

La identidad viene de: especie · silueta · cuerpo · altura · complexión · piel · pelo · barba ·
cuernos/orejas/cola · equipamiento · ropa base · peana.

### 3.3 Las 9 especies (coinciden con el wizard actual — no se toca ninguna)

Reconocibles por **silueta, proporción y rasgos estructurales**, nunca por textura o cara:

| Especie | Firma visual | BodyFamily |
| --- | --- | --- |
| Humano | proporciones estándar (referencia) | `standard_humanoid` |
| Elfo | más esbelto, orejas largas | `standard_humanoid` |
| Semielfo | humanoide con rasgos élficos sutiles | `standard_humanoid` |
| Tiefling | cuernos + cola, silueta característica | `standard_humanoid` |
| Semiorco | más grande y robusto, mandíbula/colmillos simplificados | `large_humanoid` |
| Dracónido | cabeza reptiliana, cuerpo robusto, rasgos dracónicos | `draconic_humanoid` |
| Enano | **bajo y ancho**, robusto, torso dominante | `compact_humanoid` |
| Gnomo | **pequeño**, cabeza proporcionalmente mayor, extremidades finas | `compact_humanoid` |
| Mediano | **pequeño pero claramente distinto del gnomo**: proporciones más «humanas» en miniatura, cabeza menor que el gnomo | `compact_humanoid` |

> **Riesgo explícito**: Enano/Gnomo/Mediano comparten `compact_humanoid` y son los tres que
> **deben distinguirse entre sí**. Se resuelve con proporciones de malla distintas (no con
> escala uniforme del mismo cuerpo) y se valida como criterio de aceptación (§10, AC-2).

---

## 4. Modelo de datos y abstracciones

### 4.1 `CharacterAppearance`

Solo cosmética. **Nunca** arma, armadura, escudo, clase, nivel, especie ni stats: eso ya vive en
`characters` y en el inventario con slots. Persistido como JSON.

**Migración** (append-only, invariante 2):

```
ALTER TABLE characters ADD COLUMN appearance TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN portrait_path TEXT;   -- cache 2D derivado (§8)
```

```jsonc
{
  "version": 1,                    // permite migrar la forma sin migrar la columna
  "bodyVariant": "build_sturdy",   // complexión (preset)
  "visualHeightPreset": "medium",  // altura cosmética — NO Creature Size (VIS-5)
  "skinTone": "skin_03",
  "hair": "hair_long_02",
  "hairColor": "brown_dark",
  "beard": null,
  "beardColor": null,
  "speciesVisualOptions": {        // rasgos estructurales de la especie
    "horns": "horns_curved_01",    // tiefling
    "tail":  "tail_default",
    "ears":  "ears_long",
    "scales": "scales_bronze"      // dracónido
  },
  "clothingPreset": "viajero",     // ropa base cosmética (§4.5)
  "baseStyle": "round_stone",
  "baseColor": null,
  "baseEmblem": null,
  "presentationPose": "idle_neutral",
  "helmetVisibility": { "portrait": true, "sheet": true, "tactical": true }
}
```

- **Todo opcional**: `{}` produce una miniatura por defecto válida para cualquier especie.
- **Validación en servidor contra el registry**: la apariencia **sí** la escribe el cliente (es
  una elección del jugador, no un campo derivado — la invariante 5 no aplica), pero el servidor
  **solo acepta ids que existan** y que sean **compatibles con la especie**; lo demás cae al
  defecto. Nunca se confía en el cliente para *qué existe*.
- **La especie NO está aquí**: vive en `characters.race_index` y **no es editable
  cosméticamente** después de crear el personaje (§4.6).

### 4.2 `VisualAssetRegistry`

Registro desacoplado: única frontera entre «concepto de juego» y «archivo». **VIS-7**.

```
VisualAssetRegistry
├── species    ├── bodies   ├── hair    ├── beards  ├── horns
├── tails      ├── armor    ├── weapons ├── shields
├── clothing   └── bases
```

Cada entrada declara lo mínimo para montarla y para elegir LOD:

```jsonc
"longsword": {
  "model":  "generic_longsword.glb",
  "socket": "hand_r",
  "stowedSocket": "hip_l",
  "lod": { "0": "…_lod0.glb", "1": "…_lod1.glb" },
  "material": "steel",
  "bodyFamilies": ["all"]
}
```

El gameplay pide *«espada larga»*; el registry decide el archivo. Cambiar assets no toca código
de reglas. **Un objeto = una entrada**, aunque internamente monte varias piezas (§4.4).

### 4.3 Política de fallback (obligatoria, global)

```
Asset exacto  →  Asset por categoría  →  Asset genérico  →  No mostrar
```

Ejemplo: *Lengua de Fuego* → sin modelo propio → categoría `longsword` → `generic_longsword.glb`.
Y si tampoco hubiera, no se muestra nada empuñado.

> **Regla dura (VIS-2)**: nunca se bloquea, degrada ni altera el gameplay por falta de asset.
> Un objeto invisible se equipa, se usa y calcula igual.

Se aplica también a compatibilidad corporal: `asset exacto → variante de BodyFamily → genérico
compatible → ocultar`.

### 4.4 `BodyFamily` — capa de compatibilidad

Evita una versión de cada prenda por especie:

```
BodyFamily
├── standard_humanoid   (humano, elfo, semielfo, tiefling)
├── compact_humanoid    (enano, gnomo, mediano)
├── large_humanoid      (semiorco)
└── draconic_humanoid   (dracónido)
```

Ropa, armaduras y animaciones se autorizan **por familia**, no por especie. La lista es una
propuesta de partida y **se ajustará al analizar los assets reales** (§9.2): si los cuerpos
elegidos permiten fusionar `large_` en `standard_`, mejor — menos variantes que mantener.

### 4.5 Ropa cosmética vs. equipamiento mecánico

Son cosas distintas. La ropa base (`clothingPreset`) es cosmética y se ve cuando **no** hay
armadura que la tape: *común, túnica, viajero, aventurero, noble básico*. **El equipamiento real
tiene prioridad visual.** Sin sistema de moda, sin outfits guardados, sin accesorios cosméticos
(pendientes, collares, gafas…), sin tatuajes/cicatrices/pinturas — y **el pipeline no se diseña
alrededor de decals** (podrán añadirse más adelante si aportan valor).

### 4.6 Especie no editable cosméticamente

Tras crear el personaje, ni la especie ni su base corporal estructural se cambian desde el editor
cosmético. Sí se cambian pelo, barba, colores, peana, ropa cosmética, pose y opciones visuales
compatibles. El **equipamiento sigue siendo dinámico** siempre.

---

## 5. `CharacterVisual` y `MiniatureBase`

### 5.1 La abstracción central

```
CharacterVisual
├── Appearance        (cosmético, §4.1)
├── Equipment         (inventario con slots — fuente de verdad, Fase A)
├── BodyFamily        (derivado de la especie, §4.4)
├── VisualMappings    (resuelto por el registry, §4.2)
├── AnimationState    (idle / walk / attack / … §6.3)
└── Context           creator | sheet | viewer | tactical | portrait
```

`Context` es lo que permite **un solo renderer** con distinto presupuesto: el contexto decide
LOD, sombras, `frameloop` y si se anima. **No se duplican renderers.**

### 5.2 El renderer común a extraer

```jsx
<CharacterMiniature character={character} context="sheet" />
<CharacterMiniature character={character} context="tactical" lod={1} />
```

`CharacterMiniature` es el componente único que consume un `VisualSpec` y monta cuerpo, piezas,
sockets y animación. Se usa **dentro del `<Canvas>` del tablero** (sustituyendo el `TokenIcon`
plano dentro del `group` de `MapToken`, conservando peana y overlays) **y** dentro del
`MiniatureViewer` de ficha/creador/visor.

### 5.3 `MiniatureBase` (peana) — separada de la figura

Parte permanente de la identidad, pero componente propio:

```
MiniatureBase
├── shape      (MVP: circular)
├── style      (neutra | piedra | dungeon | tierra | madera)
├── color / acento
├── emblema    (opcional)
└── size       ← derivado de Creature Size (VIS-5), NO de la altura visual
```

Sin editor libre de geometría. **Preparado para peanas por campaña** (una campaña podrá ofrecer,
limitar o tematizar estilos: dungeon, bosque, nieve, infernal, arcano) — **fuera del MVP
funcional**, pero el modelo ya lo admite porque el estilo es un id del registry, no geometría
libre.

---

## 6. Estados, overlays y animación

### 6.1 `GameplayOverlay` — separado de `MiniatureBase`

Los estados **nunca** van dentro del GLB (VIS-4). Se pintan desde three.js, reutilizando lo que
ya existe (§1): `selected`, `current turn`, `friendly/hostile`, `targeted`, `downed`, `dead`,
`concentrating`.

### 6.2 Feedback de daño
`hit` como animación + destello breve (ya existe `flashRef`). **No** se implementan heridas
dinámicas, sangre, armadura rota, geometría destruida ni texturas según HP.

### 6.3 Animaciones del MVP

`idle` · `walk` · `attack_melee` · `attack_ranged` · `cast` · `hit` · `downed` · `death` ·
`interact`. **Nada más.**

- **Por arma**: el MVP resuelve solo `attack_melee` / `attack_ranged` / `cast`. La arquitectura
  debe poder **resolver la animación según el arma equipada cuando exista** (`attack_sword`,
  `attack_two_handed`, `attack_bow`, `attack_polearm`…) — es una tabla del registry, no un `if`.
- **Poses de presentación** (ficha y visor, cosmético): `idle_neutral`, `idle_heroic`,
  `idle_relaxed`, `idle_guard`, `idle_caster`. En el tablero, la animación la manda el gameplay.

### 6.4 Decisiones permanentes (nunca se implementan)

- **Sin `lookAt`**, seguimiento de cabeza, eye tracking ni seguimiento de cámara. La mirada solo
  existe dentro de animaciones preparadas.
- **Sin ragdoll** ni físicas de cadáver: al morir, animación `death` y **pose final estable**
  (mejor rendimiento, determinismo y sincronización en multijugador).
- **Sin físicas cosméticas**: nada de cloth, hair physics, capas o barbas simuladas.
- **VFX de conjuros/estados fuera del MVP** (podrán anclarse a peana/personaje más adelante, como
  entidades propias, nunca dentro del modelo base).
- **Voz/sonidos de personaje fuera del MVP**; no condiciona la arquitectura actual.

---

## 7. Rendimiento (prioridad absoluta)

### 7.1 Objetivo
**60 FPS siempre.** `FPS > fidelidad`. La calidad es adaptativa; si hay que bajar, se baja.

### 7.2 Presupuesto de polígonos (orientativo, a la baja si hace falta)

| LOD | Triángulos | Uso |
| --- | --- | --- |
| LOD0 | 20k–30k máx. | creador, ficha, visor ampliado |
| LOD1 | 8k–15k | tablero cercano |
| LOD2 | 2k–5k | tablero medio/lejano |
| — | billboard/portrait | muy lejano o móvil (§8) |

### 7.3 Texturas y materiales
512×512 por defecto; 1024 solo justificado; **KTX2/Basis** cuando el pipeline esté listo.
**Materiales compartidos + paletas de color** en vez de una textura por color:

```
❌ hair_black.png · hair_brown.png · hair_blonde.png …
✅ HairMesh + hairColor  (mismo material, color por instancia)
```

Aplicado a piel, pelo, barba, cuernos, escamas, ropa, metal, cuero, tela y peana. Las especies
pueden tener paleta propia. **Evitar un material distinto por cosmético**; pocos draw calls,
reutilización de geometría y material, batching/instancing cuando sea viable.

### 7.4 Lazy loading (obligatorio)

```
✅ Abrir Creator → cargar SOLO la especie actual → thumbnails 2D → al elegir, cargar ese GLB
❌ Abrir Creator → descargar todos los cuerpos, pelos, armaduras y especies
```

Los selectores usan **thumbnails WebP/AVIF** (PNG si hace falta), **no** miniaturas 3D en
paralelo: **un solo Canvas** para el preview.

### 7.5 Cache
Cache controlado por url de: cuerpos, pelo, materiales, armas genéricas, peanas, **clips de
animación** y assets compartidos. Instanciación con **`SkeletonUtils.clone`** (imprescindible:
`.clone()` normal rompe `SkinnedMesh`).

### 7.6 Disposal
Extiende el patrón ya existente (`useEffect` cleanup). Revisar **geometrías, materiales,
texturas, `AnimationMixer`, escenas GLTF y esqueletos clonados** al: cambiar especie, cambiar
cuerpo, cerrar el creador, cambiar de mapa y cambiar de personaje. **Los recursos cacheados y
compartidos no se liberan por instancia** — solo los clones y lo exclusivo.

### 7.7 Benchmark obligatorio

**No se valida con una sola miniatura.** Escenario de referencia:

```
4 PJ  +  8–12 enemigos  +  escenario 3D  +  animaciones  +  UI táctica   →  60 FPS
```

Si no se sostiene: reducir LOD · polígonos · sombras · texturas · materiales · animaciones
simultáneas · simplificar assets. **No se acepta degradar la fluidez por estética.**

### 7.8 Calidad adaptativa

| Nivel | Sombras | LOD | Texturas |
| --- | --- | --- | --- |
| HIGH | mejores | alto | completas |
| MEDIUM | reducidas | más agresivo | reducidas |
| LOW | mínimas | agresivo | menores + efectos reducidos |

Seleccionable (o automática). Objetivo común en los tres: 60 FPS. Encaja con el `dpr={[1,1.5]}`
que el Canvas ya usa.

### 7.9 Móvil
Viable en móvil, no un añadido: Canvas reducido, menos detalle, LOD, texturas pequeñas, sombras
reducidas, preview optimizado y **UI por secciones**. En la ficha, **portrait 2D por defecto** y
3D bajo demanda. Nunca varios Canvas.

---

## 8. Retrato 2D (`portrait`)

Derivado cacheado, **no** una segunda fuente:

```
CharacterVisual ├── Miniatura 3D (fuente)
                └── Portrait cacheado (derivado)
```

Render offscreen → imagen → `characters.portrait_path`. **Se regenera solo cuando cambia algo
visual relevante** (apariencia, equipo visible, peana). Consumidores baratos: **iniciativa, chat,
lista de party, selector de personaje, cards, notificaciones** y el **LOD más lejano** del token.
Evita abrir múltiples canvas 3D pequeños. Reutiliza la infraestructura de imágenes de
`avatar_path`.

---

## 9. Equipamiento visual

### 9.1 Fuente de verdad única
El equipo visual **se deriva** del inventario con slots (Fase A), **nunca** se guarda en
`CharacterAppearance`:

```
mainHand=longsword · offHand=shield · armor=chain_mail
        │
        ▼  resolveVisual()  (dominio puro, VIS-3)
espada visible · escudo visible · cota de malla visible
```

Cambiar el equipo cambia a la vez gameplay, hotbar, reglas y miniatura: **un solo estado**.

**Visible en el MVP**: armadura, casco, arma principal, arma secundaria, escudo, arco, arma
grande, capa si hay asset. **No prioritario**: anillos, collares, pociones, bolsas, componentes,
monedas, herramientas y objetos pequeños.

### 9.2 Armaduras como módulos skinned (anti-clipping)
Una armadura **no** es una malla puesta encima. Es un módulo `SkinnedMesh` compatible con el
Master Rig que **oculta o sustituye** las partes del cuerpo que cubre:

```
Body: torso · arms · legs · feet
equipar Chain Mail → ocultar/sustituir torso, brazos, piernas → montar piezas de la cota
```

> Para el jugador, **`Chain Mail` sigue siendo UN objeto**. La modularidad es interna: nadie
> viste piezas a mano.

### 9.3 *Wielded* vs. *stowed*
Se distingue empuñado de guardado, y **procede del estado real de equipamiento**:

```
espada+escudo activos → Longsword: hand_r · Shield: hand_l · Longbow: back
cambiar al arco       → Longbow: manos    · Longsword: hip/back · Shield: stowed
```

### 9.4 Assets genéricos (baja prioridad en el MVP)
El equipamiento 3D **no** es la prioridad del MVP: plantillas genéricas
(`generic_longsword`, `generic_greatsword`, `generic_shield`, `generic_leather`, `generic_chain`,
`generic_plate`, `generic_longbow`, `generic_staff`). **No se modela cada objeto del SRD.**

### 9.5 Casco: equipado ≠ visible
El casco puede estar mecánicamente equipado y oculto visualmente
(`helmetVisibility.portrait/sheet/tactical`). **El gameplay nunca cambia por ocultarlo** (VIS-1).

### 9.6 `VisualPreviewOverride`
Capa temporal para previsualizar equipo **sin tocar inventario, slots ni gameplay**:

```
VisualSpec efectivo = resolveVisual(appearance, equipment) ⊕ previewOverride
```

Uso futuro: tienda, botín, crafting, inspección. **No es prioridad del MVP**, pero queda previsto
arquitectónicamente: el resolver acepta el override como argumento, así que añadirlo después no
rediseña nada.

---

## 10. Master Rig, BodyFamily y attachment points

### 10.1 Master Humanoid Rig
Un rig humanoide común para las 9 especies siempre que sea razonable. Compatibles: brazos,
piernas, manos, columna, attachment points y **animaciones**. El dracónido (y quien lo necesite)
añade **extensiones** (cola, etc.), no un rig independiente. **Evitar rigs totalmente separados
salvo necesidad real**: cada rig extra multiplica las animaciones a mantener.

### 10.2 Attachment points (sockets estándar)

```
hand_r · hand_l · head · back · hip_r · hip_l · chest
```

`Longsword→hand_r` · `Shield→hand_l` · `Bow→back` · `Helmet→head`. Montaje como hijo del hueso
por nombre (`skeleton.getBoneByName`); el arma **no** necesita estar skinned. **Sin física en los
attachments.**

> **El contrato estable del proyecto son los nombres de hueso y de socket**, no las mallas. Con
> ese contrato fijo, los assets se pueden sustituir enteros sin tocar código.

### 10.3 Pelo, barba, cuernos, cola
Pelo y barba → mesh intercambiable. Cuernos y orejas → attachment/mesh. Cola → `SkinnedMesh` con
**pocos huesos**. Capa → rígida o animación simple. Accesorios → solo si son equipamiento real.

---

## 11. Pipeline de assets y licencias

### 11.1 Pipeline

```
Asset original → Blender/proceso → normalización → Master Rig → optimizar geometría
→ optimizar materiales → GLB → Meshopt → KTX2 → asset de runtime
                                   └─ (opcional) gltfjsx → componente React
```

**Todo asset registra**: origen, autor, licencia, URL y modificaciones (`CREDITS.md`).

### 11.2 Licencias
Prioridad: **1)** propios · **2)** CC0 · **3)** CC-BY con atribución manejable · **4)** packs
comerciales solo con licencia compatible. **Evitar**: licencias ambiguas, assets bloqueados a
Unity/Unreal y packs sin redistribución web.

**Candidatos a investigar** (sin incorporar nada sin validación previa):
- **Quaternius** — CC0, low-poly, GLTF, rig humanoide, outfits fantasy. El candidato más
  interesante para **cuerpos base**.
- **KayKit** — armas, props, personajes/monstruos auxiliares.

> **Decisión pendiente y bloqueante de G1** (§13): validar licencia y, sobre todo, **si su rig y
> sus proporciones permiten las 9 siluetas** y las BodyFamilies propuestas. Es lo que puede
> obligar a ajustar §4.4.

---

## 12. Arquitectura de módulos y código afectado

```
client/src/features/character-visual/
├── domain/                        # sin three.js, testeable sin Canvas (VIS-3)
│   ├── appearance.js              # esquema, defaults, normalización, validación
│   ├── visualResolver.js          # (appearance, equipment, context, override?) → VisualSpec
│   ├── assetRegistry.js           # VisualAssetRegistry + fallback (§4.2, §4.3)
│   ├── bodyFamily.js              # especie → BodyFamily → compatibilidad
│   ├── species.js                 # rasgos estructurales y opciones por especie
│   ├── presets.js                 # presets por especie + aleatorización válida (§14)
│   └── animation.js               # estado de gameplay → clip (y por arma cuando exista)
├── catalog/  manifest.json        # piezas: id, url, LOD, familia, sockets, especies
├── render/
│   ├── CharacterMiniature.jsx     # renderer ÚNICO (context-aware, LOD)
│   ├── MiniatureViewer.jsx        # <Canvas> mínimo: cámara + luz + órbita limitada
│   ├── MiniatureBase.jsx          # peana (§5.3)
│   ├── GameplayOverlay.jsx        # estados (§6.1) — reutiliza indicadores existentes
│   ├── assetCache.js              # GLTF/material/clip cache + SkeletonUtils.clone
│   ├── quality.js                 # niveles HIGH/MEDIUM/LOW (§7.8)
│   └── portrait.js                # snapshot offscreen (§8)
└── hooks/useCharacterVisual.js
```

| Archivo/área | Cambio | Fase |
| --- | --- | --- |
| `server/src/db.js` | Migración: `appearance` + `portrait_path` | G1 |
| `server/src/routes/characters.js` | Aceptar/validar `appearance` contra registry y especie | G1 |
| `client/src/features/character-visual/**` | **Módulo nuevo** | G1–G6 |
| `client/src/pages/CharacterSheetPage.jsx` | Miniatura (escritorio) / portrait (móvil) + visor | G3 |
| `client/src/pages/CharacterWizardPage.jsx` | Paso `apariencia` en `STEPS` | G2 |
| `client/src/components/wizard/StepApariencia.jsx` | **Nuevo** | G2 |
| `client/src/features/tactical-map/components/MapToken.jsx` | `TokenIcon` → `CharacterMiniature` (LOD), conservando peana y overlays | G4 |
| `client/package.json` | `@react-three/drei` (+ dev: `gltfjsx`) | G1 |

### 12.1 Dependencias

**Ya instaladas**: `three@^0.185.1`, `@react-three/fiber@^9.6.1`.

**Propuesta nueva — `@react-three/drei`** (hoy **no** existe). Aporta exactamente lo que falta:
`useGLTF` (con cache), `useAnimations` (mixer gestionado), `Clone`, `Bounds`, `Center`,
`Environment`, controles de cámara, y arrastra `three-stdlib` con **`GLTFLoader`** y
**`SkeletonUtils`**. Construir todo eso a mano es trabajo puro sin ventaja.
→ **Recomendación: incorporarlo.** Es la única dependencia de runtime nueva.

**`gltfjsx`**: como **herramienta de desarrollo** (dev-dependency o `npx` puntual) para convertir
GLB en componentes; útil, no imprescindible. Adoptar solo si aporta valor real en el pipeline.

**Sin dependencias de servidor nuevas.** Meshopt/KTX2 entran como paso de *build* de assets, no
como dependencia de la app (el decoder correspondiente llega vía `three-stdlib`).

---

## 13. Fases de la rebanada (G1–G6)

> **Precedencia**: la Fase A (slots) **ya está cerrada**, así que no hay bloqueo. Conviene no
> solapar G3/G4 con las fases D y F de la rebanada 1, que tocan ficha y tablero.

- **G1 — Fundamentos.** Migración (`appearance`, `portrait_path`); `domain/` completo (appearance,
  resolver, registry, fallback, bodyFamily) **con tests puros**; `assetCache` + `MiniatureViewer`;
  **una especie** con cuerpo, peana e `idle`. Valida el contrato central y el pipeline GLB.
- **G2 — Creador y paso «Apariencia».** Las **9 especies** con sus siluetas, presets,
  aleatorización, altura/complexión, piel/pelo/barba, rasgos de especie, ropa base, peana y pose.
  Paso nuevo en el wizard entre **Equipo** y **Resumen**, con preview en vivo, thumbnails y lazy
  loading.
- **G3 — Ficha + visor ampliado.** Miniatura en la ficha (escritorio), portrait en móvil, visor 3D
  al pulsarla (rotar, zoom limitado, reset, pose).
- **G4 — Miniatura en el tablero.** `CharacterMiniature` en `MapToken` con LOD y overlays;
  degradación a portrait. **Aquí se ejecuta el benchmark de §7.7 por primera vez.**
- **G5 — Equipamiento visual.** Sockets, armaduras modulares (anti-clipping), *wielded/stowed*,
  fallback, casco visible/oculto. Incluye el caso de aceptación del espadón.
- **G6 — Portrait y pulido de rendimiento.** Portrait cacheado e invalidación; calidad adaptativa
  HIGH/MEDIUM/LOW; cierre del benchmark; auditoría de disposal.

**Orden: G1 → G2 → G3 → G4 → G5 → G6**, confirmando con el usuario entre fases.

> **Nota de dimensionado, sin adornos**: G2 (9 especies con siluetas propias + presets) y G5
> (armaduras modulares por BodyFamily) son, con diferencia, las fases caras, y su coste es
> **mayoritariamente de assets, no de código**. El §11.2 es el que decide si esto dura semanas o
> meses; conviene validar los assets **antes** de comprometer G2.

---

## 14. Aleatorización y presets

- **Aleatorizar** genera **solo combinaciones válidas**: respeta especie, BodyFamily, cuerpo,
  altura, complexión, piel, pelo, barba, colores, ropa base y peana. **Nunca toca equipamiento
  mecánico.**
- **Presets por especie** (p.ej. Enano: Preset 1/2/3 + «Personalizar»): son configuraciones de
  `CharacterAppearance`, **no requieren assets adicionales**, y el jugador puede partir de uno y
  modificarlo.
- **Una sola apariencia activa** por personaje. Sin outfits guardados, sin varios looks, sin
  cambio rápido. Revisable en el futuro.

---

## 15. Flujo de la rebanada y caso de aceptación

```
Crear campaña → crear personaje → especie → apariencia → equipo inicial
→ ver equipo genérico en la miniatura → finalizar → ficha (misma miniatura)
→ cambiar equipamiento (se actualiza) → mapa (misma miniatura + peana) → mover → combatir
```

**Caso principal**: un guerrero de cualquiera de las 9 especies elige cuerpo, altura, complexión,
piel, pelo, barba y peana; equipa **cota de malla + espada larga + escudo** y los ve sobre la
miniatura. Finaliza → la ficha muestra **esa misma** figura → el mapa, también. Cambia a
**espadón**: dejan de estar empuñados espada y escudo, aparece el espadón, **cambian reglas y
hotbar**, y cambia la miniatura — **todo desde el mismo estado de equipamiento**.

### Criterios de aceptación

1. **AC-1** — Un personaje nuevo sale del asistente con apariencia elegida y miniatura sobre peana.
2. **AC-2** — Las 9 especies son reconocibles por silueta, y **enano, gnomo y mediano se
   distinguen entre sí** a distancia de tablero.
3. **AC-3** — La **misma** definición visual se ve en creador, ficha, visor, mapa y portrait.
4. **AC-4** — Cota de malla + espada larga + escudo se ven correctamente y **sin clipping**.
5. **AC-5** — Cambiar a espadón quita espada y escudo empuñados y muestra el espadón, **derivado
   del inventario**, no de la apariencia.
6. **AC-6** — Un objeto sin modelo (p.ej. *Lengua de Fuego*) usa el fallback de categoría, y **se
   puede equipar y usar igual** aunque no se vea nada (VIS-2).
7. **AC-7** — **Benchmark**: 4 PJ + 8–12 enemigos animados + escenario + UI sostienen **60 FPS**.
8. **AC-8** — Cambiar de especie/cuerpo/personaje y cerrar el creador **no filtra memoria**
   (geometrías, materiales, texturas, mixers y esqueletos liberados).
9. **AC-9** — El creador **no descarga** todos los assets al abrirse: solo la especie activa,
   thumbnails 2D y lo que se elige.
10. **AC-10** — En móvil la ficha usa portrait por defecto; el 3D es bajo demanda.
11. **AC-11** — `Visual Height` no altera `Creature Size`, alcance ni ocupación de rejilla (VIS-5).
12. **AC-12** — Ocultar el casco no cambia CA ni ninguna regla.
13. **AC-13** — Aleatorizar produce siempre combinaciones válidas para la especie.

---

## 16. Deuda técnica, conflictos y riesgos

### 16.1 Deuda y conflictos con la arquitectura actual

| # | Punto | Dónde | Se paga en |
| --- | --- | --- | --- |
| 1 | **No hay pipeline GLB, animación ni skinning**: todo el subsistema es nuevo | cliente | G1 |
| 2 | `avatar_path` (retrato IA) y el portrait 3D **se solapan**: dos caminos para «la cara del personaje». Hay que decidir si el portrait sustituye o convive | `characters`, `TokenIcon`, `mapLibrary` | G6 (decisión en §17) |
| 3 | `MapToken` mezcla peana, retrato, overlays y lógica de estado en un componente grande; insertar una figura skinned exige extraer `MiniatureBase`/`GameplayOverlay` | `MapToken.jsx` | G4 |
| 4 | `frameloop="always"` en el tablero: con miniaturas animadas conviene revisar coste y pasar los previews a `demand` | `TacticalMapCanvas.jsx` | G3/G6 |
| 5 | No existe cache de assets ni convención de disposal para recursos **compartidos** (hoy cada componente libera lo suyo) | cliente | G1 |
| 6 | La cámara es cenital y hecha a mano; el creador necesita otra cámara (órbita limitada) sin contaminar la del tablero | `TacticalCamera.jsx` | G1 |
| 7 | El tamaño de criatura no está expuesto como concepto propio para dimensionar la peana | dominio de tokens | G4 |

### 16.2 Riesgos

1. **Coste real de los assets** (el mayor con diferencia). 9 siluetas + armaduras modulares por
   BodyFamily es un proyecto de arte, no de código. *Mitigación*: validar packs CC0 antes de G2;
   reducir BodyFamilies si los assets lo permiten; equipo genérico y de baja prioridad.
2. **Que ningún pack CC0 dé las 9 siluetas** con un rig común. *Mitigación*: el contrato son los
   sockets y nombres de hueso (§10.2); permite mezclar fuentes o sustituir mallas sin tocar código.
3. **60 FPS con 12–16 personajes skinned animados** en un tablero ya cargado (niebla, elevación,
   luces). *Mitigación*: benchmark en G4 —no al final—, LOD agresivo, instancing, calidad
   adaptativa, billboard como último recurso.
4. **Enano/gnomo/mediano indistinguibles** si se resuelven escalando el mismo cuerpo.
   *Mitigación*: proporciones propias por malla; AC-2 lo bloquea explícitamente.
5. **Clipping de armaduras** entre familias. *Mitigación*: ocultar/sustituir partes del cuerpo
   (§9.2), nunca superponer; validar por familia.
6. **Fugas de memoria** al cambiar especie repetidamente en el creador (el caso más agresivo del
   proyecto). *Mitigación*: cache central + AC-8.
7. **Peso de descarga en móvil**. *Mitigación*: lazy loading, thumbnails 2D, Meshopt+KTX2, LOD.
8. **Solape con la rebanada 1**: D y F tocan ficha y tablero. *Mitigación*: no solapar G3/G4 con
   ellas.
9. **Licencias**. *Mitigación*: §11.2 y `CREDITS.md` con origen, autor, licencia y modificaciones.

---

## 17. Decisiones a tomar antes de implementar

1. **Assets del MVP** (bloquea G1/G2): validar Quaternius/KayKit —licencia **y** si su rig y
   proporciones dan las 9 siluetas— o encargar assets propios.
2. **`@react-three/drei`**: confirmar la incorporación (recomendado, §12.1).
3. **`gltfjsx`**: adoptarlo en el pipeline o no.
4. **`avatar_path` vs. portrait 3D** (deuda 16.1-2): ¿el portrait generado **sustituye** al avatar
   por IA, **convive** con él, o el jugador elige cuál se usa?
5. **BodyFamilies definitivas**: confirmar las 4 propuestas tras ver los assets reales.
6. **Alcance 3D en móvil**: ¿visor 3D bajo demanda en el MVP, o solo portrait?
7. **Calidad adaptativa**: ¿automática por detección, elección del usuario, o ambas?
8. **Peanas por campaña**: confirmar que queda fuera del MVP (el modelo ya lo admite).
</content>
