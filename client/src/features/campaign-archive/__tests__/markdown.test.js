import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMarkdownAction,
  parseInlineMarkdown,
  parseMarkdown,
  safeMarkdownUrl,
} from '../lib/markdown.js';

test('interpreta estructura Markdown sin convertir HTML crudo en código ejecutable', () => {
  const blocks = parseMarkdown('# Crónica\n\n- Uno\n- Dos\n\n<script>alert(1)</script>');

  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'list');
  assert.deepEqual(blocks[2], {
    type: 'paragraph',
    children: [{ type: 'text', value: '<script>alert(1)</script>' }],
  });
});

test('reconoce referencias estables a otras entradas', () => {
  assert.deepEqual(parseInlineMarkdown('Consulta [[entrada:42|la posada]].'), [
    { type: 'text', value: 'Consulta ' },
    { type: 'reference', targetId: 42, targetTitle: null, label: 'la posada' },
    { type: 'text', value: '.' },
  ]);

  assert.deepEqual(parseInlineMarkdown('Ve a [[El villano]]'), [
    { type: 'text', value: 'Ve a ' },
    { type: 'reference', targetId: null, targetTitle: 'El villano', label: 'El villano' },
  ]);
});

test('solo convierte enlaces web seguros en enlaces Markdown', () => {
  assert.match(safeMarkdownUrl('https://example.com/lore'), /^https:\/\/example\.com\/lore/);
  assert.equal(safeMarkdownUrl('javascript:alert(1)'), null);
  assert.deepEqual(parseInlineMarkdown('[trampa](javascript:alert(1))'), [
    { type: 'text', value: '[trampa](javascript:alert(1))' },
  ]);
});

test('la barra aplica formato y conserva una selección útil', () => {
  const bold = applyMarkdownAction({ value: 'dragón rojo', start: 0, end: 6, action: 'bold' });
  assert.equal(bold.value, '**dragón** rojo');
  assert.equal(bold.value.slice(bold.selectionStart, bold.selectionEnd), 'dragón');

  const reference = applyMarkdownAction({
    value: 'Visita la taberna',
    start: 10,
    end: 17,
    action: 'reference',
    payload: { id: 7, title: 'El Grifo' },
  });
  assert.equal(reference.value, 'Visita la [[entrada:7|taberna]]');
});

test('los estilos de bloque se aplican a todas las líneas seleccionadas', () => {
  const list = applyMarkdownAction({ value: 'uno\ndos', start: 0, end: 7, action: 'orderedList' });
  assert.equal(list.value, '1. uno\n2. dos');

  const heading = applyMarkdownAction({ value: '## Antiguo', start: 3, end: 3, action: 'heading1' });
  assert.equal(heading.value, '# Antiguo');
});
