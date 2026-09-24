import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLA_MAXIMA,
  cabeza,
  cancelar,
  crearCola,
  desgloseCorto,
  destinoDeRetencion,
  empezar,
  encolar,
  enEspera,
  estaRevelada,
  mismaTirada,
  planDeRevelado,
  recibirTirada,
  retener,
  revelar,
  ritmoEfectivo,
  terminar,
  textoDelMargen,
  confirmar,
  pasosDeRevelado,
} from '../lib/reveal.js';

const d20 = (value, extra = {}) => ({
  kind: 'attack',
  label: 'Espada larga — ataque',
  groups: [{ die: 'd20', sides: 20, results: [{ rolls: [value], kept: value }] }],
  modifier: 5,
  total: value + 5,
  crit: value === 20,
  fumble: value === 1,
  ...extra,
});

// Recorre una tirada entera: empieza, se revela y sale de la cola.
function recorrer(cola, id) {
  let actual = empezar(cola, id);
  const { cola: revelada, liberados } = revelar(actual, id);
  actual = terminar(revelada, id);
  return { cola: actual, liberados };
}

test('tres tiradas casi a la vez se revelan en orden, sin solaparse', () => {
  let cola = crearCola();
  const ids = [];
  for (const valor of [4, 12, 18]) {
    const resultado = recibirTirada(cola, { roll: d20(valor), autor: 'Aria' });
    cola = resultado.cola;
    ids.push(resultado.id);
  }
  const vistas = [];
  while (cabeza(cola)) {
    const primera = cabeza(cola);
    // Solo la cabeza puede empezar: las demás esperan su turno
    for (const id of ids.filter((id) => id !== primera.id)) {
      assert.equal(empezar(cola, id), cola);
    }
    vistas.push(primera.roll.total);
    cola = recorrer(cola, primera.id).cola;
  }
  assert.deepEqual(vistas, [9, 17, 23]);
});

test('con más de dos tiradas esperando, las siguientes se aceleran', () => {
  let cola = crearCola();
  for (let valor = 1; valor <= 5; valor += 1) cola = recibirTirada(cola, { roll: d20(valor + 5) }).cola;
  const esperando = enEspera(cola);
  assert.ok(esperando > COLA_MAXIMA);
  assert.equal(ritmoEfectivo('cinematico', { enEspera: esperando }), 'rapido');
  assert.equal(ritmoEfectivo('cinematico', { enEspera: 2 }), 'cinematico');
  assert.equal(ritmoEfectivo('normal', { sinAnimacion: true }), 'instantaneo');
  assert.equal(ritmoEfectivo('inventado'), 'normal');
});

test('una tirada propia rueda una sola vez aunque el servidor la devuelva', () => {
  let cola = crearCola();
  const propia = d20(15, { uid: 'abc' });
  const encolada = encolar(cola, { roll: propia, local: true, reservada: true });
  cola = encolada.cola;
  // El eco llega con el veredicto que ha puesto el servidor
  const eco = { ...propia, outcome: { resultado: 'impacta', contra: { etiqueta: 'CA', valor: 14 } } };
  const recibida = recibirTirada(cola, { roll: eco, autor: 'Aria' });
  assert.equal(recibida.duplicada, true);
  assert.equal(recibida.id, encolada.id);
  assert.equal(recibida.cola.entradas.length, 1);
  // La reservada queda confirmada y con el veredicto del servidor
  assert.equal(recibida.cola.entradas[0].estado, 'lista');
  assert.equal(recibida.cola.entradas[0].roll.outcome.resultado, 'impacta');
});

test('una tirada del servidor por una acción propia (sin uid) sí rueda', () => {
  let cola = crearCola();
  cola = encolar(cola, { roll: d20(15, { uid: 'mia' }), local: true }).cola;
  const delServidor = { ...d20(9), label: 'Salvación de DES contra Bola de fuego' };
  const recibida = recibirTirada(cola, { roll: delServidor });
  assert.equal(recibida.duplicada, false);
  assert.equal(recibida.cola.entradas.length, 2);
});

test('el eco que llega cuando la propia ya salió de la cola no vuelve a rodar', () => {
  let cola = crearCola();
  const propia = d20(11, { uid: 'x1' });
  const { cola: conPropia, id } = encolar(cola, { roll: propia, local: true });
  cola = recorrer(conPropia, id).cola;
  const recibida = recibirTirada(cola, { roll: propia });
  assert.equal(recibida.duplicada, true);
  assert.equal(recibida.cola.entradas.length, 0);
});

test('una tirada recompuesta por el camino se reconoce por etiqueta, total y dados', () => {
  const a = d20(7);
  const b = { ...d20(7), crit: false };
  assert.equal(mismaTirada(a, b), true);
  assert.equal(mismaTirada(a, d20(8)), false);
  assert.equal(mismaTirada({ ...a, uid: '1' }, { ...a, uid: '2' }), false);
});

