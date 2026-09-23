import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASS_ART_INDICES,
  SPECIES_ART_INDICES,
  UNFORGED_PREVIEW_ART,
  creatorArt,
  creatorArtFallback,
} from '../creatorArt.js';

const publicDirectory = fileURLToPath(new URL('../../../public/', import.meta.url));

function assetPath(route) {
  return resolve(publicDirectory, route.replace(/^\/+/, ''));
}

async function readAsset(route) {
  try {
    return await readFile(assetPath(route));
  } catch (error) {
    assert.fail(`No existe el recurso ${route}: ${error.message}`);
  }
}

function assertWebpHeader(contents, route) {
  assert.equal(contents.subarray(0, 4).toString('ascii'), 'RIFF', `${route} debe comenzar por RIFF`);
  assert.equal(contents.subarray(8, 12).toString('ascii'), 'WEBP', `${route} debe declarar WEBP`);
}

function webpDimensions(contents, route) {
  let offset = 12;
  while (offset + 8 <= contents.length) {
    const type = contents.subarray(offset, offset + 4).toString('ascii');
    const size = contents.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (type === 'VP8X') {
      return {
        width: 1 + contents.readUIntLE(payload + 4, 3),
        height: 1 + contents.readUIntLE(payload + 7, 3),
      };
    }
    if (type === 'VP8 ') {
      assert.equal(contents.subarray(payload + 3, payload + 6).toString('hex'), '9d012a', `${route} debe contener un frame VP8 válido`);
      return {
        width: contents.readUInt16LE(payload + 6) & 0x3fff,
        height: contents.readUInt16LE(payload + 8) & 0x3fff,
      };
    }
    if (type === 'VP8L') {
      assert.equal(contents[payload], 0x2f, `${route} debe contener un frame VP8L válido`);
      const b1 = contents[payload + 1];
      const b2 = contents[payload + 2];
      const b3 = contents[payload + 3];
      const b4 = contents[payload + 4];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }
    offset = payload + size + (size % 2);
  }
  assert.fail(`${route} no contiene dimensiones WebP legibles`);
}

function assertSvgHeader(contents, route) {
  const header = contents.subarray(0, 512).toString('utf8').trimStart();
  assert.match(header, /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/, `${route} debe contener una cabecera SVG`);
}

test('las doce clases y las nueve especies resuelven su arte generado', () => {
  assert.equal(CLASS_ART_INDICES.length, 12);
  assert.equal(SPECIES_ART_INDICES.length, 9);

  for (const index of CLASS_ART_INDICES) {
    assert.equal(creatorArt('classes', index), `/creador/clase-${index}-gen.webp`);
    assert.equal(creatorArtFallback('classes', index), `/creador/clase-${index}.svg`);
  }
  for (const index of SPECIES_ART_INDICES) {
    assert.equal(creatorArt('races', index), `/creador/especie-${index}-gen.webp`);
    assert.equal(creatorArtFallback('races', index), `/creador/especie-${index}.svg`);
  }
});

test('las entradas propias o desconocidas usan arte específico y respaldo común', () => {
  for (const index of ['custom:linaje-del-dm', 'entrada-desconocida', '', undefined]) {
    assert.equal(creatorArt('classes', index), '/creador/clase-personalizada-gen.webp');
    assert.equal(creatorArtFallback('classes', index), '/creador/personalizado.svg');
    assert.equal(creatorArt('races', index), '/creador/especie-personalizada-gen.webp');
    assert.equal(creatorArtFallback('races', index), '/creador/personalizado.svg');
  }
});

test('todo el arte generado existe, es único y mide 640 × 800', async () => {
  const routes = [
    ...CLASS_ART_INDICES.map((index) => creatorArt('classes', index)),
    ...SPECIES_ART_INDICES.map((index) => creatorArt('races', index)),
    creatorArt('classes', 'custom:clase'),
    creatorArt('races', 'custom:especie'),
    UNFORGED_PREVIEW_ART,
  ];
  assert.equal(routes.length, 24);
  const hashes = new Set();
  for (const route of routes) {
    const contents = await readAsset(route);
    assertWebpHeader(contents, route);
    assert.deepEqual(webpDimensions(contents, route), { width: 640, height: 800 }, `${route} debe medir 640 × 800`);
    hashes.add(createHash('sha256').update(contents).digest('hex'));
  }
  assert.equal(hashes.size, routes.length, 'cada pieza principal debe tener contenido propio');
});

test('todos los respaldos existen y tienen una cabecera SVG válida', async () => {
  const routes = new Set([
    ...CLASS_ART_INDICES.map((index) => creatorArtFallback('classes', index)),
    ...SPECIES_ART_INDICES.map((index) => creatorArtFallback('races', index)),
    creatorArtFallback('classes', 'custom:clase'),
    creatorArtFallback('races', 'custom:especie'),
  ]);
  for (const route of routes) assertSvgHeader(await readAsset(route), route);
});
