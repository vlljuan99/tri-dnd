import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  CLASS_ART_INDICES,
  SPECIES_ART_INDICES,
  UNFORGED_PREVIEW_ART,
  creatorArt,
} from '../client/src/lib/creatorArt.js';

const artRoutes = [
  ...CLASS_ART_INDICES.map((index) => creatorArt('classes', index)),
  ...SPECIES_ART_INDICES.map((index) => creatorArt('races', index)),
  creatorArt('classes', 'custom:clase'),
  creatorArt('races', 'custom:especie'),
  UNFORGED_PREVIEW_ART,
];

test('las 24 piezas del creador se sirven y decodifican como WebP distintas', async ({ page, request }) => {
  const hashes = new Set();
  for (const route of artRoutes) {
    const response = await request.get(route);
    expect(response.ok(), `${route} debe responder`).toBeTruthy();
    expect(response.headers()['content-type'], `${route} debe servirse como WebP`).toContain('image/webp');
    hashes.add(createHash('sha256').update(await response.body()).digest('hex'));
  }
  expect(hashes.size).toBe(artRoutes.length);

  await page.goto('/');
  await page.setContent(artRoutes.map((route) => `<img src="${route}" alt="">`).join(''));
  const dimensions = await page.locator('img').evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
    return images.map((image) => [image.naturalWidth, image.naturalHeight]);
  });
  expect(dimensions).toHaveLength(24);
  expect(new Set(dimensions.map((size) => size.join('x')))).toEqual(new Set(['640x800']));
});
