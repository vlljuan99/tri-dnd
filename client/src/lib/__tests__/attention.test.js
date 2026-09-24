import test from 'node:test';
import assert from 'node:assert/strict';
import { TITULO_TURNO, avisarTurno, tituloParpadeo } from '../attention.js';

test('el título alterna entre el aviso y el original', () => {
  assert.equal(tituloParpadeo('Mesa · TriDnD', 0), TITULO_TURNO);
  assert.equal(tituloParpadeo('Mesa · TriDnD', 1), 'Mesa · TriDnD');
  assert.equal(tituloParpadeo('Mesa · TriDnD', 2), TITULO_TURNO);
});

test('sin documento (o con la pestaña a la vista) no hace nada', () => {
  const parar = avisarTurno({ nombre: 'Aria' });
  assert.equal(typeof parar, 'function');
  parar();
});
