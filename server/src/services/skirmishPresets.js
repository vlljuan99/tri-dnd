// Escaramuzas predefinidas: escenarios de fábrica listos para jugar sin DM,
// pensados para probar un PJ. Cada uno es un snapshot de mapa con el
// mismo formato que las plantillas del DM (services/templates.js), así que se
// instancian con `instantiateMap` sin ninguna ruta especial.
//
// Se definen en código y no en JSON por dos razones: la geometría se genera
// (un desfiladero o una fosa de lava a mano son cientos de pares de casillas
// ilegibles) y `server/data/` es el volumen de datos en el despliegue, donde
// habría que copiarlos a mano como pasó con las traducciones.
//
// Las salas marcadas `revealed` se abren al crear la escaramuza y sus enemigos
// entran al tracker de iniciativa; las demás esperan a que el grupo las
// descubra, con lo que el encuentro escala solo.

// ---- Utilidades de geometría ----

function rectCells(x, y, width, height) {
  const cells = [];
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) cells.push([col, row]);
  }
  return cells;
}

function tagged(cells, value) {
  return cells.map(([col, row]) => [col, row, value]);
}

function withoutCells(cells, excluded) {
  const keys = new Set(excluded.map(([col, row]) => `${col},${row}`));
  return cells.filter(([col, row]) => !keys.has(`${col},${row}`));
}

// ---- 1. Emboscada en el Paso del Cuervo ----

// Desfiladero que serpentea de oeste a este: por cada columna se calcula la
// franja transitable y todo lo de fuera son laderas intransitables. Las
// repisas son las filas del borde de esa franja, elevadas.
function ravineBand(width, height) {
  const band = [];
  for (let col = 0; col < width; col += 1) {
    const center = Math.round(height / 2 + Math.sin((col / width) * Math.PI * 1.7) * 2.4);
    const half = col < 3 || col > width - 4 ? 3 : 4;
    band.push([Math.max(1, center - half), Math.min(height - 2, center + half)]);
  }
  return band;
}

