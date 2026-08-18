import test from 'node:test';
import assert from 'node:assert/strict';
import { faceUp } from '../lib/diceShapes.js';
import { dadosDeTirada, faceLabel, supportsDie } from '../lib/supported.js';
import { RETARDO_MAXIMO_MS, VUELO_MS, createTumble, duracionTotal, retardoDe } from '../lib/tumble.js';

test('al terminar el vuelo, el dado muestra el número de la tirada', () => {
  // La propiedad central: la animación no puede acabar en otra cara que la que
  // ya salió y se compartió con la mesa.
  for (const die of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
    for (const value of [1, 2, 3]) {
      const tumble = createTumble({ die, value, seed: value * 13 });
      const final = tumble.sample(tumble.duration);
      assert.ok(final.settled, `${die} debe haber parado`);
      assert.equal(faceUp(die, final.quaternion), value, `${die} debe leerse ${value}`);
    }
  }
});

test('el d20 acaba en su cara para los veinte resultados posibles', () => {
  for (let value = 1; value <= 20; value += 1) {
    const tumble = createTumble({ die: 'd20', value, seed: 4242 + value });
    assert.equal(faceUp('d20', tumble.sample(tumble.duration + 500).quaternion), value);
  }
});

test('el sobregiro se desvanece: el último instante ya es la orientación final', () => {
  const tumble = createTumble({ die: 'd20', value: 11, seed: 7 });
  const casiFinal = tumble.sample(tumble.duration - 1);
  // Un milisegundo antes del final el dado ya está prácticamente colocado; si el
  // sobregiro no se apagara, aquí se vería girado.
  assert.equal(faceUp('d20', casiFinal.quaternion), 11);
});

test('antes de su turno el dado no está en la mesa', () => {
  const segundo = createTumble({ die: 'd6', value: 4, index: 1, count: 3, seed: 5 });
  const antes = segundo.sample(0);
  assert.equal(antes.visible, false, 'todavía no ha salido');
  assert.equal(antes.settled, false);
  const durante = segundo.sample(segundo.delay + VUELO_MS / 2);
  assert.equal(durante.visible, true);
  assert.equal(durante.settled, false);
});

test('el dado bota y nunca atraviesa la mesa', () => {
  const tumble = createTumble({ die: 'd20', value: 20, seed: 99 });
  const reposo = tumble.rest.y;
  let maximo = 0;
  for (let ms = 1; ms < VUELO_MS; ms += 5) {
    const { position } = tumble.sample(ms);
    assert.ok(position.y >= reposo - 1e-9, `y=${position.y} se hunde por debajo del reposo ${reposo}`);
    maximo = Math.max(maximo, position.y);
  }
  assert.ok(maximo > reposo + 1, 'debe haber vuelo de verdad, no un deslizamiento');
});

test('el dado acaba justo en su sitio de reposo', () => {
  const tumble = createTumble({ die: 'd8', value: 5, seed: 3 });
  const final = tumble.sample(tumble.duration);
  assert.ok(final.position.distanceTo(tumble.rest) < 1e-9);
});

test('los dados salen escalonados y el retardo total tiene techo', () => {
  assert.equal(retardoDe(0, 1), 0, 'un dado solo no espera');
  assert.equal(retardoDe(0, 5), 0, 'el primero nunca espera');
  assert.ok(retardoDe(1, 5) > 0);
  assert.ok(retardoDe(4, 5) > retardoDe(2, 5), 'el retardo crece con la posición');
  // Una tirada enorme no puede durar el triple que una pequeña.
  assert.ok(retardoDe(39, 40) <= RETARDO_MAXIMO_MS + 1e-9);
  assert.ok(duracionTotal(40) <= VUELO_MS + RETARDO_MAXIMO_MS + 1e-9);
});

test('misma semilla, mismo vuelo; semilla distinta, vuelo distinto', () => {
  const a = createTumble({ die: 'd20', value: 14, seed: 21 });
  const b = createTumble({ die: 'd20', value: 14, seed: 21 });
  const c = createTumble({ die: 'd20', value: 14, seed: 22 });
  assert.deepEqual(a.sample(400).position.toArray(), b.sample(400).position.toArray());
  assert.notDeepEqual(a.sample(400).position.toArray(), c.sample(400).position.toArray());
  // Pero las tres acaban en el mismo número: el azar es de la pose, no del dado.
  for (const tumble of [a, b, c]) {
    assert.equal(faceUp('d20', tumble.sample(tumble.duration).quaternion), 14);
  }
});

