import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_KEYS,
  HOTBAR_KEYS,
  WEAPON_KEYS,
  isTypingTarget,
  keyLabel,
  matchShortcut,
  weaponKey,
} from '../domain/shortcuts.js';

const todasLasTeclas = [
  ...Object.values(HOTBAR_KEYS),
  ...WEAPON_KEYS,
  ...Object.values(CAMERA_KEYS),
].flat();

const evento = (props) => ({ key: 'x', target: { tagName: 'DIV' }, ...props });

test('ninguna tecla está prometida dos veces en toda la mesa', () => {
  // Hotbar, armas y cámara comparten teclado: si dos acciones piden la misma
  // tecla, una de las dos deja de funcionar y nadie sabe cuál.
  assert.equal(
    new Set(todasLasTeclas).size,
    todasLasTeclas.length,
    'dos acciones con la misma tecla se pisarían'
  );
});

test('la cámara se maneja con las teclas de siempre', () => {
  assert.equal(matchShortcut(evento({ key: 'q' }), CAMERA_KEYS), 'rotarIzquierda');
  assert.equal(matchShortcut(evento({ key: 'E' }), CAMERA_KEYS), 'rotarDerecha');
  assert.equal(matchShortcut(evento({ key: 'f' }), CAMERA_KEYS), 'centrar');
  assert.equal(matchShortcut(evento({ key: 'r' }), CAMERA_KEYS), 'inclinarMas');
  assert.equal(matchShortcut(evento({ key: 't' }), CAMERA_KEYS), 'inclinarMenos');
});

test('acercar acepta las dos teclas del mismo sitio del teclado', () => {
  // En un teclado español "+" necesita Mayús; "=" está en la misma tecla.
  assert.equal(matchShortcut(evento({ key: '+' }), CAMERA_KEYS), 'acercar');
  assert.equal(matchShortcut(evento({ key: '=' }), CAMERA_KEYS), 'acercar');
  assert.equal(matchShortcut(evento({ key: '-' }), CAMERA_KEYS), 'alejar');
  assert.equal(keyLabel(CAMERA_KEYS.acercar), '+', 'en pantalla se enseña una sola');
});

test('las teclas de cámara tampoco se disparan escribiendo', () => {
  assert.equal(matchShortcut(evento({ key: 'q', target: { tagName: 'INPUT' } }), CAMERA_KEYS), null);
});

test('las armas ocupan las primeras teclas, por orden', () => {
  assert.equal(weaponKey(0), '1');
  assert.equal(weaponKey(3), '4');
  assert.equal(weaponKey(4), null, 'a partir de la quinta arma ya no hay tecla que ofrecer');
});

test('las teclas se escriben para el ojo humano', () => {
  assert.equal(keyLabel(' '), 'Espacio');
  assert.equal(keyLabel('c'), 'C');
  assert.equal(keyLabel('1'), '1');
});

test('reconoce la acción por su tecla, en mayúscula o minúscula', () => {
  assert.equal(matchShortcut(evento({ key: '5' })), 'correr');
  assert.equal(matchShortcut(evento({ key: 'c' })), 'conjuros');
  assert.equal(matchShortcut(evento({ key: 'C' })), 'conjuros');
  assert.equal(matchShortcut(evento({ key: ' ' })), 'terminarTurno');
  assert.equal(matchShortcut(evento({ key: 'Spacebar' })), 'terminarTurno');
});

test('una tecla sin acción asignada no dispara nada', () => {
  assert.equal(matchShortcut(evento({ key: 'z' })), null);
  assert.equal(matchShortcut(evento({ key: 'Escape' })), null);
});

test('escribir en el chat nunca dispara atajos', () => {
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    assert.equal(matchShortcut(evento({ key: 'c', target })), null);
    assert.equal(isTypingTarget(target), true);
  }
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
});

test('los atajos del navegador (Ctrl/Cmd/Alt) siguen siendo suyos', () => {
  assert.equal(matchShortcut(evento({ key: 'f', ctrlKey: true })), null);
  assert.equal(matchShortcut(evento({ key: 'i', metaKey: true })), null);
  assert.equal(matchShortcut(evento({ key: 'n', altKey: true })), null);
});

test('mantener pulsada una tecla no repite la acción', () => {
  assert.equal(matchShortcut(evento({ key: '5', repeat: true })), null);
});

test('las armas se resuelven con la tabla ampliada del hotbar', () => {
  const bindings = { ...HOTBAR_KEYS, 'arma-7': weaponKey(0), 'arma-9': weaponKey(1) };
  assert.equal(matchShortcut(evento({ key: '1' }), bindings), 'arma-7');
  assert.equal(matchShortcut(evento({ key: '2' }), bindings), 'arma-9');
  assert.equal(matchShortcut(evento({ key: '5' }), bindings), 'correr');
});

test('acepta una tabla de atajos propia', () => {
  assert.equal(matchShortcut(evento({ key: 'q' }), { rotar: 'q' }), 'rotar');
});