test('lo que llega tras una tirada espera a su veredicto; sin tiradas, va inmediato', () => {
  let cola = crearCola();
  const vacia = retener(cola, 'suelto');
  assert.equal(vacia.inmediato, true);

  const primera = recibirTirada(cola, { roll: d20(3) });
  cola = retener(primera.cola, 'fallo sobre el goblin').cola;
  const segunda = recibirTirada(cola, { roll: d20(19) });
  cola = retener(segunda.cola, 'daño sobre el orco').cola;
  assert.equal(destinoDeRetencion(cola), segunda.id);

  cola = empezar(cola, primera.id);
  const trasPrimera = revelar(cola, primera.id);
  assert.deepEqual(trasPrimera.liberados, ['fallo sobre el goblin']);
  cola = terminar(trasPrimera.cola, primera.id);
  // Durante el reposo de la última, lo nuevo ya no espera
  cola = empezar(cola, segunda.id);
  const trasSegunda = revelar(cola, segunda.id);
  assert.deepEqual(trasSegunda.liberados, ['daño sobre el orco']);
  assert.equal(retener(trasSegunda.cola, 'tarde').inmediato, true);
});

test('cancelar una propia rechazada pasa lo retenido a la anterior pendiente', () => {
  let cola = crearCola();
  const ajena = recibirTirada(cola, { roll: d20(10) });
  cola = ajena.cola;
  const propia = encolar(cola, { roll: d20(5, { uid: 'p' }), local: true, reservada: true });
  cola = retener(propia.cola, 'mensaje').cola;
  const cancelada = cancelar(cola, propia.id);
  assert.deepEqual(cancelada.liberados, []);
  assert.equal(cancelada.cola.entradas.length, 1);
  assert.deepEqual(cancelada.cola.entradas[0].retenidos, ['mensaje']);
  assert.equal(estaRevelada(cancelada.cola, propia.id), true);

  // Sin nada pendiente delante, lo retenido se suelta al cancelar
  const sola = encolar(crearCola(), { roll: d20(5), local: true, reservada: true });
  const conRetenido = retener(sola.cola, 'suelta');
  assert.deepEqual(cancelar(conRetenido.cola, sola.id).liberados, ['suelta']);
});

test('una reservada no rueda hasta que el servidor la confirma', () => {
  let cola = crearCola();
  const { cola: conReserva, id } = encolar(cola, { roll: d20(12), local: true, reservada: true });
  assert.equal(empezar(conReserva, id), conReserva);
  cola = confirmar(conReserva, id);
  assert.equal(empezar(cola, id).entradas[0].estado, 'rodando');
});

test('pasos del revelado y plan: total, contra y veredicto; el crítico cae más despacio', () => {
  const ataque = d20(14, { outcome: { resultado: 'impacta', contra: { etiqueta: 'CA', valor: 15 } } });
  assert.deepEqual(pasosDeRevelado(ataque), ['total', 'contra', 'veredicto']);
  assert.deepEqual(pasosDeRevelado(d20(3)), ['total']);

  const normal = planDeRevelado(ataque, 'normal');
  const cinematico = planDeRevelado(ataque, 'cinematico');
  const rapido = planDeRevelado(ataque, 'rapido');
  assert.ok(cinematico.finMs > normal.finMs && normal.finMs > rapido.finMs);
  assert.ok(cinematico.aterrizajeMs > normal.aterrizajeMs && normal.aterrizajeMs > rapido.aterrizajeMs);
  assert.equal(normal.pasos.length, 3);
  assert.equal(normal.pasos[0].trasAterrizajeMs, 0);

  const critico = planDeRevelado(d20(20), 'normal');
  assert.ok(critico.vueloMs > planDeRevelado(d20(10), 'normal').vueloMs);

  const instantaneo = planDeRevelado(ataque, 'instantaneo');
  assert.equal(instantaneo.conDados, false);
  assert.equal(instantaneo.finMs, 0);

  // Sin dados físicos (daño fijo del golpe desarmado) no hay vuelo que esperar
  const plano = planDeRevelado({ kind: 'damage', groups: [], modifier: 3, total: 3 }, 'normal');
  assert.equal(plano.conDados, false);
  assert.equal(plano.aterrizajeMs, 0);
});

test('margen tras resolver: por N, por los pelos, nada en crítico', () => {
  const contra = (resultado, total, valor = 15, etiqueta = 'CA') => ({
    total,
    outcome: { resultado, contra: { etiqueta, valor } },
  });
  assert.equal(textoDelMargen(contra('impacta', 19)), 'por 4');
  assert.equal(textoDelMargen(contra('impacta', 15)), 'por los pelos');
  assert.equal(textoDelMargen(contra('falla', 14)), 'por los pelos');
  assert.equal(textoDelMargen(contra('falla', 13)), 'por los pelos');
  assert.equal(textoDelMargen(contra('falla', 9)), 'por 6');
  assert.equal(textoDelMargen(contra('supera', 23, 13, 'CD')), 'por 10');
  assert.equal(textoDelMargen(contra('critico', 12)), null);
  assert.equal(textoDelMargen({ total: 12 }), null);
});

test('desglose corto: dados que cuentan y modificador', () => {
  assert.equal(desgloseCorto(d20(14)), '14 + 5');
  assert.equal(desgloseCorto({ groups: [{ results: [{ kept: 3 }, { kept: 5 }] }], modifier: -1 }), '3 + 5 − 1');
  assert.equal(desgloseCorto({ groups: [], modifier: 4 }), '4');
});
