import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMedia, safeHttpUrl } from '../lib/media.js';

test('solo admite URL http y https', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,hola'), null);
  assert.equal(safeHttpUrl('https://usuario:secreto@example.com'), null);
  assert.equal(safeHttpUrl('no es una url'), null);
  assert.equal(safeHttpUrl('https://example.com/recurso')?.hostname, 'example.com');
});

test('solo incrusta proveedores multimedia permitidos', () => {
  const youtube = describeMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'video');
  assert.equal(youtube.type, 'iframe');
  assert.match(youtube.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\//);

  const vimeo = describeMedia('https://vimeo.com/123456789', 'video');
  assert.equal(vimeo.type, 'iframe');
  assert.equal(vimeo.src, 'https://player.vimeo.com/video/123456789');

  const spotify = describeMedia('https://open.spotify.com/track/abc123', 'musica');
  assert.equal(spotify.type, 'iframe');
  assert.equal(spotify.src, 'https://open.spotify.com/embed/track/abc123');

  assert.deepEqual(describeMedia('https://example.com/player', 'video'), {
    type: 'link',
    href: 'https://example.com/player',
  });
});

test('los archivos directos usan controles nativos', () => {
  assert.equal(describeMedia('https://cdn.example.com/intro.webm', 'video').type, 'video');
  assert.equal(describeMedia('https://cdn.example.com/tema.mp3?version=2', 'musica').type, 'audio');
});
