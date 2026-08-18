// Qué dados tienen cuerpo físico y en qué dados se convierte una tirada.
//
// Este módulo NO importa three.js a propósito. Lo consulta `DiceOverlay`, que
// vive en el bundle principal: si de aquí colgara la geometría, three entero
// (unos 733 kB) se descargaría en la pantalla de acceso solo por si alguien
// tira un dado. La bandeja 3D se carga aparte y solo cuando hace falta.

// Dados con cuerpo propio. Los cinco sólidos platónicos más el d10, que es un
// trapezoedro pentagonal construido a mano.
export const SUPPORTED_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

export function supportsDie(die) {
  return SUPPORTED_DICE.includes(die);
}

/**
 * El d100 no tiene cuerpo y no lo va a tener: el dado de cien caras real es un
 * zocaedro, una rareza que casi nadie usa. En la mesa un percentil se tira con
 * DOS d10, uno de decenas y otro de unidades, y así se representa aquí.
 */
export function canShowDie(die) {
  return supportsDie(die) || die === 'd100';
}

/** Cara del d10 que muestra un dígito: el 0 se lee en la cara 10. */
function faceForDigit(digit) {
  return digit === 0 ? 10 : digit;
}

/**
 * Descompone un percentil en sus dos dados. `faces` le dice a la bandeja cómo
 * rotular las caras: el de decenas muestra 00-90 y el de unidades 0-9.
 */
function percentileDice(value, discarded) {
  const clean = Math.min(100, Math.max(1, Math.round(value)));
  const tens = Math.floor(clean / 10) % 10; // 100 → 0, que se lee "00"
  const units = clean % 10;
  return [
    { die: 'd10', value: faceForDigit(tens), discarded, faces: 'tens' },
    { die: 'd10', value: faceForDigit(units), discarded, faces: 'units' },
  ];
}

/**
 * Convierte una tirada de `lib/dice.js` en la lista de dados a lanzar.
 * Los tipos sin representación se quedan fuera: la tarjeta los cuenta igual,
 * pero no se inventa un cuerpo que no les corresponde.
 */
export function dadosDeTirada(roll, { supports = canShowDie } = {}) {
  const dados = [];
  for (const group of roll?.groups ?? []) {
    if (!supports(group.die)) continue;
    for (const result of group.results) {
      for (const value of result.rolls) {
        // En ventaja/desventaja se tiran dos y se conserva uno: el descartado
        // se ve rodar igual, atenuado, porque en la mesa también se ve caer.
        const discarded = result.rolls.length > 1 && value !== result.kept;
        if (group.die === 'd100') {
          dados.push(...percentileDice(value, discarded));
        } else {
          dados.push({ die: group.die, value, discarded, faces: null });
        }
      }
    }
  }
  return dados;
}

/**
 * Rótulo de una cara según el papel del dado. Devuelve el número tal cual salvo
 * en los dos dados de un percentil.
 */
export function faceLabel(faceValue, faces) {
  if (faces === 'tens') return `${faceValue % 10}0`;
  if (faces === 'units') return String(faceValue % 10);
  return String(faceValue);
}
