// Glosario central de estadísticas del juego: una sola fuente de verdad para
// las explicaciones que aparecen al pasar el cursor sobre cualquier stat
// (CA, HP, iniciativa…) en cualquier pantalla. Consumido por StatTooltip.
//
// El texto es contenido propio y divulgativo (no copiado del SRD): pensado
// para que un jugador nuevo entienda de un vistazo qué significa cada dato.

export const STAT_GLOSSARY = {
  // — Características —
  str: {
    term: 'Fuerza (FUE)',
    desc: 'Poder físico. Afecta al combate cuerpo a cuerpo, a Atletismo y a cuánto peso puedes cargar.',
  },
  dex: {
    term: 'Destreza (DES)',
    desc: 'Agilidad y reflejos. Afecta a la CA, la iniciativa, los ataques a distancia o sutiles y a Sigilo o Acrobacias.',
  },
  con: {
    term: 'Constitución (CON)',
    desc: 'Aguante y salud. Determina tus puntos de golpe y las salvaciones para resistir veneno, frío o agotamiento.',
  },
  int: {
    term: 'Inteligencia (INT)',
    desc: 'Razonamiento y memoria. Afecta a Arcanos, Investigación e Historia, y a la magia de los magos.',
  },
  wis: {
    term: 'Sabiduría (SAB)',
    desc: 'Percepción e intuición. Afecta a Percepción y Perspicacia, y a la magia de clérigos y druidas.',
  },
  cha: {
    term: 'Carisma (CAR)',
    desc: 'Fuerza de personalidad. Afecta a Persuasión, Engaño e Intimidación, y a la magia de bardos, hechiceros, brujos y paladines.',
  },

  // — Estadísticas de combate derivadas —
  ca: {
    term: 'Clase de Armadura (CA)',
    desc: 'Lo difícil que es acertarte. Un atacante impacta solo si su tirada de ataque iguala o supera tu CA.',
  },
  hp: {
    term: 'Puntos de golpe (PG)',
    desc: 'Tu vida. Al llegar a 0 caes inconsciente y empiezas a hacer tiradas de muerte. Se recuperan descansando o con curación.',
  },
  'hp-temp': {
    term: 'PG temporales',
    desc: 'Vida extra que absorbe el daño antes que tus PG normales. No se acumulan entre sí ni se recuperan al curarte: son un colchón pasajero.',
  },
  velocidad: {
    term: 'Velocidad',
    desc: 'Distancia en pies que recorres en tu turno. En el mapa cada casilla son 5 pies (30 pies = 6 casillas).',
  },
  competencia: {
    term: 'Bono de competencia',
    desc: 'Se suma a todo lo que dominas: armas, salvaciones y habilidades con competencia. Sube con el nivel, de +2 a nivel 1 hasta +6 a nivel 17.',
  },
  darkvision: {
    term: 'Visión en la oscuridad',
    desc: 'Distancia en pies a la que ves en la oscuridad como si fuera penumbra. Rasgo típico de razas como elfos o enanos.',
  },
  iniciativa: {
    term: 'Iniciativa',
    desc: 'Marca el orden de los turnos en combate: 1d20 + tu modificador de Destreza. Quien saca más actúa antes.',
  },

  // — Recursos del turno —
  mov: {
    term: 'Movimiento',
    desc: 'Casillas que te quedan por moverte este turno. Cada casilla son 5 pies; tu total depende de tu velocidad.',
  },
  accion: {
    term: 'Acción',
    desc: 'Lo principal que haces en tu turno: atacar, lanzar un conjuro, correr… Tienes una por turno y atacar la consume.',
  },
  adicional: {
    term: 'Acción adicional',
    desc: 'Acción extra que solo conceden ciertos rasgos, conjuros o armas. Una por turno, aparte de tu acción normal.',
  },
  reaccion: {
    term: 'Reacción',
    desc: 'Respuesta instantánea fuera de tu turno, como un ataque de oportunidad. Solo una por ronda.',
  },

  // — Magia —
  'ataque-conjuro': {
    term: 'Bono de ataque de conjuro',
    desc: 'Se suma a la tirada de ataque de los hechizos que requieren impactar. Es tu modificador de característica mágica + competencia.',
  },
  'cd-conjuro': {
    term: 'CD de salvación de conjuros',
    desc: 'Dificultad que tus enemigos deben superar para resistir tus hechizos. Es 8 + tu bono de ataque de conjuro.',
  },
};

/** Entrada del glosario para una tirada de salvación de una característica. */
export function saveStat(abilityName) {
  return {
    term: `Salvación de ${abilityName}`,
    desc: `Tirada para resistir un efecto (veneno, un hechizo, una caída…): 1d20 + modificador de ${abilityName}, más tu bono de competencia si dominas esta salvación.`,
  };
}

/** Entrada del glosario para una habilidad basada en una característica. */
export function skillStat(skillName, abilityName) {
  return {
    term: skillName,
    desc: `Habilidad basada en ${abilityName}. Se tira 1d20 + modificador de ${abilityName}, más tu bono de competencia si la dominas.`,
  };
}
