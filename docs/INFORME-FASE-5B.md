# Informe de la Fase 5b — Creación de personaje como videojuego

Implementación terminada y verificación técnica superada el 21-09-2026; arte de clase y retrato progresivo añadidos el 22-09-2026 y colección visual del creador completada el 23-09-2026. Solo se ha trabajado en la Fase 5b. La aceptación humana del criterio 5 queda pendiente de Juan con alguien del grupo: crear un guerrero en menos de cinco minutos sin abrir la ayuda.

## Resultado

El creador usa el recorrido campaña → especie → clase → características → competencias → equipo → identidad → resumen. Presenta tarjetas ilustradas, emblemas, detalles del compendio y una ficha que anticipa estadísticas y ataques. Sus 12 clases y 9 especies tienen arte generado propio; las opciones incorporadas por el DM usan dos comodines distintos y la ficha lateral parte de una imagen sin forjar antes de construirse con las elecciones. El nombre se exige al llegar a identidad; el retrato reutiliza el panel de subir/generar existente. La vista previa permanece a la derecha en escritorio y accesible desde una barra de estadísticas y un cajón en móvil.

## Archivos de la fase

| Archivos | Cambio |
| --- | --- |
| `client/src/pages/CharacterWizardPage.jsx` | Orden, recuperación de borradores, aleatorio con inventario materializado, autosalvado serializado, validación del contexto de campaña, transiciones y cajón accesible. |
| `client/src/components/wizard/StepCampana.jsx` | Selección de campaña separada de identidad. |
| `client/src/components/wizard/CreatorSelection.jsx`, `StepClase.jsx`, `StepRaza.jsx` | Galerías, emblemas, detalle, rasgos, nombres traducidos y respaldo EN. |
| `client/src/components/wizard/StepCaracteristicas.jsx`, `StepCompetencias.jsx` | Recomendado, métodos, compra por puntos, ayudas junto al campo y anticipación. |
| `client/src/components/wizard/StepEquipo.jsx` | Anticipación inmediata de conjuntos y armas; conserva la colocación de equipo existente. |
| `client/src/components/wizard/StepIdentidad.jsx`, `StepResumen.jsx` | Nombre obligatorio al final, retrato, narrativa y revisión de elecciones pendientes. |
| `client/src/components/wizard/WizardPreview.jsx`, `WizardProgress.jsx`, `wizard.css` | Ficha viva, deltas, progreso con iconos, estética y movimiento reducido. |
| `client/src/pages/CharacterSheetPage.jsx`, `components/SheetTutorial.jsx`, `lib/sheetTutorial.js` | Continuidad de color al terminar y apertura del tutorial después de que ficha y compendio estén listos. |
| `client/src/lib/wizard.js`, `wizardPreview.js` | Recomendación, generación aleatoria, validación de repartos, recuperación del recorrido y adaptación a los espejos de reglas. |
| `client/src/lib/__tests__/wizard.test.js`, `wizardPreview.test.js` | Pruebas de dominio y de estadísticas/deltas/equipo. |
| `client/src/lib/__tests__/fixtures/wizard-srd-2014.json`, `wizard-legacy-anonymized.json` | Compendio real y datos locales anonimizados leídos sin modificar la base original. |
| `client/public/creador/*-gen.webp`, `*.svg`, `README.md` | 24 piezas generadas y optimizadas: 12 clases, 9 especies, dos comodines separados y el estado `preview-sin-forjar`; SVG de fallback, dirección y procedencia documentados. |
| `ROADMAP.md`, `docs/ARQUITECTURA.md`, este informe | Estado, verificación, decisiones y alcance pendiente. |

## Decisiones

