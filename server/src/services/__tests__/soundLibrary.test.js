import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_KEYS, extensionForAudio, isSoundKey, resolveSoundAdmin } from '../soundLibrary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('las claves del servidor y las del catálogo del cliente no se separan', async () => {
  // El servidor duplica la lista a propósito (se despliega sin el código del
  // cliente), así que esta prueba es lo único que impide que una mitad añada un
  // sonido y la otra lo rechace con un 404.
  const catalogPath = path.resolve(__dirname, '../../../../client/src/lib/sfx/catalog.js');
  const { SFX_KEYS } = await import(`file://${catalogPath.replace(/\\/g, '/')}`);
  assert.deepEqual(
    [...SOUND_KEYS].sort(),
    [...SFX_KEYS].sort(),
    'añade el sonido en las dos listas: client/src/lib/sfx/catalog.js y server/src/services/soundLibrary.js'
  );
});

test('solo se aceptan claves del catálogo', () => {
  assert.equal(isSoundKey('dice.crit'), true);
  assert.equal(isSoundKey('dice.inventado'), false);
  assert.equal(isSoundKey(''), false);
  assert.equal(isSoundKey(null), false);
});

test('se aceptan los formatos de audio que todos los navegadores leen', () => {
  assert.equal(extensionForAudio('audio/mpeg'), '.mp3');
  assert.equal(extensionForAudio('audio/ogg'), '.ogg');
  assert.equal(extensionForAudio('audio/wav'), '.wav');
  assert.equal(extensionForAudio('audio/webm'), '.webm');
  assert.equal(extensionForAudio('audio/mp4'), '.m4a');
  // Con parámetros y en mayúsculas debe seguir valiendo.
  assert.equal(extensionForAudio('AUDIO/MPEG; charset=binary'), '.mp3');
  // Y nada que no sea audio.
  assert.equal(extensionForAudio('image/png'), null);
  assert.equal(extensionForAudio('application/octet-stream'), null);
  assert.equal(extensionForAudio(''), null);
  assert.equal(extensionForAudio(undefined), null);
});

test('sin lista configurada manda el usuario fundador', () => {
  assert.equal(resolveSoundAdmin({ configured: [], userId: 1, founderId: 1 }), true);
  assert.equal(resolveSoundAdmin({ configured: [], userId: 7, founderId: 1 }), false);
  // Una instalación sin usuarios todavía no tiene administrador.
  assert.equal(resolveSoundAdmin({ configured: [], userId: 1, founderId: null }), false);
});

test('con lista configurada manda la lista y el fundador pierde el privilegio implícito', () => {
  const configured = ['juan', 'dani'];
  assert.equal(resolveSoundAdmin({ configured, username: 'juan', userId: 9, founderId: 1 }), true);
  assert.equal(resolveSoundAdmin({ configured, username: 'DANI', userId: 9, founderId: 1 }), true);
  assert.equal(resolveSoundAdmin({ configured, username: ' juan ', userId: 9, founderId: 1 }), true);
  // El fundador ya no entra solo por serlo: si hay lista, hay que estar en ella.
  assert.equal(resolveSoundAdmin({ configured, username: 'otro', userId: 1, founderId: 1 }), false);
  assert.equal(resolveSoundAdmin({ configured, username: '', userId: 1, founderId: 1 }), false);
});
