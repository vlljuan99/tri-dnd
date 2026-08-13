import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapPrompt, buildWorldPrompt } from '../mapImageGeneration.js';

test('el estilo de campaña se antepone al prompt de suelo sin sustituir restricciones', () => {
  const prompt = buildMapPrompt('Una cripta inundada', {
    width: 8,
    height: 6,
    artStyle: 'grabado expresionista en tinta azul',
  });

  assert.ok(prompt.startsWith('Dirección artística adicional de esta campaña: grabado expresionista en tinta azul.'));
  assert.match(prompt, /vista aérea cenital estricta/);
  assert.match(prompt, /sin texto/);
  assert.match(prompt, /sin cuadrícula dibujada/);
});

test('el estilo de campaña también se antepone a mapas de mundo y ciudad', () => {
  const prompt = buildWorldPrompt('Puerto de las Brumas', 'ciudad', 'acuarela nocturna con cobre');

  assert.ok(prompt.startsWith('Dirección artística adicional de esta campaña: acuarela nocturna con cobre.'));
  assert.match(prompt, /Plano de ciudad/);
  assert.match(prompt, /sin texto/);
  assert.match(prompt, /sin cuadrícula/);
});

test('sin estilo configurado se conserva el prompt base', () => {
  const prompt = buildWorldPrompt('Las Marcas del Norte', 'region');
  assert.ok(prompt.startsWith('Mapa de mundo/región'));
});