test('los dados de la tanda no se apilan en el mismo sitio', () => {
  const dados = [0, 1, 2, 3].map((index) =>
    createTumble({ die: 'd6', value: 3, index, count: 4, seed: 8 })
  );
  for (let i = 0; i < dados.length; i += 1) {
    for (let j = i + 1; j < dados.length; j += 1) {
      const separacion = dados[i].rest.distanceTo(dados[j].rest);
      assert.ok(separacion > 0.5, `los dados ${i} y ${j} quedan a ${separacion.toFixed(2)}, se solapan`);
    }
  }
});

test('una tirada se traduce a los dados que se pueden tirar en 3D', () => {
  const roll = {
    groups: [
      { die: 'd20', sides: 20, results: [{ rolls: [18, 4], kept: 18 }] },
      { die: 'd6', sides: 6, results: [{ rolls: [3], kept: 3 }, { rolls: [5], kept: 5 }] },
      { die: 'd10', sides: 10, results: [{ rolls: [7], kept: 7 }] },
    ],
  };
  assert.deepEqual(
    dadosDeTirada(roll),
    [
      { die: 'd20', value: 18, discarded: false, faces: null },
      { die: 'd20', value: 4, discarded: true, faces: null },
      { die: 'd6', value: 3, discarded: false, faces: null },
      { die: 'd6', value: 5, discarded: false, faces: null },
      { die: 'd10', value: 7, discarded: false, faces: null },
    ],
    'el d20 descartado se ve rodar igual, atenuado'
  );
});

test('un percentil se tira con dos d10: decenas y unidades', () => {
  const percentil = (value) =>
    dadosDeTirada({ groups: [{ die: 'd100', sides: 100, results: [{ rolls: [value], kept: value }] }] });

  // 37 se lee "30" + "7"
  assert.deepEqual(percentil(37), [
    { die: 'd10', value: 3, discarded: false, faces: 'tens' },
    { die: 'd10', value: 7, discarded: false, faces: 'units' },
  ]);
  // El 0 se lee en la cara 10 del d10: 100 es "00" + "0"
  assert.deepEqual(percentil(100), [
    { die: 'd10', value: 10, discarded: false, faces: 'tens' },
    { die: 'd10', value: 10, discarded: false, faces: 'units' },
  ]);
  // 7 es "00" + "7"
  assert.deepEqual(percentil(7), [
    { die: 'd10', value: 10, discarded: false, faces: 'tens' },
    { die: 'd10', value: 7, discarded: false, faces: 'units' },
  ]);
  // 10 es "10" + "0"
  assert.deepEqual(percentil(10), [
    { die: 'd10', value: 1, discarded: false, faces: 'tens' },
    { die: 'd10', value: 10, discarded: false, faces: 'units' },
  ]);
});

test('los dos dados del percentil se rotulan como en la mesa', () => {
  assert.equal(faceLabel(3, 'tens'), '30');
  assert.equal(faceLabel(10, 'tens'), '00');
  assert.equal(faceLabel(9, 'tens'), '90');
  assert.equal(faceLabel(7, 'units'), '7');
  assert.equal(faceLabel(10, 'units'), '0');
  // Un dado normal muestra su número tal cual.
  assert.equal(faceLabel(20, null), '20');
  assert.equal(faceLabel(10, null), '10');
});

test('cualquier percentil se puede leer de vuelta a partir de sus dos dados', () => {
  for (let value = 1; value <= 100; value += 1) {
    const [decenas, unidades] = dadosDeTirada({
      groups: [{ die: 'd100', sides: 100, results: [{ rolls: [value], kept: value }] }],
    });
    const leido = Number(faceLabel(decenas.value, 'tens')) + Number(faceLabel(unidades.value, 'units'));
    const esperado = value === 100 ? 0 : value; // "00" + "0" se lee como 100
    assert.equal(leido, esperado, `el percentil ${value} se lee mal en los dados`);
  }
});

test('una tirada sin dados con cuerpo no lanza nada', () => {
  assert.deepEqual(dadosDeTirada({ groups: [] }), []);
  assert.deepEqual(dadosDeTirada(null), []);
  assert.equal(supportsDie('d100'), false, 'el d100 no tiene cuerpo propio');
});
