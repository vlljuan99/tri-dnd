import { createContext, useContext, useEffect, useMemo } from 'react';
import * as THREE from 'three';

const MaterialsContext = createContext(null);

function randomGenerator(initialSeed) {
  let seed = initialSeed;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Ruido periódico interpolado: permite repetir la piedra sin costuras visibles.
function noiseField(resolution, random) {
  const values = Float32Array.from({ length: resolution * resolution }, random);
  return (u, v) => {
    const x = u * resolution;
    const y = v * resolution;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const fx = x - cellX;
    const fy = y - cellY;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sample = (a, b) => values[((b % resolution + resolution) % resolution) * resolution
      + ((a % resolution + resolution) % resolution)];
    const top = THREE.MathUtils.lerp(sample(cellX, cellY), sample(cellX + 1, cellY), sx);
    const bottom = THREE.MathUtils.lerp(sample(cellX, cellY + 1), sample(cellX + 1, cellY + 1), sx);
    return THREE.MathUtils.lerp(top, bottom, sy);
  };
}

function textureCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  return { canvas, context, pixels: context.createImageData(size, size) };
}

function writePixel(pixels, index, red, green = red, blue = red) {
  pixels.data[index] = red;
  pixels.data[index + 1] = green;
  pixels.data[index + 2] = blue;
  pixels.data[index + 3] = 255;
}

function finishTextures(albedo, height) {
  albedo.context.putImageData(albedo.pixels, 0, 0);
  height.context.putImageData(height.pixels, 0, 0);
  const color = new THREE.CanvasTexture(albedo.canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  const relief = new THREE.CanvasTexture(height.canvas);
  for (const texture of [color, relief]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
  }
  return { color, relief };
}

// El pavimento conserva juntas; las paredes y rocas comparten otra piedra sin
// retícula porque sus juntas y siluetas pertenecen a la geometría.
function stoneTextures() {
  const size = 256;
  const albedo = textureCanvas(size);
  const height = textureCanvas(size);
  const random = randomGenerator(7419);
  const shades = Array.from({ length: 32 }, () => 132 + random() * 38);
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / 32);
    for (let x = 0; x < size; x += 1) {
      const offsetX = (x + (row % 2) * 32) % size;
      const col = Math.floor(offsetX / 64);
      const edge = Math.min(offsetX % 64, 63 - offsetX % 64, y % 32, 31 - y % 32);
      const grain = (random() - 0.5) * 22;
      const weathering = Math.sin(x * 0.21 + Math.sin(y * 0.12)) * 4 + Math.sin(y * 0.42) * 3;
      const shade = edge < 1 ? 48 + grain : shades[row * 4 + col] + grain + weathering - (edge < 3 ? 19 : 0);
      const index = (y * size + x) * 4;
      writePixel(albedo.pixels, index, shade);
      // La altura no hereda las manchas del color: solo junta, bisel y grano.
      writePixel(height.pixels, index, (edge < 1 ? 65 : edge < 3 ? 114 : 145) + grain * 0.55);
    }
  }
  return finishTextures(albedo, height);
}

// Manchas minerales de varias escalas, vetas tenues y poros finos. Las cuatro
// texturas se generan una vez por tablero y no necesitan archivos ni red.
function rockTextures() {
  const size = 256;
  const albedo = textureCanvas(size);
  const height = textureCanvas(size);
  const random = randomGenerator(18427);
  const broad = noiseField(4, random);
  const medium = noiseField(12, random);
  const grain = noiseField(48, random);
  const reliefBroad = noiseField(8, random);
  const reliefFine = noiseField(64, random);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const clouds = broad(u, v) - 0.5;
      const mottling = medium(u, v) - 0.5;
      const flecks = grain(u, v) - 0.5;
      const veinPhase = Math.sin((u * 2 + v * 3) * Math.PI * 2 + clouds * 6 + mottling * 2);
      const vein = Math.pow(Math.max(0, 1 - Math.abs(veinPhase) * 5), 2);
      const dust = (random() - 0.5) * 7;
      const shade = 214 + clouds * 40 + mottling * 24 + flecks * 13 + dust - vein * 9;
      const warmth = clouds * 5 + mottling * 3;
      const index = (y * size + x) * 4;
      writePixel(albedo.pixels, index, shade + warmth, shade, shade - warmth * 0.8);
      const pore = Math.max(0, (0.22 - reliefFine(u, v)) / 0.22);
      const surface = 137 + (reliefBroad(u, v) - 0.5) * 26
        + (reliefFine(u, v) - 0.5) * 20 + (random() - 0.5) * 10 - pore * 26;
      writePixel(height.pixels, index, surface);
    }
  }
  return finishTextures(albedo, height);
}

export function BoardMaterials({ children }) {
  const resources = useMemo(() => ({
    ...stoneTextures(),
    rock: rockTextures(),
  }), []);
  useEffect(() => () => {
    resources.color.dispose();
    resources.relief.dispose();
    resources.rock.color.dispose();
    resources.rock.relief.dispose();
  }, [resources]);
  return <MaterialsContext.Provider value={resources}>{children}</MaterialsContext.Provider>;
}

export function StoneMaterial({ color = '#aaa99d', ...props }) {
  const textures = useContext(MaterialsContext);
  return <meshStandardMaterial map={textures.color} bumpMap={textures.relief} bumpScale={0.045}
    color={color} roughness={0.92} metalness={0.02} {...props} />;
}

export function RockMaterial({ color = '#a49a87', ...props }) {
  const { rock } = useContext(MaterialsContext);
  return <meshStandardMaterial map={rock.color} bumpMap={rock.relief} bumpScale={0.025}
    color={color} roughness={0.96} metalness={0} {...props} />;
}