- **Arte generado, curado y estático**: las 12 clases y 9 especies tienen retrato propio; las entradas del DM usan comodines separados para clase y especie, y la vista previa arranca con una pieza sin forjar. La colección se creó con la herramienta integrada de generación de imágenes de OpenAI bajo una dirección común de fantasía oscura, luz de cobre y acentos verde azulado, y se optimizó para la interfaz. Los SVG quedan como fallback y mostrar esta colección no llama a servicios externos. El retrato personal conserva aparte las acciones explícitas de subir o generar. Las ilustraciones son orientación artística y no fijan el aspecto de la ficha.
- **Recursos sin efecto mecánico**: las imágenes son archivos estáticos versionados. No alteran reglas, cálculos ni modelo de datos, y cada selección mantiene su fallback si falta el recurso principal.
- **Retrato que se construye**: la ficha lateral parte de una figura sin forjar, perfila la especie y después revela el arte de clase según avanza el recorrido. Es una capa cosmética que no se persiste ni participa en reglas; el retrato subido o generado por el usuario prevalece al llegar a identidad.
- **Llegada estable a la ficha**: creador, carga y ficha terminada comparten la misma paleta. La petición `?tutorial=1` se conserva hasta que la ficha correcta y el compendio han terminado de cargar y la interfaz ha pintado dos frames; también se consume si el catálogo falla, sin bloquear la ayuda manual.
- **Sin migraciones**: `wizard_data.flowVersion = 2` distingue el recorrido nuevo. Se reasigna `wizard_step` al leer y se preservan todas las elecciones. Un fixture procede de un borrador real; otro conserva el `wizard_data` de una ficha terminada, reabierta como borrador únicamente en la prueba.
- **Nombre pendiente dentro del borrador**: la API histórica rechaza enviar un nombre vacío. `wizard_data.identityName` conserva esa edición mientras se termina la identidad; el nombre válido se envía por la ruta existente. El límite de 60 caracteres coincide con el servidor.
- **Recomendación orientativa**: usa `PRIMARY_ABILITY` y el array estándar, más habilidades típicas permitidas por la clase. Se puede modificar después. El aleatorio respeta las opciones del compendio e incluye equipo materializado antes de permitir saltar a identidad.
- **Compra por puntos**: presupuesto máximo de 27 y valores enteros 8–15 antes de bonos; conservar puntos sin gastar es válido. Está rotulada como Manual del Jugador 2014, fuera del SRD 5.1.
- **Formas reales del compendio**: se adaptaron los parsers a las opciones anidadas de herramientas/instrumentos del monje y a las categorías directas de equipo. No se añadieron concesiones ni reglas.
- **Autoridad y límites existentes**: no se modificaron `server/src/routes/characters.js`, el modelo de ficha ni las fórmulas de combate. La finalización conserva el cálculo y envío de PG del asistente anterior; a diferencia de CA/nivel/competencias de equipo, ese flujo existente no los deriva íntegramente en el servidor. Se deja registrada esta discrepancia con el ideal de arquitectura, sin ampliar la fase.

## Verificación

- `npm test`: **462 pruebas aprobadas**, 186 del servidor y 276 del cliente, sin fallos.
- Recomendado válido para **12 clases × 9 especies**; aleatorio válido en **100 ejecuciones** con el compendio real, además de extremos de tirada.
- Compra por puntos: rechazos fuera del presupuesto, rango, enteros o seis valores completos.
- Recuperación idempotente de borradores antiguos sin perder datos.
- Vista previa: cambio de especie, clase, primera asignación parcial, características, competencias, armaduras y armas; deltas comprobados sin persistir la opción anticipada. El retrato progresa de figura sin forjar a especie y clase; el avatar propio lo completa.
- `npm run build --prefix client`: correcto. `git diff --check`: sin errores de espacios.
- Chromium real con backend y SQLite aislados del desarrollo: recorrido de guerrero completo, subida de retrato, ficha final con **13 PG, CA 18 y seis entradas de inventario**. Sin errores de JavaScript.
- **390 × 844**: ocho pasos y cajón con ancho de documento exactamente 390 px. **1440 × 1000**: galería, detalle, preview y deltas inspeccionados visualmente. Las 24 piezas WebP —12 clases, 9 especies, dos comodines y `preview-sin-forjar`— responden y decodifican sin errores de JavaScript; los SVG cubren su fallback.
- Playwright sirve las 24 piezas por HTTP, exige `image/webp`, las decodifica a 640 × 800 y comprueba que sus hashes sean distintos. El E2E queda en 3 pruebas aprobadas y 3 escenarios de privacidad omitidos cuando el entorno no dispone de sus requisitos.
- Transición a ficha: misma paleta durante carga y contenido; con el compendio demorado, el tutorial retiene la URL y no aparece hasta que los controles están listos. El fallo del catálogo tampoco lo bloquea.
- Aleatorio → identidad → finalizar sin visitar Equipo: inventario persistido. Nombre vacío conservado al salir y reabrir. Guardados retrasados artificialmente conservan el último nombre al finalizar. Clase del DM no disponible bloqueada antes de finalizar. Movimiento reducido comprobado.

Evidencias locales en `artifacts/phase5b-*` (carpeta ignorada por Git): capturas, resultados JSON, registros de pruebas/build y los guiones de QA. La prueba usa una copia exclusiva del compendio; no copia usuarios ni partidas a su base temporal.

## Fuera de alcance

Multiclase, dotes, trasfondos mecánicos, nuevas subrazas/subclases, miniatura 3D y paso Apariencia. Tampoco se modifican las reglas de PG, CA, competencias o equipamiento, ni se implementa otra fase del programa. La deuda detectada sobre habilidades opcionales de especie, variantes narrativas y autoridad de PG queda en `docs/ARQUITECTURA.md` §4.16.

**Pendiente de aceptación humana:** la prueba de cinco minutos con una persona principiante corresponde a Juan y su grupo, tal como exige el documento de la fase. Los recorridos automatizados no acreditan ese criterio.