function ravinePreset() {
  const width = 26;
  const height = 18;
  const band = ravineBand(width, height);
  const top = (col, offset = 0) => [col, band[col][0] + offset];
  const bottom = (col, offset = 0) => [col, band[col][1] - offset];
  const middle = (col, offset = 0) => [col, Math.round((band[col][0] + band[col][1]) / 2) + offset];

  const disabledCells = [];
  for (let col = 0; col < width; col += 1) {
    for (let row = 0; row < height; row += 1) {
      if (row < band[col][0] || row > band[col][1]) disabledCells.push([col, row]);
    }
  }

  // Repisas del norte (los arqueros) y un balcón bajo al sur
  const elevationCells = [
    ...tagged([5, 6, 7, 8, 9, 10, 11].flatMap((col) => [top(col), top(col, 1)]), 1),
    ...tagged([13, 14, 15, 16, 17, 18].flatMap((col) => [top(col), top(col, 1)]), 2),
    ...tagged([15, 16, 17, 18, 19, 20].map((col) => bottom(col)), 1),
  ];

  // Barro y matorral en el fondo del paso: cruzarlo cuesta el doble
  const terrainCells = tagged(
    [8, 9, 10, 11, 12, 13, 14, 15, 16, 17].flatMap((col) => [middle(col), middle(col, 1)]),
    2
  );

  // Espolón de roca que parte el paso: hay que rodearlo por el sur
  const wallEdges = [0, 1, 2, 3].map((offset) => [...top(19, offset), 'e']);

  return {
    id: 'paso-del-cuervo',
    previewUrl: '/skirmishes/paso-del-cuervo.webp',
    enemyAi: true,
    soloMode: true,
    name: 'Emboscada en el Paso del Cuervo',
    summary:
      'Una caravana entra por el desfiladero y los bandidos esperan en las repisas. Cota alta, barro y lluvia al atardecer: quien se quede en el fondo del paso lo va a pasar mal.',
    briefing:
      'La lluvia borra el camino de vuelta. Al entrar en el Paso del Cuervo, una cuerda cae tras de ti y siluetas armadas ocupan las repisas. Encuentra una salida y rompe la emboscada.',
    objectives: ['Sobrevive a la emboscada', 'Atraviesa el desfiladero', 'Derrota a quien dirige a los bandidos'],
    players: 1,
    suggestedLevel: '3-4',
    tags: ['exterior', 'elevación', 'terreno difícil', 'clima'],
    map: {
      name: 'Paso del Cuervo',
      gridSize: 1,
      visionMode: 'sala',
      visionRadius: 8,
      wallColor: '#7a6a52',
      terrainStyle: 'natural',
      wallLightEvery: 0,
      weather: 'lluvia',
      timeOfDay: 'atardecer',
      weatherIntensity: 0.7,
      floors: [
        {
          name: 'Desfiladero',
          position: 0,
          rooms: [
            {
              name: 'El paso',
              backgroundUrl: '/skirmishes/paso-del-cuervo.webp',
              x: 0,
              y: 0,
              width,
              height,
              revealed: true,
              notes:
                'Los bandidos abren fuego desde las repisas en cuanto la caravana pasa la red. El capitán no baja mientras le queden arqueros.',
              disabledCells,
              obstacleCells: [middle(4, -1), middle(12, 2), bottom(22), top(23)],
              spawnCells: [
                middle(1, -2), middle(1), middle(1, 2),
                middle(2, -2), middle(2), middle(2, 2),
              ],
              terrainCells,
              wallEdges,
              elevationCells,
              lightCells: [],
              fluidCells: [],
              tokens: [
                // Arqueros en la repisa alta del norte
                { kind: 'enemigo', name: 'Bandido arquero', monsterIndex: 'bandit', x: top(6)[0], y: top(6)[1], visionRadius: 10 },
                { kind: 'enemigo', name: 'Bandido arquero', monsterIndex: 'bandit', x: top(9)[0], y: top(9)[1], visionRadius: 10 },
                { kind: 'enemigo', name: 'Bandido arquero', monsterIndex: 'bandit', x: top(14)[0], y: top(14)[1], visionRadius: 10 },
                { kind: 'enemigo', name: 'Bandido arquero', monsterIndex: 'bandit', x: top(17)[0], y: top(17)[1], visionRadius: 10 },
                // Los que cierran la retirada, abajo en el paso
                { kind: 'enemigo', name: 'Bandido', monsterIndex: 'bandit', x: bottom(16)[0], y: bottom(16)[1] },
                { kind: 'enemigo', name: 'Bandido', monsterIndex: 'bandit', x: bottom(18)[0], y: bottom(18)[1] },
                { kind: 'enemigo', name: 'Lobo', monsterIndex: 'wolf', x: middle(20)[0], y: middle(20)[1] },
                { kind: 'enemigo', name: 'Lobo', monsterIndex: 'wolf', x: middle(21, 1)[0], y: middle(21, 1)[1] },
                { kind: 'enemigo', name: 'Lobo', monsterIndex: 'wolf', x: middle(22, -1)[0], y: middle(22, -1)[1] },
                {
                  kind: 'enemigo',
                  name: 'Yerna la Tuerta',
                  monsterIndex: 'bandit-captain',
                  x: top(20)[0],
                  y: top(20)[1],
                  visionRadius: 10,
                  loot: [
                    { name: 'Bolsa de monedas del peaje', source: 'text', qty: 1, chance: 100 },
                    { name: 'Cimitarra', source: 'srd', index: 'scimitar', qty: 1, chance: 70 },
                  ],
                },
                {
                  kind: 'trampa',
                  name: 'Red de cuerda tendida',
                  x: middle(7)[0],
                  y: middle(7)[1],
                  hidden: true,
                  perceptionDc: 13,
                  dc: 12,
                  skill: 'acrobatics',
                  successConsequence: 'Saltas la red antes de que se tense y el paso queda despejado.',
                  failureConsequence: 'La red se cierra: quedas apresado hasta liberarte.',
                  consequenceScope: 'player',
                },
                {
                  kind: 'objeto',
                  name: 'Carro volcado',
                  x: middle(11)[0],
                  y: middle(11)[1],
                  loot: [
                    { name: 'Raciones (1 día)', source: 'srd', index: 'rations-1-day', qty: 4, chance: 100 },
                    { name: 'Antorcha', source: 'srd', index: 'torch', qty: 3, chance: 100 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      doors: [],
    },
  };
}

// ---- 2. La Cripta Anegada ----

function cryptPreset() {
  // Nave: planta de cruz, con las esquinas recortadas y agua estancada en el
  // centro. El foso hundido bajo el agua hace que cruzar por el medio sea
  // lento de verdad, no solo decorativo.
  const naveWidth = 18;
  const naveHeight = 18;
  const naveDisabled = [
    ...rectCells(0, 0, 5, 5),
    ...rectCells(13, 0, 5, 5),
    ...rectCells(0, 13, 5, 5),
    ...rectCells(13, 13, 5, 5),
  ];
  const naveWater = withoutCells(rectCells(4, 5, 10, 8), naveDisabled);
  const navePit = rectCells(6, 7, 6, 4);

  return {
    id: 'cripta-anegada',
    previewUrl: '/skirmishes/cripta-anegada.webp',
    enemyAi: true,
    soloMode: true,
    name: 'La Cripta Anegada',
    summary:
      'Tres estancias a oscuras, agua hasta las rodillas y una puerta atrancada al fondo. Los esqueletos de la nave son el ruido; lo que espera en el sagrario es el problema.',
    briefing:
      'Las campanas de la cripta llevan doce noches sonando bajo el agua. Debes entrar, cruzar la nave anegada y silenciar aquello que se ha despertado en el sagrario.',
    objectives: ['Explora la cripta', 'Supera la puerta del sagrario', 'Silencia al guardián de los Doce'],
    players: 1,
    suggestedLevel: '4-5',
    tags: ['interior', 'oscuridad', 'agua', 'puertas', 'trampa'],
    map: {
      name: 'Cripta de los Doce Silentes',
      gridSize: 1,
      // Visión individual + noche: cada quien ve lo que alcanza su vista en la
      // oscuridad, y las antorchas de la cripta son islas de luz de verdad.
      visionMode: 'individual',
      visionRadius: 5,
      wallColor: '#6d6558',
      terrainStyle: 'construido',
      wallLightEvery: 6,
      weather: 'despejado',
      timeOfDay: 'noche',
      weatherIntensity: 0.4,
      floors: [
        {
          name: 'Cripta',
          position: 0,
          rooms: [
            {
              name: 'Vestíbulo derrumbado',
              backgroundUrl: '/skirmishes/cripta-anegada.webp',
              x: 0,
              y: 5,
              width: 10,
              height: 8,
              revealed: true,
              notes: 'La losa del suelo cede al tercer paso. El grupo entra por el oeste.',
              disabledCells: [[0, 0], [0, 7], [9, 0], [9, 7]],
              obstacleCells: [[3, 2], [6, 5], [7, 1]],
              spawnCells: [[1, 2], [1, 3], [1, 4], [1, 5], [2, 2], [2, 5]],
              terrainCells: tagged([[4, 3], [4, 4], [5, 3], [5, 4]], 2),
              wallEdges: [],
              elevationCells: [],
              lightCells: [[1, 1], [8, 6]],
              fluidCells: [],
              tokens: [
                {
                  kind: 'trampa',
                  name: 'Losa de presión',
                  x: 5,
                  y: 4,
                  hidden: true,
                  perceptionDc: 14,
                  dc: 13,
                  skill: 'investigation',
                  successConsequence: 'Encajas la losa con una cuña: el mecanismo queda muerto.',
                  failureConsequence: 'La losa cede y una lluvia de dardos barre el vestíbulo.',
                  consequenceScope: 'party',
                },
              ],
            },
            {
              name: 'Nave anegada',
              backgroundUrl: '/skirmishes/cripta-anegada.webp',
              x: 10,
              y: 0,
              width: naveWidth,
              height: naveHeight,
              revealed: false,
              notes: 'El agua llega a la rodilla; el foso central es más hondo de lo que parece.',
              disabledCells: naveDisabled,
              obstacleCells: [[5, 5], [5, 12], [12, 5], [12, 12], [8, 2], [9, 15]],
              spawnCells: [],
              terrainCells: tagged(navePit, 3),
              wallEdges: [],
              elevationCells: tagged(navePit, -1),
              lightCells: [[6, 1], [11, 16]],
              fluidCells: tagged(naveWater, 'agua'),
              tokens: [
                { kind: 'enemigo', name: 'Esqueleto', monsterIndex: 'skeleton', x: 6, y: 3 },
                { kind: 'enemigo', name: 'Esqueleto', monsterIndex: 'skeleton', x: 11, y: 3 },
                { kind: 'enemigo', name: 'Esqueleto', monsterIndex: 'skeleton', x: 3, y: 8 },
                { kind: 'enemigo', name: 'Esqueleto', monsterIndex: 'skeleton', x: 14, y: 9 },
                { kind: 'enemigo', name: 'Esqueleto', monsterIndex: 'skeleton', x: 7, y: 14 },
                { kind: 'enemigo', name: 'Esqueleto', monsterIndex: 'skeleton', x: 12, y: 14 },
                {
                  kind: 'objeto',
                  name: 'Sarcófago reventado',
                  x: 8,
                  y: 16,
                  loot: [
                    { name: 'Poción de curación', source: 'srd', index: 'potion-of-healing', qty: 1, chance: 100 },
                  ],
                },
              ],
            },
            {
              name: 'Sagrario',
              backgroundUrl: '/skirmishes/cripta-anegada.webp',
              x: 28,
              y: 4,
              width: 10,
              height: 10,
              revealed: false,
              notes: 'El altar está sobre una plataforma. El wight no se mueve de ella mientras los ghouls aguanten.',
              disabledCells: [[0, 0], [0, 9], [9, 0], [9, 9]],
              obstacleCells: [[2, 2], [7, 2], [2, 7], [7, 7]],
              spawnCells: [],
              terrainCells: [],
              wallEdges: [],
              elevationCells: tagged(rectCells(4, 4, 3, 3), 1),
              lightCells: [[1, 4], [8, 5]],
              fluidCells: [],
              tokens: [
                { kind: 'enemigo', name: 'Ghoul', monsterIndex: 'ghoul', x: 3, y: 3 },
                { kind: 'enemigo', name: 'Ghoul', monsterIndex: 'ghoul', x: 3, y: 6 },
                {
                  kind: 'enemigo',
                  name: 'El Duodécimo Silente',
                  monsterIndex: 'wight',
                  x: 5,
                  y: 5,
                  visionRadius: 8,
                  loot: [
                    { name: 'Llave de hierro ennegrecida', source: 'text', qty: 1, chance: 100 },
                    { name: 'Espada larga', source: 'srd', index: 'longsword', qty: 1, chance: 60 },
                  ],
                },
                {
                  kind: 'objeto',
                  name: 'Arcón del sagrario',
                  x: 8,
                  y: 8,
                  loot: [
                    { name: 'Bolsa de 120 po', source: 'text', qty: 1, chance: 100 },
                    { name: 'Poción de curación', source: 'srd', index: 'potion-of-healing', qty: 2, chance: 100 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      doors: [
        // Vestíbulo → Nave: abierta de par en par, es por donde entra el agua
        { from: [0, 0], to: [0, 1], fromX: 9, fromY: 8, toX: 10, toY: 8, kind: 'puerta', control: 'jugador', isOpen: true },
        // Nave → Sagrario: atrancada desde dentro, hay que forzarla
        {
          from: [0, 1], to: [0, 2],
          fromX: 27, fromY: 8, toX: 28, toY: 8,
          kind: 'puerta', control: 'jugador', isOpen: false, dc: 14, skill: 'athletics',
        },
      ],
    },
  };
}

// ---- 3. La Fundición del Puente Ígneo ----

function forgePreset() {
  const width = 24;
  const height = 18;
  // Fosa de colada de lado a lado, salvo la pasarela central que la cruza
  const pit = withoutCells(rectCells(3, 7, 18, 5), rectCells(11, 7, 2, 5));
  const ledges = [...rectCells(3, 5, 18, 1), ...rectCells(3, 12, 18, 1)];

  return {
    id: 'puente-igneo',
    previewUrl: '/skirmishes/puente-igneo.webp',
    enemyAi: true,
    soloMode: true,
    name: 'La Fundición del Puente Ígneo',
    summary:
      'Una fosa de colada parte la sala en dos y solo la cruza una pasarela de dos casillas. Arriba, en las andaderas, espera lo que el capataz no quiso bajar.',
    briefing:
      'La Fundición de Escoria Roja vuelve a arder sin herreros. Cruza la fosa, alcanza las andaderas y apaga la criatura que alimenta el horno antes de que la estructura ceda.',
    objectives: ['Cruza la fosa de colada', 'Alcanza las andaderas', 'Derrota al amo de la fundición'],
    players: 1,
    suggestedLevel: '6-7',
    tags: ['interior', 'lava', 'dos plantas', 'elevación'],
    map: {
      name: 'Fundición de Escoria Roja',
      gridSize: 1,
      visionMode: 'sala',
      visionRadius: 8,
      wallColor: '#5f4a3c',
      terrainStyle: 'construido',
      wallLightEvery: 0,
      weather: 'despejado',
      timeOfDay: 'noche',
      weatherIntensity: 0.3,
      floors: [
        {
          name: 'Cámara de la colada',
          position: 0,
          rooms: [
            {
              name: 'Fosa de colada',
              backgroundUrl: '/skirmishes/puente-igneo.webp',
              x: 0,
              y: 0,
              width,
              height,
              revealed: true,
              notes:
                'Cruzar por la pasarela es la única vía segura. La salamandra no la abandona: deja que la fosa haga el trabajo.',
              disabledCells: [...rectCells(0, 0, 2, 2), ...rectCells(22, 16, 2, 2)],
              obstacleCells: [[6, 2], [17, 2], [6, 15], [17, 15], [11, 1], [12, 16]],
              spawnCells: [[1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5]],
              // Escoria caliente en los bordes de la fosa: el paso cuesta el doble
              terrainCells: tagged(ledges, 2),
              wallEdges: [],
              // La fosa está hundida y las plataformas de trabajo, elevadas
              elevationCells: [
                ...tagged(pit, -2),
                ...tagged(rectCells(19, 3, 3, 3), 1),
                ...tagged(rectCells(19, 13, 3, 3), 1),
              ],
              lightCells: [[4, 9], [19, 9], [11, 9]],
              fluidCells: tagged(pit, 'lava'),
              tokens: [
                { kind: 'enemigo', name: 'Mefito de magma', monsterIndex: 'magma-mephit', x: 7, y: 9 },
                { kind: 'enemigo', name: 'Mefito de magma', monsterIndex: 'magma-mephit', x: 16, y: 9 },
                { kind: 'enemigo', name: 'Azer guardián', monsterIndex: 'azer', x: 13, y: 8 },
                { kind: 'enemigo', name: 'Azer guardián', monsterIndex: 'azer', x: 13, y: 10 },
                {
                  kind: 'enemigo',
                  name: 'Vhorra, la Escoria Roja',
                  monsterIndex: 'salamander',
                  x: 20, y: 4,
                  visionRadius: 10,
                  loot: [
                    { name: 'Lanza de la fundición', source: 'srd', index: 'spear', qty: 1, chance: 100 },
                    { name: 'Lingote de metal ígneo', source: 'text', qty: 3, chance: 100 },
                  ],
                },
                {
                  kind: 'trampa',
                  name: 'Válvula de colada',
                  x: 10,
                  y: 6,
                  hidden: true,
                  perceptionDc: 15,
                  dc: 14,
                  skill: 'arcana',
                  successConsequence: 'Cierras la válvula: la colada baja y la pasarela deja de estar al rojo.',
                  failureConsequence: 'La válvula revienta y una lengua de lava barre la pasarela.',
                  consequenceScope: 'party',
                },
                {
                  kind: 'objeto',
                  name: 'Yunque del capataz',
                  x: 20,
                  y: 14,
                  loot: [{ name: 'Herramientas de herrero', source: 'srd', index: 'smiths-tools', qty: 1, chance: 100 }],
                },
              ],
            },
          ],
        },
        {
          name: 'Andaderas altas',
          position: 1,
          rooms: [
            {
              name: 'Pasarela del capataz',
              x: 6,
              y: 2,
              width: 14,
              height: 8,
              revealed: false,
              notes: 'Desde aquí se ve toda la fosa. Quien suba se lleva la respuesta del capataz.',
              disabledCells: [...rectCells(0, 0, 3, 2), ...rectCells(11, 6, 3, 2)],
              obstacleCells: [[5, 3], [8, 4]],
              spawnCells: [],
              terrainCells: [],
              wallEdges: [],
              elevationCells: tagged(rectCells(0, 2, 14, 4), 1),
              lightCells: [[2, 4], [12, 3]],
              fluidCells: [],
              tokens: [
                { kind: 'enemigo', name: 'Mefito de magma', monsterIndex: 'magma-mephit', x: 3, y: 3 },
                { kind: 'enemigo', name: 'Mefito de magma', monsterIndex: 'magma-mephit', x: 10, y: 4 },
                {
                  kind: 'objeto',
                  name: 'Alacena del capataz',
                  x: 12, y: 2,
                  loot: [
                    { name: 'Poción de curación', source: 'srd', index: 'potion-of-healing', qty: 2, chance: 100 },
                    { name: 'Cuerda de cáñamo (50 pies)', source: 'srd', index: 'rope-hempen-50-feet', qty: 1, chance: 100 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      doors: [
        // Escalera de mano de la fosa a las andaderas (distinta planta)
        { from: [0, 0], to: [1, 0], fromX: 2, fromY: 15, toX: 7, toY: 8, kind: 'escalera', control: 'jugador', isOpen: true },
      ],
    },
  };
}

const PRESETS = [ravinePreset(), cryptPreset(), forgePreset()];

/** Resumen de cada escenario para el listado del Hub (sin el snapshot). */
export function listSkirmishPresets() {
  return PRESETS.map((preset) => {
    const rooms = preset.map.floors.flatMap((floor) => floor.rooms);
    const enemies = rooms.reduce(
      (total, room) => {
        const count = (room.tokens ?? []).filter((token) => (token.kind ?? 'enemigo') === 'enemigo').length;
        return total + (preset.soloMode ? Math.min(count, 2) : count);
      },
      0
    );
    return {
      id: preset.id,
      name: preset.name,
      summary: preset.summary,
      players: preset.players,
      suggestedLevel: preset.suggestedLevel,
      tags: preset.tags,
      previewUrl: preset.previewUrl,
      enemyAi: preset.enemyAi === true,
      soloMode: preset.soloMode === true,
      floors: preset.map.floors.length,
      rooms: rooms.length,
      enemies,
    };
  });
}

export function getSkirmishPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

// Solo para pruebas: el catálogo entero con su geometría
export const SKIRMISH_PRESETS = PRESETS;
